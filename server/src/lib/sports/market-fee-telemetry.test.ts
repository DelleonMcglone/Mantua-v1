/**
 * Task 049 (H-011) — fee telemetry decodes the hook's MarketFeeUpdated log
 * from a receipt and ignores everything that is not the hook.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { DYNAMIC_MARKET_HOOK_ABI } from "../markets-contracts.ts";
import {
  NO_FEE_TELEMETRY,
  feeQuoteFromReceiptLogs,
  fillFeeTelemetry,
} from "./market-fee-telemetry.ts";

const HOOK = "0x00000000000000000000000000000000000028C0" as const;
const OTHER = "0x0000000000000000000000000000000000001234" as const;
const POOL_ID = `0x${"11".repeat(32)}` as const;

const BREAKDOWN_TUPLE = [
  { type: "uint24", name: "minRate" },
  { type: "uint24", name: "liquidityPremium" },
  { type: "uint24", name: "volatilityPremium" },
  { type: "uint24", name: "activityPremium" },
  { type: "uint24", name: "uncertaintyPremium" },
  { type: "uint24", name: "rate" },
  { type: "uint16", name: "probabilityBps" },
  { type: "bool", name: "playoffs" },
  { type: "bool", name: "stale" },
] as const;

function feeLog(
  emitter: `0x${string}`,
  effectiveFee: number,
  rate: number,
  p: number,
  playoffs: boolean,
): Log {
  const topics = encodeEventTopics({
    abi: DYNAMIC_MARKET_HOOK_ABI,
    eventName: "MarketFeeUpdated",
    args: { poolId: POOL_ID },
  });
  const data = encodeAbiParameters(
    [{ type: "tuple", components: BREAKDOWN_TUPLE }, { type: "uint24" }],
    [
      {
        minRate: playoffs ? 1000 : 0,
        liquidityPremium: 0,
        volatilityPremium: 0,
        activityPremium: 0,
        uncertaintyPremium: rate - (playoffs ? 1000 : 0),
        rate,
        probabilityBps: p,
        playoffs,
        stale: false,
      },
      effectiveFee,
    ],
  );
  return {
    address: emitter,
    topics,
    data,
    blockNumber: 1n,
    blockHash: `0x${"22".repeat(32)}`,
    transactionHash: `0x${"33".repeat(32)}`,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  } as Log;
}

void describe("feeQuoteFromReceiptLogs", () => {
  void it("decodes the hook's event and values a buy's fee in USDC", () => {
    const q = feeQuoteFromReceiptLogs(
      [feeLog(HOOK, 3500, 7000, 5000, true)],
      HOOK,
      "buy",
      "200000000",
      "100000000",
    );
    assert.ok(q);
    assert.equal(q.feePips, 3500);
    assert.equal(q.ratePips, 7000);
    assert.equal(q.probabilityBps, 5000);
    assert.equal(q.feeRaw, "350000", "0.35% of the $100 input");
    assert.equal(q.feeUsdcRaw, "350000");
    assert.deepEqual(fillFeeTelemetry(q), {
      feePips: 3500,
      feeRatePips: 7000,
      feeProbabilityBps: 5000,
      feeUsdcRaw: "350000",
      playoffs: true,
    });
  });

  void it("values a sell's YES-denominated fee at the pool price", () => {
    const q = feeQuoteFromReceiptLogs(
      [feeLog(HOOK, 750, 1000, 2500, true)],
      HOOK,
      "sell",
      "400000000",
      "100000000",
    );
    assert.ok(q);
    assert.equal(q.feeRaw, "300000", "0.075% of 400 YES");
    assert.equal(q.feeUsdcRaw, "75000", "0.3 YES at $0.25");
  });

  void it("ignores an identical event from a contract that is not the hook", () => {
    assert.equal(
      feeQuoteFromReceiptLogs([feeLog(OTHER, 3500, 7000, 5000, true)], HOOK, "buy", "1", "1"),
      null,
    );
    assert.deepEqual(fillFeeTelemetry(null), NO_FEE_TELEMETRY);
  });

  void it("returns null for a receipt with no hook log at all", () => {
    assert.equal(feeQuoteFromReceiptLogs([], HOOK, "buy", "1", "1"), null);
  });

  void it("records a regular-season fill as a zero fee, not a missing one", () => {
    const q = feeQuoteFromReceiptLogs(
      [feeLog(HOOK, 0, 0, 5000, false)],
      HOOK,
      "buy",
      "1",
      "100000000",
    );
    assert.ok(q);
    assert.equal(q.feeUsdcRaw, "0");
    assert.equal(fillFeeTelemetry(q).playoffs, false);
  });
});
