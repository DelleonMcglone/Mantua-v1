import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  comboFeeLines,
  oddsLabel,
  payoutLine,
  premiumLine,
  removeLeg,
  toggleLeg,
  type BuilderLeg,
  type ComboQuoteOk,
} from "./combo-core.ts";
import { sumComboValueUsd, verdictLine, type ComboTicket } from "./combo-ticket-core.ts";

/** Task 072 — the builder's leg list and the ticket's lines, pure. */

const leg = (id: string, side: 0 | 1, team = `T${id}${String(side)}`): BuilderLeg => ({
  providerEventId: id,
  outcomeIndex: side,
  teamName: team,
  opponentName: "Opp",
  league: "nfl",
  kickoffAt: 1,
});

void describe("builder legs", () => {
  void it("adds, removes on the same tap, and replaces the other side of one game", () => {
    let legs = toggleLeg([], leg("1", 0));
    legs = toggleLeg(legs, leg("2", 1));
    assert.deepEqual(
      legs.map((l) => l.teamName),
      ["T10", "T21"],
    );
    legs = toggleLeg(legs, leg("1", 1));
    assert.deepEqual(
      legs.map((l) => l.teamName),
      ["T21", "T11"],
      "one game, one leg",
    );
    legs = toggleLeg(legs, leg("1", 1));
    assert.deepEqual(
      legs.map((l) => l.teamName),
      ["T21"],
    );
    assert.deepEqual(removeLeg(legs, { providerEventId: "2", outcomeIndex: 1 }), []);
  });
});

const quote: ComboQuoteOk = {
  ok: true,
  marketId: "0xc",
  label: "A + B + C",
  source: "pool",
  deployed: true,
  exists: true,
  stakeRaw: "10000000",
  fairProbabilityBps: 1_500,
  effectivePriceBps: 1_600,
  combinedOdds: 6.25,
  sharesRaw: "62500000",
  potentialPayoutRaw: "62500000",
  premiumBps: 100,
  fee: {
    feePips: 3_500,
    ratePips: 5_000,
    probabilityBps: 1_600,
    playoffs: true,
    feeRaw: "35000",
    feeUsdcRaw: "35000",
  },
  separateTicketsFeeUsdcRaw: "51000",
  legs: [1, 2, 3].map((i) => ({
    providerEventId: String(i),
    outcomeIndex: 0 as const,
    marketId: `0x${String(i)}`,
    teamName: `T${String(i)}`,
    opponentName: "Opp",
    league: "nfl",
    kickoffAt: 1,
    priceBps: 5_000,
    oddsMultiplier: 2,
    result: "pending" as const,
    separateFeeUsdcRaw: "17000",
  })),
  gate: { ok: true, reasons: [] },
  limits: { maxLegs: 3, maxStakeUsd: 25, openExposureUsd: 0, maxOpenExposureUsd: 100 },
};

void describe("ticket lines", () => {
  void it("odds, payout and premium wording", () => {
    assert.equal(oddsLabel(2_500), "4.00x");
    assert.equal(oddsLabel(null), "—");
    assert.equal(payoutLine(quote), "Pays $62.50 if all 3 legs win · 6.25x");
    assert.equal(premiumLine(quote), "15.0% fair · pool 1.0 pts above fair");
    assert.equal(premiumLine({ ...quote, premiumBps: 0 }), "15.0% fair · at or below fair");
    assert.match(premiumLine({ ...quote, source: "planned" }), /opening price/);
  });

  void it("fee lines are the single-trade lines plus the separate-tickets comparison; the ceiling blanks them", () => {
    const lines = comboFeeLines(quote);
    assert.deepEqual(
      lines.map((l) => l.label),
      ["Position", "Fee", "Fee rate", "Total", "Same legs as separate tickets"],
    );
    assert.deepEqual(lines.map((l) => l.value).slice(1), ["$0.04", "0.35%", "$10.00", "$0.06 fee"]);
    assert.deepEqual(comboFeeLines({ ...quote, separateTicketsFeeUsdcRaw: null }).length, 4);
    assert.deepEqual(comboFeeLines({ ...quote, fee: { ...quote.fee, feePips: 7_001 } }), []);
  });

  void it("verdict line and the holdings part", () => {
    const t: ComboTicket = {
      id: "t",
      status: "open",
      label: "A + B + C",
      marketId: "0xc",
      stakeRaw: "10000000",
      sharesRaw: "62500000",
      potentialPayoutRaw: "62500000",
      entryPriceBps: 1_600,
      combinedOdds: 6.25,
      markBps: 4_000,
      valueRaw: "25000000",
      pnlRaw: "15000000",
      verdict: { kind: "pending", won: 2, lost: 0, void: 0, pending: 1 },
      placedAt: null,
      settledAt: null,
      settlementPrice: null,
      source: "user",
      legs: [
        { marketId: "0x1", label: "T1", opponent: "Opp", result: "won", entryPriceBps: 5_000 },
        { marketId: "0x2", label: "T2", opponent: "Opp", result: "won", entryPriceBps: 5_000 },
        { marketId: "0x3", label: "T3", opponent: "Opp", result: "pending", entryPriceBps: 5_000 },
      ],
    };
    assert.equal(verdictLine(t), "2 of 3 won · 1 pending");
    assert.equal(
      verdictLine({ ...t, verdict: { kind: "lost", won: 1, lost: 1, void: 1, pending: 0 } }),
      "1 of 3 won · 1 lost · 1 void",
    );
    assert.equal(sumComboValueUsd([t, { ...t, status: "won" }, { ...t, valueRaw: null }]), 25);
  });
});
