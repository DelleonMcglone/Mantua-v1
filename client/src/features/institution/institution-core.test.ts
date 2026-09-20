import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canVerify,
  custodianLabel,
  limitsLine,
  withdrawalActions,
  withdrawalLine,
  type InstitutionView,
  type Withdrawal,
} from "./institution-core.ts";

/** Task 073 — the institution section's labels and who sees which button. */

const me: InstitutionView["me"] = {
  userId: "u1",
  role: "admin",
  permissions: ["view_reports", "approve_withdrawal", "verify_destination"],
};
const withdrawal: Withdrawal = {
  id: "w1",
  requestedBy: "u2",
  walletAddress: "0xa",
  destination: "Anchorage",
  symbol: "USDC",
  amount: "1500",
  usdValue: "1500.00",
  status: "pending",
  txHash: null,
  reason: null,
  lastError: null,
  createdAt: "2026-09-19T00:00:00.000Z",
};

void describe("institution core", () => {
  void it("labels custodians, limits and withdrawals", () => {
    assert.equal(
      custodianLabel({
        id: "i",
        slug: "s",
        name: "n",
        status: "active",
        custodian: "bitgo",
        custodianLabel: null,
        provisioned: true,
        limits: { perTradeCapUsd: 1, dailyCapUsd: 1, approvalThresholdUsd: 1 },
      }),
      "BitGo",
    );
    assert.equal(
      limitsLine({ perTradeCapUsd: 2500, dailyCapUsd: 10000, approvalThresholdUsd: 0 }),
      "$2,500 per trade · $10,000 a day across the institution · every withdrawal needs a second approver",
    );
    assert.equal(withdrawalLine(withdrawal), "1500 USDC → Anchorage · awaiting approval");
  });
  void it("shows Decide to a second approver, Cancel to the requester, nothing once decided", () => {
    assert.deepEqual(withdrawalActions(withdrawal, me), { canDecide: true, canCancel: false });
    assert.deepEqual(withdrawalActions({ ...withdrawal, requestedBy: "u1" }, me), {
      canDecide: false,
      canCancel: true,
    });
    assert.deepEqual(withdrawalActions({ ...withdrawal, status: "executed" }, me), {
      canDecide: false,
      canCancel: false,
    });
  });
  void it("shows Verify only to a second person with the right", () => {
    const d = {
      id: "d",
      label: "L",
      address: "0x",
      chainId: 8453,
      status: "pending",
      addedBy: "u2",
      verifiedBy: null,
    };
    assert.equal(canVerify(d, me), true);
    assert.equal(canVerify({ ...d, addedBy: "u1" }, me), false);
    assert.equal(canVerify({ ...d, status: "verified" }, me), false);
    assert.equal(canVerify(d, { ...me, permissions: ["view_reports"] }), false);
  });
});
