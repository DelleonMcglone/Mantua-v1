import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analysisCard, dailyBriefCard, simulationCard } from "./agent-cards.ts";

void describe("simulationCard", () => {
  const base = {
    executable: true,
    blockers: [],
    direction: "buy" as const,
    amountRaw: "10000000",
    providerEventId: "401",
    outcomeIndex: 0 as const,
    market: { tradability: "open", league: "nfl", impliedProbabilityBps: 6000 },
    estimate: {
      amountIn: "10000000",
      amountOut: "16000000",
      amountOutMinimum: "15840000",
      effectivePriceBps: 6250,
      priceImpactBps: 250,
    },
    fees: { feeUsdcRaw: "0", feePips: 0, playoffs: false },
    position: { afterRaw: "16000000", exposureUsd: 10 },
    walletPolicy: { ok: true, reason: null, remainingTodayUsd: 90 },
    marketPolicy: { ok: true, reason: null },
  };

  void it("shapes an executable buy with a confirm offer", () => {
    const c = simulationCard(base);
    assert.equal(c.title, "Buy $10.00 of home YES");
    assert.equal(c.canConfirm, true);
    assert.deepEqual(c.rows[0], { label: "You receive", value: "~16.00 YES (min 15.84)" });
    assert.deepEqual(c.rows[1], { label: "Effective price", value: "62.5% (market 60.0%)" });
    assert.deepEqual(c.rows.at(-1), { label: "Cap remaining today", value: "$90.00" });
  });

  void it("withholds confirm and lists blockers when not executable", () => {
    const c = simulationCard({
      ...base,
      executable: false,
      blockers: ["Daily cap: …"],
      estimate: null,
    });
    assert.equal(c.canConfirm, false);
    assert.deepEqual(c.blockers, ["Daily cap: …"]);
    assert.equal(
      c.rows.some((r) => r.label === "You receive"),
      false,
    );
  });
});

void describe("analysisCard / dailyBriefCard", () => {
  void it("summarises the estimate against the market", () => {
    const c = analysisCard({
      team: "Atlanta Falcons",
      opponent: "New Orleans Saints",
      side: "home",
      market: { impliedProbabilityBps: 5500, liquidityUsdc: 2500 },
      analysis: {
        probabilityBps: 7583,
        discrepancyBps: 2083,
        confidence: "high",
        evidence: [{ factor: "venue", detail: "at home", effectBps: 250 }],
        riskFactors: ["thin pool"],
        suggestedAction: { kind: "consider_buy_yes", rationale: "" },
      },
    });
    assert.equal(c.headline, "Estimate 75.8% · market 55.0% · +20.8 pts · high confidence");
    assert.equal(c.action, "Looks cheap — consider buying YES");
    assert.deepEqual(c.evidence[0], { label: "venue", value: "+2.5 · at home" });
  });

  void it("lays out the brief rows", () => {
    const c = dailyBriefCard({
      wallet: { usdcBalance: 120.5, dailyCapUsd: 100, spentTodayUsd: 10, remainingTodayUsd: 90 },
      positions: { count: 2, valueUsd: 31.2, pnlUsd: -1.5 },
      performance: { realizedPnlUsd: 3.5, winRate: 0.5, wins: 1, losses: 1 },
      policy: { status: "active", maxStakePerTradeUsd: 25 },
      markets: {
        live: [{ matchup: "NO @ ATL", homeWinProbabilityBps: 6600, status: "live" }],
        upcoming: [],
      },
    });
    assert.equal(c.rows[0]?.value, "$120.50 USDC · $90.00 of $100.00 cap left today");
    assert.equal(c.rows[2]?.value, "+$3.50 realized · 50% win rate (1-1)");
    assert.deepEqual(c.markets[0], { label: "LIVE", value: "NO @ ATL · home 66.0%" });
  });
});
