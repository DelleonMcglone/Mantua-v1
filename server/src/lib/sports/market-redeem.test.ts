import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toFunctionSelector } from "viem";

import {
  estimatePayoutRaw,
  redeemCalldata,
  redeemFunctionForDbState,
  redeemFunctionForOnchainState,
  redeemableSides,
  settlementPriceFor,
} from "./market-redeem.ts";

describe("redeemFunctionForOnchainState (mirrors reclaimSettledMarkets)", () => {
  it("maps INVALID (4) to redeemInvalid", () => {
    assert.equal(redeemFunctionForOnchainState(4), "redeemInvalid");
  });

  it("maps RESOLVED (2) and SETTLED (3) to redeem", () => {
    assert.equal(redeemFunctionForOnchainState(2), "redeem");
    assert.equal(redeemFunctionForOnchainState(3), "redeem");
  });

  it("refuses OPEN (0) and FROZEN (1) — nothing to redeem yet", () => {
    assert.equal(redeemFunctionForOnchainState(0), null);
    assert.equal(redeemFunctionForOnchainState(1), null);
  });

  it("refuses unknown states", () => {
    assert.equal(redeemFunctionForOnchainState(5), null);
    assert.equal(redeemFunctionForOnchainState(-1), null);
  });
});

describe("redeemFunctionForDbState (the string mirror of the on-chain enum)", () => {
  it("agrees with the on-chain mapping on every lifecycle state", () => {
    const pairs: [string, number][] = [
      ["OPEN", 0],
      ["FROZEN", 1],
      ["RESOLVED", 2],
      ["SETTLED", 3],
      ["INVALID", 4],
    ];
    for (const [db, onchain] of pairs) {
      assert.equal(redeemFunctionForDbState(db), redeemFunctionForOnchainState(onchain), db);
    }
  });

  it("refuses unknown strings", () => {
    assert.equal(redeemFunctionForDbState(""), null);
    assert.equal(redeemFunctionForDbState("resolved"), null);
  });
});

describe("redeemCalldata (no-arg selectors)", () => {
  it("encodes exactly the 4-byte selector for each function", () => {
    assert.equal(redeemCalldata("redeem"), toFunctionSelector("function redeem()"));
    assert.equal(redeemCalldata("redeemInvalid"), toFunctionSelector("function redeemInvalid()"));
  });
});

describe("estimatePayoutRaw ($1/winning share, $0.50/share on INVALID)", () => {
  it("pays 1:1 on a resolved market", () => {
    assert.equal(estimatePayoutRaw("redeem", 7_500_000n), 7_500_000n);
  });

  it("pays half on a voided market, rounding dust down", () => {
    assert.equal(estimatePayoutRaw("redeemInvalid", 7_500_000n), 3_750_000n);
    assert.equal(estimatePayoutRaw("redeemInvalid", 3n), 1n);
  });
});

describe("redeemableSides (the redeemable-listing shaper)", () => {
  it("reports only the winning side of a RESOLVED market", () => {
    const sides = redeemableSides({
      state: "RESOLVED",
      winningOutcomeIndex: 0,
      yesBalanceRaw: 5_000_000n,
      noBalanceRaw: 2_000_000n,
    });
    assert.deepEqual(sides, [{ side: "yes", balanceRaw: 5_000_000n, payoutRaw: 5_000_000n }]);
  });

  it("reports the NO side when NO won (winningOutcomeIndex 1)", () => {
    const sides = redeemableSides({
      state: "SETTLED",
      winningOutcomeIndex: 1,
      yesBalanceRaw: 5_000_000n,
      noBalanceRaw: 2_000_000n,
    });
    assert.deepEqual(sides, [{ side: "no", balanceRaw: 2_000_000n, payoutRaw: 2_000_000n }]);
  });

  it("reports nothing when the winner holds a zero balance", () => {
    const sides = redeemableSides({
      state: "RESOLVED",
      winningOutcomeIndex: 1,
      yesBalanceRaw: 5_000_000n,
      noBalanceRaw: 0n,
    });
    assert.deepEqual(sides, []);
  });

  it("reports nothing on a resolved market whose winner is unknown", () => {
    const sides = redeemableSides({
      state: "RESOLVED",
      winningOutcomeIndex: null,
      yesBalanceRaw: 5_000_000n,
      noBalanceRaw: 5_000_000n,
    });
    assert.deepEqual(sides, []);
  });

  it("reports both nonzero sides at half value on an INVALID market", () => {
    const sides = redeemableSides({
      state: "INVALID",
      winningOutcomeIndex: null,
      yesBalanceRaw: 4_000_000n,
      noBalanceRaw: 1_000_000n,
    });
    assert.deepEqual(sides, [
      { side: "yes", balanceRaw: 4_000_000n, payoutRaw: 2_000_000n },
      { side: "no", balanceRaw: 1_000_000n, payoutRaw: 500_000n },
    ]);
  });

  it("skips zero balances on an INVALID market", () => {
    const sides = redeemableSides({
      state: "INVALID",
      winningOutcomeIndex: null,
      yesBalanceRaw: 0n,
      noBalanceRaw: 1_000_000n,
    });
    assert.deepEqual(sides, [{ side: "no", balanceRaw: 1_000_000n, payoutRaw: 500_000n }]);
  });

  it("reports nothing while the market is still live (OPEN/FROZEN)", () => {
    for (const state of ["OPEN", "FROZEN"]) {
      const sides = redeemableSides({
        state,
        winningOutcomeIndex: 0,
        yesBalanceRaw: 5_000_000n,
        noBalanceRaw: 5_000_000n,
      });
      assert.deepEqual(sides, [], state);
    }
  });
});

describe("settlementPriceFor (P-006 — the position mirror's settled value)", () => {
  it("pays the winning side $1 and the losing side $0 (market vocabulary: 0 = YES pays)", () => {
    assert.equal(settlementPriceFor("yes", "RESOLVED", 0), "1.00000");
    assert.equal(settlementPriceFor("no", "RESOLVED", 0), "0.00000");
    assert.equal(settlementPriceFor("yes", "SETTLED", 1), "0.00000");
    assert.equal(settlementPriceFor("no", "SETTLED", 1), "1.00000");
  });

  it("pays either side $0.50 on INVALID, winner irrelevant", () => {
    assert.equal(settlementPriceFor("yes", "INVALID", null), "0.50000");
    assert.equal(settlementPriceFor("no", "INVALID", 0), "0.50000");
  });

  it("refuses to settle a live market or an unknown winner — hold, never guess", () => {
    assert.equal(settlementPriceFor("yes", "OPEN", 0), null);
    assert.equal(settlementPriceFor("yes", "FROZEN", 0), null);
    assert.equal(settlementPriceFor("yes", "RESOLVED", null), null);
    assert.equal(settlementPriceFor("yes", "RESOLVED", 7), null);
  });
});
