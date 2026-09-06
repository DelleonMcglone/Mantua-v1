import assert from "node:assert/strict";
import test from "node:test";
import {
  FiatRailsUnavailableError,
  _setFiatRailsModeForTests,
  _setFiatStoreForTests,
  createFiatTransfer,
  getFiatRailState,
  linkSandboxBank,
} from "./fiat-rails.ts";
import { createMemoryFiatStore } from "./fiat-store.ts";

/**
 * Sandbox flow against the in-memory store (CI has no Postgres). The memory
 * store enforces the SAME one-way transition map as the Postgres store —
 * see fiat-store.ts.
 */
function withSandbox(): ReturnType<typeof createMemoryFiatStore> {
  const store = createMemoryFiatStore();
  _setFiatStoreForTests(store);
  _setFiatRailsModeForTests("sandbox");
  return store;
}

function reset(): void {
  _setFiatStoreForTests(null);
  _setFiatRailsModeForTests(null);
}

test("disabled mode exposes nothing and refuses transfers", async () => {
  try {
    _setFiatStoreForTests(createMemoryFiatStore());
    _setFiatRailsModeForTests("disabled");
    const state = await getFiatRailState("user-a");
    assert.deepEqual(state, {
      mode: "disabled",
      bankLinked: false,
      plaidReady: false,
      bankLabel: null,
      transfers: [],
    });
    await assert.rejects(
      createFiatTransfer("user-a", "deposit", "10.00"),
      FiatRailsUnavailableError,
    );
  } finally {
    reset();
  }
});

test("sandbox: bank link is required before a transfer", async () => {
  try {
    withSandbox();
    await assert.rejects(
      createFiatTransfer("user-a", "deposit", "25.00"),
      FiatRailsUnavailableError,
    );
    await linkSandboxBank("user-a");
    const transfer = await createFiatTransfer("user-a", "deposit", "25.00");
    assert.equal(transfer.status, "pending");
    const state = await getFiatRailState("user-a");
    assert.equal(state.bankLinked, true);
    assert.equal(state.transfers[0]?.id, transfer.id);
  } finally {
    reset();
  }
});

test("sandbox transfers persist per user and complete via the lazy tick", async () => {
  try {
    const store = withSandbox();
    await linkSandboxBank("user-a");
    const created = await createFiatTransfer("user-a", "deposit", "50.00");

    // Another user sees nothing.
    const other = await getFiatRailState("user-b");
    assert.equal(other.transfers.length, 0);

    // Backdate past the completion window, then read — the lazy tick
    // settles it to complete through the one-way machine.
    const userId = await store.ensureUser("user-a");
    const rows = await store.listTransfers(userId);
    const stored = rows.find((r) => r.id === created.id);
    assert.ok(stored);
    stored.createdAt = new Date(Date.now() - 10_000);

    const state = await getFiatRailState("user-a");
    const settled = state.transfers.find((t) => t.id === created.id);
    assert.ok(settled);
    assert.equal(settled.status, "complete");
    assert.equal(settled.recoveryAction, undefined);
  } finally {
    reset();
  }
});

test("store transitions are one-way: a completed transfer never regresses", async () => {
  try {
    const store = withSandbox();
    await linkSandboxBank("user-a");
    const created = await createFiatTransfer("user-a", "withdraw", "10.00");

    assert.ok(await store.transition(created.id, "processing"));
    assert.ok(await store.transition(created.id, "complete"));
    // Terminal: no further transition applies, in any direction.
    assert.equal(await store.transition(created.id, "processing"), null);
    assert.equal(await store.transition(created.id, "failed"), null);
    assert.equal(await store.transition(created.id, "canceled"), null);
    assert.equal(await store.transition(created.id, "pending"), null);
  } finally {
    reset();
  }
});

test("webhook event recording dedupes on (provider, event id)", async () => {
  try {
    const store = withSandbox();
    const first = await store.recordWebhookEvent({
      provider: "zerohash",
      eventId: "evt_1",
      payload: {},
    });
    const second = await store.recordWebhookEvent({
      provider: "zerohash",
      eventId: "evt_1",
      payload: {},
    });
    const otherProvider = await store.recordWebhookEvent({
      provider: "plaid",
      eventId: "evt_1",
      payload: {},
    });
    assert.equal(first, true);
    assert.equal(second, false);
    assert.equal(otherProvider, true);
  } finally {
    reset();
  }
});
