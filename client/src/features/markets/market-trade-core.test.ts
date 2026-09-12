import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MAX_FEE_PIPS, feeExceedsCeiling, feeLines } from "./fee-lines.ts";
import {
  closePositionDetail,
  feeSummary,
  isTradableStatus,
  rawToHuman6,
  usdcCeil2,
} from "./market-trade-core.ts";

test("rawToHuman6 renders exact 6dp amounts from raw balances", () => {
  assert.equal(rawToHuman6(0n), "0");
  assert.equal(rawToHuman6(1n), "0.000001");
  assert.equal(rawToHuman6(1_000_000n), "1");
  assert.equal(rawToHuman6(1_234_567n), "1.234567");
  assert.equal(rawToHuman6(12_500_000n), "12.5");
  assert.equal(rawToHuman6("987654321"), "987.654321");
});

test("rawToHuman6 never rounds up past the balance (float-division trap)", () => {
  // 19.799999 raw: Number(19799999)/1e6 → 19.799999000000002 is fine, but
  // e.g. 0.1-style binary artifacts can round the last digit up under
  // toFixed. The digit-built string is exact by construction.
  assert.equal(rawToHuman6(19_799_999n), "19.799999");
  // Round-trip: parsing the string back at 6dp returns the exact raw value.
  for (const raw of [1n, 999_999n, 19_799_999n, 123_456_789_012n]) {
    const human = rawToHuman6(raw);
    assert.equal(BigInt(Math.round(Number(human) * 1e6)), raw);
  }
});

test("rawToHuman6 rejects negatives", () => {
  assert.throws(() => rawToHuman6(-1n));
});

test("closePositionDetail builds the deep-link for open YES rows only", () => {
  const open = {
    side: "yes",
    state: "OPEN",
    league: "nfl",
    providerEventId: "401547401",
    balance: "1234567",
  };
  assert.deepEqual(closePositionDetail(open), {
    league: "nfl",
    eventId: "401547401",
    balance: "1234567",
  });
  assert.equal(closePositionDetail({ ...open, side: "no" }), null);
  assert.equal(closePositionDetail({ ...open, state: "RESOLVED" }), null);
  assert.equal(closePositionDetail({ ...open, league: null }), null);
  assert.equal(closePositionDetail({ ...open, providerEventId: null }), null);
});

test("isTradableStatus (D-103 in-play): open before AND during the game, closed on final/void", () => {
  assert.equal(isTradableStatus("scheduled"), true);
  assert.equal(isTradableStatus("in_progress"), true, "kickoff no longer closes the trade UI");
  assert.equal(isTradableStatus("final"), false);
  assert.equal(isTradableStatus("postponed"), false);
  assert.equal(isTradableStatus("cancelled"), false);
  assert.equal(isTradableStatus("suspended"), false);
});

// ─── D-105 fee line (task 049) ──────────────────────────────────────────────

const PLAYOFF_FEE = {
  feePips: 3500,
  ratePips: 7000,
  probabilityBps: 5000,
  playoffs: true,
  feeRaw: "350000",
  feeUsdcRaw: "350000",
};

test("feeSummary splits a $100 buy into position, fee, and total from the hook quote", () => {
  assert.deepEqual(feeSummary(100_000_000n, PLAYOFF_FEE), {
    position: "99.65",
    fee: "0.35",
    total: "100.00",
    ratePct: "0.35%",
    playoffs: true,
  });
});

test("feeSummary rounds the fee UP to the cent and never shows a non-zero fee as $0.00", () => {
  const tiny = { ...PLAYOFF_FEE, feeRaw: "1", feeUsdcRaw: "1" };
  assert.equal(feeSummary("1000000", tiny).fee, "0.01");
  assert.equal(usdcCeil2(175_000n), "0.18", "$0.175 shows as $0.18");
  assert.equal(usdcCeil2(0n), "0.00");
});

test("feeSummary reports a regular-season quote as free", () => {
  const free = {
    ...PLAYOFF_FEE,
    feePips: 0,
    ratePips: 0,
    playoffs: false,
    feeRaw: "0",
    feeUsdcRaw: "0",
  };
  const s = feeSummary(50_000_000n, free);
  assert.equal(s.fee, "0.00");
  assert.equal(s.position, "50.00");
  assert.equal(s.total, "50.00");
  assert.equal(s.ratePct, "0.00%");
  assert.equal(s.playoffs, false);
});

test("feeSummary prints three decimals when the pip rate needs them", () => {
  assert.equal(feeSummary(1_000_000n, { ...PLAYOFF_FEE, feePips: 6999 }).ratePct, "0.700%");
  assert.equal(feeSummary(1_000_000n, { ...PLAYOFF_FEE, feePips: 7000 }).ratePct, "0.70%");
});

// ─── T-008 — fee lines and the ceiling guard (task 050) ─────────────────────

test("feeLines renders four lines in every season, 0% in the regular season", () => {
  const free = {
    ...PLAYOFF_FEE,
    feePips: 0,
    ratePips: 0,
    playoffs: false,
    feeRaw: "0",
    feeUsdcRaw: "0",
  };
  const lines = feeLines(feeSummary(50_000_000n, free), "buy");
  assert.deepEqual(
    lines.map((l) => l.label),
    ["Position", "Fee", "Fee rate", "Total"],
  );
  assert.deepEqual(
    lines.map((l) => l.value),
    ["$50.00", "$0.00", "0.00%", "$50.00"],
  );
});

test("the spec numbers: $100 at 50/50 and the ceiling → $0.35; 100 contracts at 50¢ → $0.18", () => {
  const hundredDollars = feeSummary(100_000_000n, PLAYOFF_FEE);
  assert.equal(hundredDollars.fee, "0.35");
  assert.equal(hundredDollars.total, "100.00");
  // 100 contracts at $0.50 cost $50; the hook's fee is 50 × 0.35% = $0.175.
  const hundredContracts = feeSummary(50_000_000n, {
    ...PLAYOFF_FEE,
    feeRaw: "175000",
    feeUsdcRaw: "175000",
  });
  assert.equal(hundredContracts.fee, "0.18");
  assert.equal(hundredContracts.total, "50.00");
});

test("a quote above the 0.70% ceiling is refused, never displayed", () => {
  assert.equal(feeExceedsCeiling(PLAYOFF_FEE), false);
  assert.equal(feeExceedsCeiling({ ...PLAYOFF_FEE, feePips: 7000, ratePips: 7000 }), false);
  assert.equal(feeExceedsCeiling({ ...PLAYOFF_FEE, feePips: 7001 }), true);
  assert.equal(feeExceedsCeiling({ ...PLAYOFF_FEE, ratePips: 7001 }), true);
  assert.equal(MAX_FEE_PIPS, 7000);
});

test("sell lines value the fee taken from the contracts sold", () => {
  const lines = feeLines(feeSummary(10_000_000n, PLAYOFF_FEE), "sell");
  assert.deepEqual(
    lines.map((l) => l.label),
    ["Contracts sold", "Fee", "Fee rate"],
  );
  assert.equal(lines[0].value, "10.00");
  assert.equal(lines[1].value, "$0.35");
});
