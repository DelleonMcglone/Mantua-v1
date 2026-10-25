/**
 * Task 077 — the calibration page's pure helpers: the URL, the shapes the
 * API returns (mirroring server/src/routes/calibration.ts), and the chart
 * geometry. No React, no `@/` imports, so it runs under node:test.
 */
export const CALIBRATION_PATH = "/calibration";

export function isCalibrationPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === CALIBRATION_PATH;
}

export interface ScoreSet {
  n: number;
  brier: number | null;
  logLoss: number | null;
}

export interface CalibrationBin {
  fromBps: number;
  count: number;
  meanPredictedBps: number | null;
  hitRateBps: number | null;
}

export interface Metrics {
  n: number;
  agent: ScoreSet;
  reference: ScoreSet;
  calibrationErrorBps: number | null;
  bins: CalibrationBin[];
  closingLineValue: {
    n: number;
    towardAgent: number;
    awayFromAgent: number;
    meanMoveTowardAgentBps: number | null;
  };
}

export interface CalibrationReport {
  generatedAt: number;
  totals: {
    records: number;
    views: number;
    scoreable: number;
    pending: number;
    voided: number;
    afterKickoff: number;
  };
  all: Metrics;
  tradesOnly: Metrics;
  proposed: Metrics;
  notProposed: Metrics;
  byLeague: Record<string, Metrics>;
  byHorizon: Record<string, Metrics>;
  byLiquidity: Record<string, Metrics>;
  byConfidence: Record<string, Metrics>;
  byModelVersion: Record<string, Metrics>;
  hitl: {
    proposals: number;
    approved: number;
    rejected: number;
    unfilled: number;
    pending: number;
    approvalRate: number | null;
    medianTimeToApproveMs: number | null;
    medianTimeToRejectMs: number | null;
  };
  readiness: {
    rulesVersion: string;
    passing: boolean;
    rules: { rule: string; passing: boolean; detail: string }[];
    nextCapUsdc: number | null;
  };
}

export const score = (v: number | null, digits = 3): string =>
  v === null ? "—" : v.toFixed(digits);

export const points = (bps: number | null): string =>
  bps === null ? "—" : `${(bps / 100).toFixed(1)}%`;

/** "says 70–80%, right 55%" — one line per band that has data. */
export function binLine(b: CalibrationBin): string {
  const lo = b.fromBps / 100;
  return `says ${String(lo)}–${String(lo + 10)}%, right ${points(b.hitRateBps)} (${String(b.count)})`;
}

export function minutes(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 60_000) return `${String(Math.round(ms / 1000))}s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/**
 * Reliability-diagram geometry: one dot per band with data at (mean
 * predicted, hit rate) inside a square of side `size`, plus the diagonal.
 */
export function reliabilityDots(
  bins: readonly CalibrationBin[],
  size: number,
): { x: number; y: number; r: number; label: string }[] {
  const max = Math.max(1, ...bins.map((b) => b.count));
  return bins
    .filter((b) => b.count > 0 && b.meanPredictedBps !== null && b.hitRateBps !== null)
    .map((b) => ({
      x: ((b.meanPredictedBps ?? 0) / 10_000) * size,
      y: size - ((b.hitRateBps ?? 0) / 10_000) * size,
      r: 3 + 5 * Math.sqrt(b.count / max),
      label: binLine(b),
    }));
}
