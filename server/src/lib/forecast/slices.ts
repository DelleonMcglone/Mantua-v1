import { scoreRecords, type Metrics, type ScoredRecord } from "./scoring.ts";

/**
 * The breakdowns, pure. The key comparison is all forecasts vs. trades
 * only: it shows whether the agent is better at choosing which markets to
 * act on than at forecasting overall.
 *
 * A proposal's follow-up rows (filled / rejected / unfilled) repeat the
 * proposal's view, so "all forecasts" counts each view once: every
 * no_trade and proposed row, plus a fill that had no proposal (autonomous).
 */
export const PROPOSAL_ACTIONS: ReadonlySet<string> = new Set([
  "proposed",
  "rejected_by_user",
  "unfilled",
  "filled",
]);

const viewKey = (r: ScoredRecord) =>
  `${r.sessionId ?? ""}|${r.providerEventId}|${String(r.outcomeIndex)}`;

export function uniqueViews(records: readonly ScoredRecord[]): ScoredRecord[] {
  const proposed = new Set(records.filter((r) => r.action === "proposed").map(viewKey));
  return records.filter(
    (r) =>
      r.action === "no_trade" ||
      r.action === "proposed" ||
      (r.action === "filled" && !proposed.has(viewKey(r))),
  );
}

export function horizonBucket(r: Pick<ScoredRecord, "eventStartsAt" | "createdAt">): string {
  const hours = (r.eventStartsAt.getTime() - r.createdAt.getTime()) / 3_600_000;
  if (hours < 2) return "<2h";
  if (hours < 24) return "2-24h";
  if (hours < 72) return "24-72h";
  return "72h+";
}

export function liquidityBucket(liquidityUsdc: number | null): string {
  if (liquidityUsdc === null) return "no_market";
  if (liquidityUsdc < 25) return "thin";
  if (liquidityUsdc < 250) return "shallow";
  if (liquidityUsdc < 1000) return "medium";
  return "deep";
}

export function sliceBy(
  records: readonly ScoredRecord[],
  key: (r: ScoredRecord) => string,
): Record<string, Metrics> {
  const groups = new Map<string, ScoredRecord[]>();
  for (const r of records) {
    const k = key(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return Object.fromEntries([...groups.entries()].sort().map(([k, g]) => [k, scoreRecords(g)]));
}

export interface SliceReport {
  all: Metrics;
  tradesOnly: Metrics;
  proposed: Metrics;
  notProposed: Metrics;
  byLeague: Record<string, Metrics>;
  byHorizon: Record<string, Metrics>;
  byLiquidity: Record<string, Metrics>;
  byConfidence: Record<string, Metrics>;
  byModelVersion: Record<string, Metrics>;
}

export function sliceReport(records: readonly ScoredRecord[]): SliceReport {
  const views = uniqueViews(records);
  return {
    all: scoreRecords(views),
    tradesOnly: scoreRecords(records.filter((r) => r.action === "filled")),
    proposed: scoreRecords(views.filter((r) => PROPOSAL_ACTIONS.has(r.action))),
    notProposed: scoreRecords(views.filter((r) => !PROPOSAL_ACTIONS.has(r.action))),
    byLeague: sliceBy(views, (r) => r.league ?? "unknown"),
    byHorizon: sliceBy(views, horizonBucket),
    byLiquidity: sliceBy(views, (r) => liquidityBucket(r.liquidityUsdc)),
    byConfidence: sliceBy(views, (r) => r.confidence ?? "none"),
    byModelVersion: sliceBy(views, (r) => r.modelVersion),
  };
}
