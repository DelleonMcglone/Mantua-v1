/**
 * The tool results the Circle Sports Agent demo streams into the real
 * chat cards (owner, 2026-10-14): the Daily Brief, the matchup analysis,
 * the trade preview and the execution. Wire shapes are the ones
 * `features/agent/agent-cards.ts` and `CircleAgentChat.tsx` render; the
 * figures are authored for the demo and labelled illustrative on the
 * closing card. The featured game is the suite's fixture matchup
 * (Chiefs at Raiders, kickoff today) so the board and the brief agree.
 */
import type {
  AnalysisResult,
  DailyBriefResult,
  SimulationResult,
} from "../../../src/features/agent/agent-cards.ts";
import { CHIEFS_GAME } from "../../fixtures.ts";

/** The board's kickoff, so the brief's row and the home board agree. */
const kickoff = (offsetHours = 0): string =>
  new Date((CHIEFS_GAME.startsAt + offsetHours * 3600) * 1000).toISOString();

export const BRIEF: DailyBriefResult = {
  wallet: { usdcBalance: 212.4, dailyCapUsd: 25, spentTodayUsd: 0, remainingTodayUsd: 25 },
  positions: { count: 1, valueUsd: 18.6, pnlUsd: 3.1 },
  performance: { realizedPnlUsd: 41.25, winRate: 0.625, wins: 5, losses: 3 },
  policy: { status: "active", maxStakePerTradeUsd: 10 },
  markets: {
    live: [],
    upcoming: [
      { matchup: "Chiefs at Raiders", homeWinProbabilityBps: 5000, startsAt: kickoff() },
      { matchup: "Jets at Bills", homeWinProbabilityBps: 6000, startsAt: kickoff(27) },
    ],
  },
};

export const ANALYSIS: AnalysisResult & { status: "ok" } = {
  status: "ok",
  team: "Kansas City Chiefs",
  opponent: "Las Vegas Raiders",
  side: "away",
  market: { impliedProbabilityBps: 5000, liquidityUsdc: 6200 },
  analysis: {
    probabilityBps: 5700,
    discrepancyBps: 700,
    confidence: "medium",
    evidence: [
      { factor: "Form", detail: "KC 3-1 in its last four, LV 1-3", effectBps: 400 },
      {
        factor: "Injuries",
        detail: "LV lists two offensive-line starters questionable",
        effectBps: 200,
      },
      { factor: "Head to head", detail: "KC has won the last five meetings", effectBps: 100 },
    ],
    riskFactors: ["Division game on the road", "Four-game sample"],
    suggestedAction: { kind: "consider_buy_yes", rationale: "Market underprices Kansas City" },
  },
};

export const SIMULATION: SimulationResult = {
  executable: true,
  blockers: [],
  direction: "buy",
  amountRaw: "10000000",
  providerEventId: "401547401",
  outcomeIndex: 1,
  market: { tradability: "open", league: "nfl", impliedProbabilityBps: 5000 },
  estimate: {
    amountIn: "10000000",
    amountOut: "19600000",
    amountOutMinimum: "19400000",
    effectivePriceBps: 5100,
    priceImpactBps: 20,
  },
  fees: { feeUsdcRaw: "30000", feePips: 3000, playoffs: false },
  position: { afterRaw: "19600000", exposureUsd: 10 },
  walletPolicy: { ok: true, reason: null, remainingTodayUsd: 25 },
  marketPolicy: { ok: true, reason: null },
};

const TX = "0x3f8c2b7e91d4a06c5e18f2b9d7a3c4e6f0b1a2938475c6d7e8f9a0b1c2d3e4a9";
export const EXECUTION = {
  txHash: TX,
  explorer: `https://explorer.arc.io/tx/${TX}`,
  received: "19.6 Chiefs YES for $10.00",
  marketId: "401547401",
};

/** The agent wallet the panel strip shows while the demo records. */
export const AGENT_PORTFOLIO = {
  address: "0x0eea000000000000000000000000000000009c03",
  balances: [{ symbol: "USDC", balanceRaw: "212400000", decimals: 6, usdValue: 212.4 }],
  transactions: [],
  positions: [],
};
