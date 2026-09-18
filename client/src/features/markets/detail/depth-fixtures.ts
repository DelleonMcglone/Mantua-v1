/**
 * Phase 11 (D-008) — the deeper layer's wire shapes, shared by the browser
 * suite (client/e2e/harness.ts) and the composed node test:
 * `GET /api/markets/depth`, `/analysis`, and `/history`, mirroring
 * server/src/lib/sports/market-depth-read.ts, routes/market-analysis.ts,
 * and lib/sports/market-history.ts.
 */
const NOW = Math.floor(Date.now() / 1000);

export const DEPTH_LEVELS = [
  { side: "buy", priceBps: 5100, usdc: 50.25, contracts: 99.02 },
  { side: "buy", priceBps: 5500, usdc: 260.1, contracts: 490.5 },
  { side: "sell", priceBps: 4900, usdc: 49.75, contracts: 101.02 },
  { side: "sell", priceBps: 4500, usdc: 259.9, contracts: 550.4 },
];

/** A live, traded Chiefs–Raiders market with a play ingested. */
export function depthRead(opts: { live?: boolean } = {}) {
  const live = opts.live ?? true;
  return {
    hasMarkets: true,
    game: {
      status: live ? "in_progress" : "scheduled",
      homeScore: live ? 10 : null,
      awayScore: live ? 14 : null,
      period: live ? 2 : null,
      clock: live ? "07:12" : null,
      possession: live ? "nfl:KC" : null,
      lastPlay: live ? "Mahomes pass complete for 12 yards" : null,
      asOf: live ? NOW - 45 : null,
    },
    metrics: {
      priceBps: 5000,
      source: "pool",
      capturedAt: NOW - 30,
      change24hBps: 250,
      volume: { totalUsdc: 12_345, usdc24h: 987.5, buyCount: 30, sellCount: 12 },
      activity: { fillCount: 42, fillCount24h: 12, uniqueTraders: 9, lastTradeAt: NOW - 120 },
      openInterest: { contractsOpen: 3700, positions: 11, supply: 4000 },
      timing: { startsAt: NOW - 3600, secondsToKickoff: 0, frozenAt: null, resolvedAt: null },
    },
    depth: { liquidityUsdc: 10_000, priceBps: 5000, levels: DEPTH_LEVELS },
    annotations: live
      ? [
          { t: NOW - 3600, kind: "kickoff", label: "Kickoff" },
          { t: NOW - 1500, kind: "period", label: "Q2" },
          { t: NOW - 3000, kind: "injury", label: "KC: Chris Jones questionable" },
        ]
      : [],
    computedAt: NOW,
  };
}

export function analysisRead(outcomeIndex: 0 | 1) {
  const team = outcomeIndex === 0 ? "Las Vegas Raiders" : "Kansas City Chiefs";
  const opponent = outcomeIndex === 0 ? "Kansas City Chiefs" : "Las Vegas Raiders";
  return {
    status: "ok",
    skill: "sports_intelligence",
    side: outcomeIndex === 0 ? "home" : "away",
    team,
    opponent,
    market: { impliedProbabilityBps: 5000, liquidityUsdc: 10_000 },
    analysis: {
      probabilityBps: outcomeIndex === 0 ? 4400 : 5600,
      method: "baseline+adjustments",
      evidence: [
        { factor: "Record", detail: "11–3 vs 6–8", effectBps: outcomeIndex === 0 ? -250 : 250 },
        {
          factor: "Injuries",
          detail: "Chris Jones questionable",
          effectBps: outcomeIndex === 0 ? 100 : -100,
        },
      ],
      riskFactors: ["Thin liquidity: $10,000"],
      discrepancyBps: outcomeIndex === 0 ? -600 : 600,
      confidence: "medium",
      suggestedAction:
        outcomeIndex === 0
          ? { kind: "consider_fade", rationale: "The model favours the other side." }
          : { kind: "consider_buy_yes", rationale: "Edge above the threshold." },
      disclaimers: ["A model estimate, not a market price."],
    },
  };
}

export function historyRows() {
  return {
    rows: [
      {
        league: "nfl",
        providerEventId: "401547301",
        home: { key: "nfl:BUF", name: "Buffalo Bills", abbreviation: "BUF" },
        away: { key: "nfl:NYJ", name: "New York Jets", abbreviation: "NYJ" },
        startsAt: NOW - 7 * 86_400,
        homeScore: 27,
        awayScore: 20,
        state: "RESOLVED",
        resolvedAt: NOW - 7 * 86_400 + 4 * 3600,
        outcome: { winningOutcomeIndex: 0, method: "auto", label: "Buffalo Bills won" },
        settlementPriceBps: 10_000,
        path: [
          { t: NOW - 8 * 86_400, priceBps: 5800 },
          { t: NOW - 7 * 86_400, priceBps: 6200 },
          { t: NOW - 7 * 86_400 + 3 * 3600, priceBps: 9900 },
        ],
      },
      {
        league: "nfl",
        providerEventId: "401547302",
        home: { key: "nfl:MIA", name: "Miami Dolphins", abbreviation: "MIA" },
        away: { key: "nfl:NE", name: "New England Patriots", abbreviation: "NE" },
        startsAt: NOW - 8 * 86_400,
        homeScore: null,
        awayScore: null,
        state: "INVALID",
        resolvedAt: NOW - 8 * 86_400 + 3600,
        outcome: {
          winningOutcomeIndex: null,
          method: "void",
          label: "Voided — both sides settled at 50¢",
        },
        settlementPriceBps: 5000,
        path: [
          { t: NOW - 9 * 86_400, priceBps: 5000 },
          { t: NOW - 8 * 86_400, priceBps: 5100 },
        ],
      },
    ],
    fetchedAt: Date.now(),
  };
}
