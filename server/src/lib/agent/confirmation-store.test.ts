import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRMATION_TTL_MS,
  ConfirmationStore,
  PREVIEW_TTL_MS,
  argsHash,
} from "./confirmation-store.ts";
import type { SharedCacheClient } from "../shared-cache.ts";

/** Phase 8 / A-031 — previews and single-use, expiring confirmations. */

function fakeRedis(now: () => number): SharedCacheClient & { keys: () => string[] } {
  const m = new Map<string, { value: string; expiresAt: number }>();
  return {
    get: (key) => {
      const hit = m.get(key);
      if (!hit || hit.expiresAt <= now()) return Promise.resolve(null);
      return Promise.resolve(hit.value);
    },
    set: (key, value, opts) => {
      m.set(key, { value, expiresAt: now() + opts.ex * 1000 });
      return Promise.resolve("OK");
    },
    del: (key) => Promise.resolve(m.delete(key) ? 1 : 0),
    keys: () => [...m.keys()],
  };
}

const PREVIEW = {
  sessionId: "s1",
  kind: "action" as const,
  tool: "swap",
  argsHash: argsHash("swap", { tokenIn: "USDC", tokenOut: "WETH", amountIn: "10" }),
  simulation: null,
  summary: "swap 10 USDC → WETH",
};

void describe("argsHash", () => {
  void it("is order-independent and ignores confirmationId", () => {
    const a = argsHash("swap", { tokenIn: "USDC", tokenOut: "WETH", amountIn: "10" });
    const b = argsHash("swap", {
      amountIn: "10",
      tokenOut: "WETH",
      tokenIn: "USDC",
      confirmationId: "x",
    });
    assert.equal(a, b);
    assert.notEqual(a, argsHash("swap", { tokenIn: "USDC", tokenOut: "WETH", amountIn: "11" }));
    assert.notEqual(a, argsHash("send", { tokenIn: "USDC", tokenOut: "WETH", amountIn: "10" }));
  });
});

for (const backend of ["memory", "redis"] as const) {
  void describe(`ConfirmationStore (${backend})`, () => {
    function make() {
      const clock = { t: 1_000_000 };
      const now = () => clock.t;
      const client = backend === "redis" ? fakeRedis(now) : null;
      return { store: new ConfirmationStore({ client, now }), clock, client };
    }

    void it("keeps one pending preview per session and expires it", async () => {
      const { store, clock } = make();
      await store.savePreview(PREVIEW);
      const second = await store.savePreview({ ...PREVIEW, summary: "swap 20 USDC → WETH" });
      const pending = await store.pendingPreview("s1");
      assert.equal(pending?.previewId, second.previewId);
      assert.equal(await store.pendingPreview("other"), null);
      clock.t += PREVIEW_TTL_MS + 1;
      assert.equal(await store.pendingPreview("s1"), null);
    });

    void it("mints a single-use confirmation bound to the preview and clears the preview", async () => {
      const { store, clock } = make();
      const preview = await store.savePreview(PREVIEW);
      const c = await store.mint("s1", preview, "confirm");
      assert.equal(c.previewId, preview.previewId);
      assert.equal(c.expiresAt, clock.t + CONFIRMATION_TTL_MS);
      assert.equal(
        await store.pendingPreview("s1"),
        null,
        "a second 'confirm' must not mint again",
      );
      assert.equal((await store.peek(c.confirmationId))?.confirmationId, c.confirmationId);
      const taken = await store.take(c.confirmationId);
      assert.equal(taken?.preview.tool, "swap");
      assert.equal(await store.take(c.confirmationId), null, "single use");
    });

    void it("expires a confirmation", async () => {
      const { store, clock } = make();
      const preview = await store.savePreview(PREVIEW);
      const c = await store.mint("s1", preview, "confirm");
      clock.t += CONFIRMATION_TTL_MS + 1;
      assert.equal(await store.take(c.confirmationId), null);
    });

    if (backend === "redis") {
      void it("namespaces keys under mantua:agent:", async () => {
        const { store, client } = make();
        await store.savePreview(PREVIEW);
        assert.ok(client);
        assert.ok(client.keys().every((k) => k.startsWith("mantua:agent:")));
      });
    }
  });
}
