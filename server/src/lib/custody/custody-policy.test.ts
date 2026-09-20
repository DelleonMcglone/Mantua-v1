import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spendGate, withdrawalGate, type InstitutionLimits } from "./custody-policy.ts";

/** Task 074 / IC-001, IC-002 — the institution-level gates behind every money path. */

const INST: InstitutionLimits = {
  status: "active",
  circleWalletSetId: "set-1",
  perTradeCapUsd: 2500,
  dailyCapUsd: 10_000,
  approvalThresholdUsd: 1000,
};
const trader = { userId: "u1", role: "trader", status: "active" } as const;
const base = { institution: INST, member: trader, walletSetId: "set-1", spentTodayUsd: 0 };

void describe("spendGate", () => {
  void it("passes an active trader inside both caps", () => {
    assert.deepEqual(spendGate({ ...base, usd: 500 }), { ok: true });
  });
  void it("refuses when the institution is not active", () => {
    const r = spendGate({ ...base, institution: { ...INST, status: "suspended" }, usd: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "institution_inactive");
  });
  void it("refuses a removed member and a role that cannot trade", () => {
    const removed = spendGate({ ...base, member: { ...trader, status: "removed" }, usd: 1 });
    assert.equal(removed.ok, false);
    assert.equal(removed.code, "member_inactive");
    const viewer = spendGate({ ...base, member: { ...trader, role: "viewer" }, usd: 1 });
    assert.equal(viewer.ok, false);
    assert.equal(viewer.code, "member_cannot_trade");
  });
  void it("refuses a wallet outside the institution's set, and an unprovisioned set", () => {
    const outside = spendGate({ ...base, walletSetId: "retail", usd: 1 });
    assert.equal(outside.ok, false);
    assert.equal(outside.code, "wallet_unsegregated");
    const unprovisioned = spendGate({
      ...base,
      institution: { ...INST, circleWalletSetId: null },
      usd: 1,
    });
    assert.equal(unprovisioned.ok, false);
    assert.equal(unprovisioned.code, "wallet_set_unprovisioned");
  });
  void it("applies the per-trade cap and the aggregate daily cap", () => {
    const big = spendGate({ ...base, usd: 2500.01 });
    assert.equal(big.ok, false);
    assert.equal(big.code, "per_trade_cap");
    const daily = spendGate({ ...base, usd: 100, spentTodayUsd: 9950 });
    assert.equal(daily.ok, false);
    assert.equal(daily.code, "institution_daily_cap");
    assert.deepEqual(spendGate({ ...base, usd: 50, spentTodayUsd: 9950 }), { ok: true });
  });
});

void describe("withdrawalGate", () => {
  const dest = { status: "verified", chainId: 8453 };
  void it("below the threshold executes at once; at or above it needs a second approver", () => {
    assert.deepEqual(withdrawalGate({ ...base, usd: 999.99, destination: dest, chainId: 8453 }), {
      ok: true,
      needsApproval: false,
    });
    assert.deepEqual(withdrawalGate({ ...base, usd: 1000, destination: dest, chainId: 8453 }), {
      ok: true,
      needsApproval: true,
    });
  });
  void it("threshold zero means every withdrawal is approved by a second person", () => {
    const r = withdrawalGate({
      ...base,
      institution: { ...INST, approvalThresholdUsd: 0 },
      usd: 1,
      destination: dest,
      chainId: 8453,
    });
    assert.deepEqual(r, { ok: true, needsApproval: true });
  });
  void it("refuses an unverified or missing destination and a chain mismatch", () => {
    const pending = withdrawalGate({
      ...base,
      usd: 1,
      destination: { status: "pending", chainId: 8453 },
      chainId: 8453,
    });
    assert.equal(pending.ok, false);
    assert.equal(pending.code, "destination_unverified");
    const missing = withdrawalGate({ ...base, usd: 1, destination: null, chainId: 8453 });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "destination_unverified");
    const chain = withdrawalGate({
      ...base,
      usd: 1,
      destination: { status: "verified", chainId: 1 },
      chainId: 8453,
    });
    assert.equal(chain.ok, false);
    assert.equal(chain.code, "destination_chain_mismatch");
  });
  void it("needs the request permission and the spend gate", () => {
    const viewer = withdrawalGate({
      ...base,
      member: { ...trader, role: "viewer" },
      usd: 1,
      destination: dest,
      chainId: 8453,
    });
    assert.equal(viewer.ok, false);
    assert.equal(viewer.code, "member_cannot_withdraw");
    const capped = withdrawalGate({ ...base, usd: 5000, destination: dest, chainId: 8453 });
    assert.equal(capped.ok, false);
    assert.equal(capped.code, "per_trade_cap");
  });
});
