import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  claimLabel,
  groupClaims,
  isClaimBusy,
  payoutUsd,
  totalClaimableUsd,
  type RedeemableRow,
} from "./market-redeem-core.ts";

function row(overrides: Partial<RedeemableRow>): RedeemableRow {
  return {
    marketId: "0x" + "11".repeat(32),
    label: "Chiefs to beat Raiders",
    league: "nfl",
    providerEventId: "evt-1",
    state: "RESOLVED",
    side: "yes",
    tokenAddress: "0x" + "22".repeat(20),
    balanceRaw: "5000000",
    payoutRaw: "5000000",
    ...overrides,
  };
}

test("claimLabel: chainless copy per phase", () => {
  assert.equal(claimLabel("idle"), "Claim winnings");
  assert.equal(claimLabel("preparing"), "Preparing…");
  assert.equal(claimLabel("signing"), "Confirm in your wallet…");
  assert.equal(claimLabel("confirming"), "Claiming…");
  assert.equal(claimLabel("done"), "Claimed");
  assert.equal(claimLabel("error"), "Claim winnings");
});

test("isClaimBusy: only in-flight phases lock the buttons", () => {
  assert.equal(isClaimBusy("idle"), false);
  assert.equal(isClaimBusy("preparing"), true);
  assert.equal(isClaimBusy("signing"), true);
  assert.equal(isClaimBusy("confirming"), true);
  assert.equal(isClaimBusy("done"), false);
  assert.equal(isClaimBusy("error"), false);
});

test("payoutUsd: raw 6dp → USD, garbage → 0", () => {
  assert.equal(payoutUsd("5000000"), 5);
  assert.equal(payoutUsd("2500000"), 2.5);
  assert.equal(payoutUsd("not-a-number"), 0);
});

test("groupClaims: one claim per market, both sides of a voided market merged", () => {
  const voided = "0x" + "aa".repeat(32);
  const claims = groupClaims([
    row({}),
    row({ marketId: voided, state: "INVALID", side: "yes", payoutRaw: "2000000" }),
    row({ marketId: voided, state: "INVALID", side: "no", payoutRaw: "500000" }),
  ]);
  assert.equal(claims.length, 2);
  assert.equal(claims[0].sides.length, 1);
  assert.equal(claims[0].totalUsd, 5);
  assert.equal(claims[1].marketId, voided);
  assert.equal(claims[1].sides.length, 2);
  assert.equal(claims[1].totalUsd, 2.5);
});

test("totalClaimableUsd sums every claim", () => {
  const claims = groupClaims([
    row({}),
    row({ marketId: "0x" + "bb".repeat(32), payoutRaw: "1250000" }),
  ]);
  assert.equal(totalClaimableUsd(claims), 6.25);
  assert.equal(totalClaimableUsd([]), 0);
});
