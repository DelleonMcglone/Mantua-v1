import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupByDay, metaLine, type ActivityItem } from "../activity/activity-core.ts";
import { sumComboValueUsd, verdictLine, type ComboTicket } from "../combos/combo-ticket-core.ts";
import {
  aggregateHoldings,
  groupPositionsByGame,
  payoutLine,
  settledLine,
  settledOutcome,
  sumMarketValueUsd,
  sumUsd,
  type MarketPositionRow,
  type SettledRow,
} from "./portfolio-core.ts";
import type { PortfolioEconomics } from "./use-portfolio-economics.ts";

/**
 * Phase 9 / PF-013 — one user with assets, an LP position, market
 * positions, an active agent and a hedge: every portfolio section derives
 * non-empty, real-data output from the server's wire shapes. The fixtures
 * are the exact shapes the routes return (typed against the hooks), so a
 * drift in a route's response fails here before it fails on screen.
 */

const NOW = new Date(2026, 8, 12, 20, 0, 0).getTime();
const iso = (hoursAgo: number): string => new Date(NOW - hoursAgo * 3_600_000).toISOString();

// GET /api/portfolio — balances with USD values.
const walletBalances = [
  { symbol: "USDC", balance: "120.5", usdValue: 120.5 },
  { symbol: "EURC", balance: "10", usdValue: 11 },
];
// GET /api/agent/portfolio
const agentBalances = [{ symbol: "USDC", balance: "30", usdValue: 30 }];
// GET /api/agent/unified-balance
const unified = { totalUsdc: "25.00" };
// GET /api/markets/positions?address=<user>
const userPositions: MarketPositionRow[] = [
  {
    marketId: "0xm1",
    outcomeIndex: 0,
    label: "Atlanta Falcons to beat New Orleans Saints",
    state: "OPEN",
    side: "yes",
    balance: "16000000",
    impliedProbBps: 6600,
    valueRaw: "10560000",
    league: "nfl",
    providerEventId: "401",
    entryPriceBps: 6250,
    pnlRaw: "560000",
    potentialPayoutRaw: "16000000",
  },
];
// GET /api/markets/positions?address=<agent>
const agentPositions: MarketPositionRow[] = [
  {
    marketId: "0xm2",
    outcomeIndex: 1,
    label: "New York Jets to beat New York Giants",
    state: "OPEN",
    side: "yes",
    balance: "5000000",
    impliedProbBps: 4800,
    valueRaw: "2400000",
    league: "nfl",
    providerEventId: "402",
    entryPriceBps: 5000,
    pnlRaw: "-100000",
    potentialPayoutRaw: "5000000",
  },
];
// GET /api/portfolio/economics
const economics: PortfolioEconomics = {
  lp: [
    {
      tokenId: "42",
      pair: "USDC/EURC",
      hook: null,
      fee: 3000,
      amountA: "100",
      amountB: "80",
      currentValueUsd: 188,
      accruedFeesUsd: 1,
      depositedUsd: 170,
      pnlUsd: 19,
      pnlPct: 11.18,
      liquidityShareBps: 2500,
      since: iso(72),
    },
  ],
  lpTotals: {
    positions: 1,
    currentValueUsd: 188,
    accruedFeesUsd: 1,
    depositedUsd: 170,
    pnlUsd: 19,
    withoutBasis: 0,
  },
  realized: {
    marketRealizedPnlUsd: 6,
    marketWinRate: 1,
    resolvedMarkets: 1,
    openCostUsd: 13,
    bySource: { agent_chat: 1, hedge_strategy: 1, user: 2 },
    lpCollectedUsd: null,
  },
};
// GET /api/portfolio/settled
/** Task 072 — one open combo ticket, the exact `GET /api/combos` wire shape. */
const comboTickets: ComboTicket[] = [
  {
    id: "combo-1",
    status: "open",
    label: "Falcons + Chiefs",
    marketId: "0xc1",
    stakeRaw: "10000000",
    sharesRaw: "40000000",
    potentialPayoutRaw: "40000000",
    entryPriceBps: 2500,
    combinedOdds: 4,
    markBps: 6250,
    valueRaw: "25000000",
    pnlRaw: "15000000",
    verdict: { kind: "pending", won: 1, lost: 0, void: 0, pending: 1 },
    placedAt: iso(2),
    settledAt: null,
    settlementPrice: null,
    source: "agent",
    legs: [
      {
        marketId: "0xm1",
        label: "Atlanta Falcons",
        opponent: "New Orleans Saints",
        result: "won",
        entryPriceBps: 5000,
      },
      {
        marketId: "0xm3",
        label: "Kansas City Chiefs",
        opponent: "Las Vegas Raiders",
        result: "pending",
        entryPriceBps: 5000,
      },
    ],
  },
];

