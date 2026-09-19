import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ComboQuoteOk } from "./combo-quote-types.ts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { materialComboDrift } = await import("./combo-drift.ts");

/** Task 072 / CB-006 — a confirmed combo executes only within the drift rule. */

const confirmed: ComboQuoteOk = {
  ok: true,
  marketId: "0xabc",
  label: "A + B",
  startsAt: 1,
  source: "pool",
  deployed: true,
  exists: true,
  marketState: "OPEN",
  stakeRaw: "10000000",
  fairProbabilityBps: 2_500,
  effectivePriceBps: 2_600,
  combinedOdds: 3.85,
  sharesRaw: "38000000",
  potentialPayoutRaw: "38000000",
  premiumBps: 100,
  fee: {
    feePips: 0,
    ratePips: 0,
    probabilityBps: 2_500,
    playoffs: false,
    feeRaw: "0",
    feeUsdcRaw: "0",
  },
  separateTicketsFeeUsdcRaw: "0",
  legs: [],
  gate: { ok: true, reasons: [] },
  limits: { maxLegs: 3, maxStakeUsd: 25, openExposureUsd: 0, maxOpenExposureUsd: 100 },
};

void describe("materialComboDrift", () => {
  void it("accepts the same quote and small moves", () => {
    assert.deepEqual(materialComboDrift(confirmed, confirmed), []);
    assert.deepEqual(
      materialComboDrift(confirmed, {
        ...confirmed,
        effectivePriceBps: 2_690,
        sharesRaw: "37700000",
      }),
      [],
    );
  });
  void it("refuses a different leg set or stake, a moved price, a shrunken payout, a failed gate", () => {
    assert.match(
      materialComboDrift(confirmed, { ...confirmed, marketId: "0xdef" })[0],
      /legs differ/,
    );
    assert.match(
      materialComboDrift(confirmed, { ...confirmed, stakeRaw: "1" })[0],
      /stake differs/,
    );
    assert.match(
      materialComboDrift(confirmed, { ...confirmed, effectivePriceBps: 2_800 })[0],
      /price moved from 2600 to 2800/,
    );
    assert.match(
      materialComboDrift(confirmed, { ...confirmed, sharesRaw: "37000000" })[0],
      /shrank by 2.6%/,
    );
    assert.match(
      materialComboDrift(confirmed, { ...confirmed, gate: { ok: false, reasons: ["paused"] } })[0],
      /no longer allowed: paused/,
    );
    assert.match(
      materialComboDrift(confirmed, { ...confirmed, deployed: false })[0],
      /not deployed/,
    );
  });
  void it("reports every rule violation of a refused fresh quote", () => {
    const r = materialComboDrift(confirmed, {
      ok: false,
      violations: [{ code: "leg_final", marketId: "0x1", detail: "A: game is over" }],
      legs: [],
    });
    assert.deepEqual(r, ["no longer allowed: A: game is over"]);
  });
});
