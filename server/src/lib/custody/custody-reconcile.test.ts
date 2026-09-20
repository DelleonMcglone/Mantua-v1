import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { circleUsdcRaw, reconcileWallet } from "./custody-reconcile.ts";

/** Task 073 / IC-001 — the custodian's number against the chain's. */

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

void describe("reconcileWallet", () => {
  const w = { address: "0xaaa", circleWalletId: "cw-1" };
  void it("matches equal balances and reports the difference otherwise", () => {
    assert.deepEqual(reconcileWallet({ ...w, circleRaw: 1_000_000n, chainRaw: 1_000_000n }), {
      ...w,
      circleRaw: "1000000",
      chainRaw: "1000000",
      diffRaw: "0",
      status: "matched",
    });
    const drift = reconcileWallet({ ...w, circleRaw: 1_000_000n, chainRaw: 900_000n });
    assert.equal(drift.status, "drift");
    assert.equal(drift.diffRaw, "100000");
  });
  void it("is unavailable, never matched, when either side is missing", () => {
    assert.equal(reconcileWallet({ ...w, circleRaw: null, chainRaw: 1n }).status, "unavailable");
    const r = reconcileWallet({ ...w, circleRaw: 1n, chainRaw: null });
    assert.equal(r.status, "unavailable");
    assert.equal(r.diffRaw, null);
  });
});

void describe("circleUsdcRaw", () => {
  void it("reads the USDC line by token address and scales the decimal amount", () => {
    const raw = circleUsdcRaw(
      [
        { amount: "0.5", token: { symbol: "ETH", decimals: 18 } },
        { amount: "12.345678", token: { symbol: "USDC", decimals: 6, tokenAddress: USDC } },
      ],
      USDC,
    );
    assert.equal(raw, 12_345_678n);
  });
  void it("returns null with no USDC line, and 0 for an empty amount", () => {
    assert.equal(circleUsdcRaw([], USDC), null);
    assert.equal(
      circleUsdcRaw([{ amount: "0", token: { decimals: 6, tokenAddress: USDC } }], USDC),
      0n,
    );
  });
});
