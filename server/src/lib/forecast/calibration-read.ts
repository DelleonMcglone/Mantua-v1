import { desc, eq, gte } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { forecastOutcomes, forecasts } from "../../db/schema/forecasts.ts";
import type { ScoredRecord } from "./scoring.ts";

/** The ledger joined to its outcomes, newest first, bounded. */
export const READ_LIMIT = 20_000;

export async function readScoredRecords(
  db: DB,
  opts: { since?: Date; limit?: number } = {},
): Promise<ScoredRecord[]> {
  const q = db
    .select({ f: forecasts, o: forecastOutcomes })
    .from(forecasts)
    .leftJoin(forecastOutcomes, eq(forecastOutcomes.marketId, forecasts.marketId))
    .orderBy(desc(forecasts.createdAt))
    .limit(opts.limit ?? READ_LIMIT);
  const rows = opts.since ? await q.where(gte(forecasts.createdAt, opts.since)) : await q;
  return rows.map(({ f, o }) => {
    const settled = o !== null && o.settledAt !== null;
    const voided = settled && o.voided;
    const outcome: 0 | 1 | null =
      settled && !voided && o.winningOutcomeIndex !== null
        ? o.winningOutcomeIndex === f.outcomeIndex
          ? 1
          : 0
        : null;
    return {
      id: f.id,
      sessionId: f.sessionId,
      marketId: f.marketId,
      providerEventId: f.providerEventId,
      league: f.league,
      eventStartsAt: f.eventStartsAt,
      createdAt: f.createdAt,
      outcomeIndex: f.outcomeIndex,
      agentBps: f.agentProbabilityBps,
      referenceBookBps: f.referenceBookBps,
      referencePoolBps: f.referencePoolBps,
      closingBps: o === null ? null : (o.closingBookBps ?? o.closingPoolBps),
      liquidityUsdc: f.liquidityUsdc === null ? null : Number(f.liquidityUsdc),
      confidence: f.confidence,
      source: f.source,
      action: f.action,
      modelVersion: f.modelVersion,
      afterKickoff: f.afterKickoff,
      outcome,
      voided,
    };
  });
}

const csvCell = (v: string | number | boolean | Date | null | undefined) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_COLUMNS = [
  "forecast_id",
  "created_at",
  "session_id",
  "market_id",
  "provider_event_id",
  "league",
  "event_starts_at",
  "outcome_index",
  "agent_probability_bps",
  "confidence",
  "reference_book_bps",
  "reference_pool_bps",
  "closing_bps",
  "liquidity_usdc",
  "source",
  "action",
  "model_version",
  "after_kickoff",
  "outcome",
  "voided",
] as const;

/** The ledger as CSV, oldest first, one line per record. */
export function forecastsCsv(records: readonly ScoredRecord[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of [...records].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    lines.push(
      [
        r.id,
        r.createdAt,
        r.sessionId,
        r.marketId,
        r.providerEventId,
        r.league,
        r.eventStartsAt,
        r.outcomeIndex,
        r.agentBps,
        r.confidence,
        r.referenceBookBps,
        r.referencePoolBps,
        r.closingBps,
        r.liquidityUsdc,
        r.source,
        r.action,
        r.modelVersion,
        r.afterKickoff,
        r.outcome,
        r.voided,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
