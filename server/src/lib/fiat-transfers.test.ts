import assert from "node:assert/strict";
import test from "node:test";
import {
  FIAT_TRANSFER_STATUSES,
  canTransitionFiatTransfer,
  fiatTransferMessage,
  isTerminalFiatStatus,
  type FiatTransferStatus,
} from "./fiat-transfers.ts";

test("fiat transfer state machine is strictly one-way", () => {
  const legal: Array<[FiatTransferStatus, FiatTransferStatus]> = [
    ["pending", "processing"],
    ["pending", "complete"],
    ["pending", "failed"],
    ["pending", "canceled"],
    ["processing", "complete"],
    ["processing", "failed"],
    ["processing", "canceled"],
  ];
  const legalSet = new Set(legal.map(([f, t]) => `${f}→${t}`));
  for (const from of FIAT_TRANSFER_STATUSES) {
    for (const to of FIAT_TRANSFER_STATUSES) {
      assert.equal(
        canTransitionFiatTransfer(from, to),
        legalSet.has(`${from}→${to}`),
        `${from} → ${to}`,
      );
    }
  }
});

test("terminal statuses admit no exit", () => {
  for (const terminal of ["complete", "failed", "canceled"] as const) {
    assert.equal(isTerminalFiatStatus(terminal), true);
    for (const to of FIAT_TRANSFER_STATUSES) {
      assert.equal(canTransitionFiatTransfer(terminal, to), false, `${terminal} → ${to}`);
    }
  }
});

test("nothing transitions INTO pending, including self-loops", () => {
  for (const from of FIAT_TRANSFER_STATUSES) {
    assert.equal(canTransitionFiatTransfer(from, "pending"), false);
  }
});

test("transfer copy is chainless (F-005): no wallet/bridge/gas/chain words", () => {
  const banned = /wallet|bridge|gas|chain|network|usdc|token|base\b|arc\b/i;
  for (const kind of ["deposit", "withdraw"] as const) {
    for (const status of FIAT_TRANSFER_STATUSES) {
      const message = fiatTransferMessage(kind, status);
      assert.equal(banned.test(message), false, `${kind}/${status}: "${message}"`);
      assert.ok(message.length > 0);
    }
  }
});
