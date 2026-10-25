/**
 * Scoring the ledger, pure. A record is scoreable once its market settled
 * to a winner, it was logged before kickoff, and the market was not voided.
 * The agent only has an edge if it beats the reference price (the
 * de-vigged book line, else the pool price) on the same records, so every
 * score is computed for both.
 */
export interface ScoredRecord {
  id: string;
  sessionId: string | null;
  marketId: string | null;
  providerEventId: string;
  league: string | null;
  eventStartsAt: Date;
  createdAt: Date;
  outcomeIndex: number;
  agentBps: number;
  referenceBookBps: number | null;
  referencePoolBps: number | null;
  /** The side's closing reference (book, else pool), from the outcome row. */
  closingBps: number | null;
  liquidityUsdc: number | null;
  confidence: string | null;
  source: string;
  action: string;
  modelVersion: string;
  afterKickoff: boolean;
  /** 1 won, 0 lost, null while open or when voided. */
  outcome: 0 | 1 | null;
  voided: boolean;
}

export interface CalibrationBin {
  /** Lower edge of the band in bps (0, 1000, … 9000). */
  fromBps: number;
  count: number;
  meanPredictedBps: number | null;
  hitRateBps: number | null;
}

export interface ScoreSet {
  n: number;
  brier: number | null;
  logLoss: number | null;
}

export interface Metrics {
  n: number;
  agent: ScoreSet;
  reference: ScoreSet;
  /** Mean absolute gap between predicted and actual across bins, weighted by count. */
  calibrationErrorBps: number | null;
  bins: CalibrationBin[];
  closingLineValue: {
    n: number;
    towardAgent: number;
    awayFromAgent: number;
    /** Mean closing move in the agent's direction, bps (positive = the line came toward the agent). */
    meanMoveTowardAgentBps: number | null;
  };
}

const EPS = 1e-6;
const clamp = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));

export function referenceBpsOf(
  r: Pick<ScoredRecord, "referenceBookBps" | "referencePoolBps">,
): number | null {
  return r.referenceBookBps ?? r.referencePoolBps;
}

export function isScoreable(r: ScoredRecord): boolean {
  return r.outcome !== null && !r.voided && !r.afterKickoff;
}

function scoreSet(pairs: readonly { p: number; y: 0 | 1 }[]): ScoreSet {
  if (pairs.length === 0) return { n: 0, brier: null, logLoss: null };
  let brier = 0;
  let ll = 0;
  for (const { p, y } of pairs) {
    brier += (p - y) ** 2;
    const q = clamp(p);
    ll -= y === 1 ? Math.log(q) : Math.log(1 - q);
  }
  return { n: pairs.length, brier: brier / pairs.length, logLoss: ll / pairs.length };
}

export function calibrationBins(records: readonly ScoredRecord[]): CalibrationBin[] {
  const bins: CalibrationBin[] = Array.from({ length: 10 }, (_, i) => ({
    fromBps: i * 1000,
    count: 0,
    meanPredictedBps: null,
    hitRateBps: null,
  }));
  const sums = bins.map(() => ({ p: 0, y: 0 }));
  for (const r of records) {
    const i = Math.min(9, Math.floor(r.agentBps / 1000));
    const b = bins[i];
    const s = sums[i];
    b.count += 1;
    s.p += r.agentBps;
    s.y += r.outcome === 1 ? 1 : 0;
  }
  return bins.map((b, i) => {
    const s = sums[i];
    if (b.count === 0) return b;
    return {
      ...b,
      meanPredictedBps: Math.round(s.p / b.count),
      hitRateBps: Math.round((s.y / b.count) * 10_000),
    };
  });
}

export function scoreRecords(input: readonly ScoredRecord[]): Metrics {
  const records = input.filter(isScoreable);
  const agent = scoreSet(records.map((r) => ({ p: r.agentBps / 10_000, y: r.outcome as 0 | 1 })));
  const withRef = records.filter((r) => referenceBpsOf(r) !== null);
  const reference = scoreSet(
    withRef.map((r) => ({ p: (referenceBpsOf(r) as number) / 10_000, y: r.outcome as 0 | 1 })),
  );
  const bins = calibrationBins(records);
  const filled = bins.filter((b) => b.count > 0);
  const total = filled.reduce((n, b) => n + b.count, 0);
  const calibrationErrorBps =
    total === 0
      ? null
      : Math.round(
          filled.reduce(
            (acc, b) =>
              acc + (b.count * Math.abs((b.meanPredictedBps ?? 0) - (b.hitRateBps ?? 0))) / total,
            0,
          ),
        );
  let toward = 0;
  let away = 0;
  let moveSum = 0;
  let moveN = 0;
  for (const r of records) {
    const ref = referenceBpsOf(r);
    if (ref === null || r.closingBps === null) continue;
    const dir = Math.sign(r.agentBps - ref);
    const move = r.closingBps - ref;
    if (dir === 0 || move === 0) continue;
    moveN += 1;
    moveSum += move * dir;
    if (Math.sign(move) === dir) toward += 1;
    else away += 1;
  }
  return {
    n: records.length,
    agent,
    reference,
    calibrationErrorBps,
    bins,
    closingLineValue: {
      n: moveN,
      towardAgent: toward,
      awayFromAgent: away,
      meanMoveTowardAgentBps: moveN === 0 ? null : Math.round(moveSum / moveN),
    },
  };
}