const settled: SettledRow[] = [
  {
    marketId: "0xwin",
    label: "Falcons to beat Saints",
    league: "nfl",
    status: "resolved_win",
    costUsd: 10,
    proceedsUsd: 0,
    payoutUsd: 16,
    realizedPnlUsd: 6,
    resolvedAt: iso(5),
    redeemed: true,
    attribution: ["user"],
  },
];
// GET /api/strategies + GET /api/activity?kind=hedge
const strategies = [{ id: "stg_1", strategyType: "stop", status: "executed", capUsd: "25" }];
const activity: ActivityItem[] = [
  {
    id: "a1",
    kind: "market_buy",
    category: "trade",
    status: "completed",
    actor: "user",
    summary: "bought 16.00 YES for $10.00",
    asset: "YES",
    amountRaw: "16000000",
    valueUsd: 10,
    marketId: "0xm1",
    poolId: null,
    positionRef: null,
    txHash: `0x${"a".repeat(64)}`,
    data: {},
    createdAt: iso(2),
    updatedAt: iso(2),
  },
  {
    id: "a2",
    kind: "hedge",
    category: "trade",
    status: "completed",
    actor: "agent",
    summary: "Agent hedged stop ($3.00)",
    asset: "stop",
    amountRaw: "4000000",
    valueUsd: 3,
    marketId: "0xm2",
    poolId: null,
    positionRef: "stg_1",
    txHash: `0x${"b".repeat(64)}`,
    data: {},
    createdAt: iso(1),
    updatedAt: iso(1),
  },
  {
    id: "a3",
    kind: "settlement",
    category: "settlement",
    status: "completed",
    actor: "system",
    summary: "Market settled — YES side ($16.00)",
    asset: "YES side",
    amountRaw: "16000000",
    valueUsd: 16,
    marketId: "0xwin",
    poolId: null,
    positionRef: "pos_1",
    txHash: null,
    data: {},
    createdAt: iso(30),
    updatedAt: iso(30),
  },
];

void describe("PF-013 — every portfolio section renders real data for one composed user", () => {
  void it("§1 assets: the holdings aggregate counts every source", () => {
    const h = aggregateHoldings({
      userWalletUsd: sumUsd(walletBalances),
      agentWalletUsd: sumUsd(agentBalances),
      unifiedBalanceUsd: Number(unified.totalUsdc),
      marketPositionsUsd: sumMarketValueUsd(userPositions) + sumMarketValueUsd(agentPositions),
      comboPositionsUsd: sumComboValueUsd(comboTickets),
      lpPositionsUsd: economics.lpTotals.currentValueUsd,
    });
    assert.equal(h.totalUsd, 412.46);
    assert.equal(h.parts.length, 6);
    assert.equal(h.parts.find((p) => p.key === "comboPositionsUsd")?.usd, 25);
    assert.deepEqual(h.missing, []);
  });

  void it("§2 / §9 liquidity and §7 earnings: the LP economics carry basis, fees, P&L and share", () => {
    const p = economics.lp[0];
    assert.ok(p);
    assert.equal(p.pnlUsd, 19);
    assert.equal(p.liquidityShareBps, 2500);
    assert.equal(economics.realized.marketRealizedPnlUsd, 6);
    assert.equal(economics.realized.lpCollectedUsd, null, "not tracked — stated, not zero");
  });

  void it("§3 market positions: grouped by game with payout; §5 agent positions from the agent address", () => {
    const user = groupPositionsByGame(userPositions);
    assert.equal(user[0]?.label, "Atlanta Falcons vs New Orleans Saints");
    assert.equal(payoutLine(userPositions[0]), "pays $16.00 if it wins");
    const agent = groupPositionsByGame(agentPositions);
    assert.equal(agent[0]?.rows[0]?.marketId, "0xm2");
    assert.equal(agent[0]?.potentialPayoutUsd, 5);
  });

  void it("§ combos (task 072): the ticket carries its legs, verdict and mark, and counts in holdings", () => {
    const t = comboTickets[0];
    assert.equal(verdictLine(t), "1 of 2 won · 1 pending");
    assert.equal(t.legs.map((l) => l.result).join(","), "won,pending");
    assert.equal(sumComboValueUsd(comboTickets), 25);
  });

  void it("§10 hedging: the executed strategy resolves to its hedge entry with value and market", () => {
    const hedgeByStrategy = new Map(
      activity.filter((a) => a.kind === "hedge").map((h) => [h.positionRef, h]),
    );
    const h = hedgeByStrategy.get(strategies[0].id);
    assert.ok(h);
    assert.equal(h.valueUsd, 3);
    assert.equal(h.marketId, "0xm2");
  });

  void it("settled history: realized result and claim status", () => {
    const r = settled[0];
    assert.deepEqual(settledOutcome(r), { label: "Won", tone: "win" });
    assert.equal(settledLine(r), "cost $10.00 · paid $16.00 · +$6.00");
    assert.equal(r.redeemed, true);
  });

  void it("activity: the user trade, the hedge and the settlement all appear on the timeline", () => {
    const groups = groupByDay(activity, NOW);
    assert.equal(groups.length, 2);
    const kinds = activity.map((a) => a.kind).sort();
    assert.deepEqual(kinds, ["hedge", "market_buy", "settlement"]);
    assert.equal(metaLine(activity[1]), "4 stop · $3.00 · by your agent");
  });
});
