import type { ForecastAction, ForecastSource, NewForecastRow } from "../../db/schema/forecasts.ts";

/**
 * A ledger row from the analyze tool's output (`mantua_analyze_market`),
 * pure. The tool already carries everything a forecast needs — the
 * probability and confidence, the book line and pool price it was formed
 * against, and the facts it read — so the row is a projection of that
 * output plus who asked and why.
 */
export interface ForecastContext {
  userId: string | null;
  sessionId: string | null;
  source: ForecastSource;
  action: ForecastAction;
  tradeId?: string | null;
  modelVersion: string;
  /** The tool call that produced the analysis, kept with the inputs. */
  tool: { name: string; args: unknown };
}

/** The inputs snapshot is bounded so one row cannot carry a whole season. */
export const SNAPSHOT_MAX_CHARS = 16_000;

type AnalyzeOutput = Record<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Null when the output is not a successful analysis (the tool reports
 * not_found / unavailable with no probability — nothing to record).
 */
export function forecastFromAnalysis(
  out: AnalyzeOutput,
  ctx: ForecastContext,
  now: Date,
): NewForecastRow | null {
  if (out["status"] !== "ok") return null;
  const game = out["game"] as {
    providerEventId: string;
    league: string | null;
    startsAt: string;
  };
  const analysis = out["analysis"] as {
    probabilityBps: number;
    confidence: string;
    method?: string;
    evidence?: unknown;
    riskFactors?: unknown;
    suggestedAction?: unknown;
  };
  const market = out["market"] as {
    marketId?: unknown;
    outcomeIndex?: unknown;
    impliedProbabilityBps?: unknown;
    liquidityUsdc?: unknown;
  } | null;
  const book = out["bookLine"] as { impliedProbabilityBps?: unknown; source?: unknown } | null;
  const side = out["side"] === "away" ? 1 : 0;
  const startsAt = new Date(game.startsAt);
  const liquidity = num(market?.liquidityUsdc);
  const snapshot = boundedSnapshot({
    tool: ctx.tool,
    inputs: out["inputs"],
    evidence: analysis.evidence ?? null,
    riskFactors: analysis.riskFactors ?? null,
    method: analysis.method ?? null,
    suggestedAction: analysis.suggestedAction ?? null,
    bookSource: typeof book?.source === "string" ? book.source : null,
  });
  return {
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    marketId:
      typeof market?.marketId === "string" && market.marketId !== "" ? market.marketId : null,
    providerEventId: game.providerEventId,
    league: game.league,
    eventStartsAt: startsAt,
    outcomeIndex: typeof market?.outcomeIndex === "number" ? market.outcomeIndex : side,
    outcomeLabel: `${String(out["team"])} win`,
    agentProbabilityBps: analysis.probabilityBps,
    confidence: analysis.confidence,
    referenceBookBps: num(book?.impliedProbabilityBps),
    referencePoolBps: num(market?.impliedProbabilityBps),
    liquidityUsdc: liquidity === null ? null : liquidity.toFixed(6),
    source: ctx.source,
    action: ctx.action,
    tradeId: ctx.tradeId ?? null,
    modelVersion: ctx.modelVersion,
    inputsSnapshot: snapshot,
    afterKickoff: now.getTime() >= startsAt.getTime(),
    createdAt: now,
  };
}

/** Drops the bulkiest part (the raw inputs) when the snapshot would exceed the cap. */
export function boundedSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(snapshot).length <= SNAPSHOT_MAX_CHARS) return snapshot;
  const { inputs: _inputs, ...rest } = snapshot;
  return { ...rest, inputs: null, truncated: true };
}
