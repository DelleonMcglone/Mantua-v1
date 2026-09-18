/**
 * Phase 11 wire shapes for the market page's deeper layer. Mirrors
 * server/src/lib/sports/market-depth-read.ts (`GET /api/markets/depth`),
 * routes/market-analysis.ts (`GET /api/markets/analysis`), and
 * lib/sports/market-history.ts (`GET /api/markets/history`).
 */
export interface DepthLevel {
  side: "buy" | "sell";
  priceBps: number;
  usdc: number;
  contracts: number;
}

export interface DepthCurve {
  liquidityUsdc: number;
  priceBps: number;
  levels: DepthLevel[];
}

export interface LiveGame {
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  period: number | null;
  clock: string | null;
  possession: string | null;
  lastPlay: string | null;
  asOf: number | null;
}

export interface DepthMetrics {
  priceBps: number | null;
  source: string | null;
  capturedAt: number | null;
  change24hBps: number | null;
  volume: { totalUsdc: number; usdc24h: number; buyCount: number; sellCount: number };
  activity: {
    fillCount: number;
    fillCount24h: number;
    uniqueTraders: number;
    lastTradeAt: number | null;
  };
  openInterest: { contractsOpen: number; positions: number; supply: number | null };
  timing: {
    startsAt: number;
    secondsToKickoff: number;
    frozenAt: number | null;
    resolvedAt: number | null;
  };
}

export type AnnotationKind = "kickoff" | "period" | "frozen" | "resolved" | "injury";

export interface ChartAnnotation {
  t: number;
  kind: AnnotationKind;
  label: string;
}

export interface MarketDepthRead {
  hasMarkets: boolean;
  game: LiveGame;
  metrics: DepthMetrics | null;
  depth: DepthCurve | null;
  annotations: ChartAnnotation[];
  computedAt: number;
}

export interface EvidenceItem {
  factor: string;
  detail: string;
  effectBps: number;
}

export interface SportsAnalysis {
  probabilityBps: number;
  method: string;
  evidence: EvidenceItem[];
  riskFactors: string[];
  discrepancyBps: number | null;
  confidence: "low" | "medium" | "high";
  suggestedAction: {
    kind: "consider_buy_yes" | "consider_fade" | "hold" | "no_market_price";
    rationale: string;
  };
  disclaimers: string[];
}

export interface AnalysisRead {
  status: string;
  side: "home" | "away";
  team: string;
  opponent: string;
  market: { impliedProbabilityBps: number | null; liquidityUsdc: number | null } | null;
  analysis: SportsAnalysis;
}

export interface HistoryTeam {
  key: string | null;
  name: string;
  abbreviation: string | null;
}

export interface HistoryRow {
  league: string;
  providerEventId: string;
  home: HistoryTeam;
  away: HistoryTeam;
  startsAt: number;
  homeScore: number | null;
  awayScore: number | null;
  state: string;
  resolvedAt: number | null;
  outcome: { winningOutcomeIndex: 0 | 1 | null; method: string | null; label: string };
  settlementPriceBps: number | null;
  path: { t: number; priceBps: number }[];
}

export interface HistoryResponse {
  rows: HistoryRow[];
  fetchedAt: number;
}
