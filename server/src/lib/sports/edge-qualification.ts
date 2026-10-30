/**
 * Reliability Goal 4 (owner brief, 2026-10-30) — a model–market gap is a
 * candidate discrepancy, never an edge, until every condition below holds.
 *
 *   no_market  — no Mantua pool for this side: nothing can be executed.
 *   none       — a pool exists and the estimate sits inside the threshold.
 *   candidate  — the estimate disagrees with the pool, but at least one
 *                qualification is missing (listed in `blockers`).
 *   qualified  — the gap clears the threshold on a fresh, liquid pool price
 *                AND the model version has a scored track record on the
 *                ledger that beats the reference.
 *
 * The sportsbook line is a reference only: a gap against it never
 * qualifies anything, because no Mantua trade executes at that price.
 */

export interface CalibrationStatus {
  modelVersion: string;
  /** Settled, scoreable ledger records for this model version. */
  settled: number;
  agentBrier: number | null;
  referenceBrier: number | null;
}

export interface EdgeInput {
  probabilityBps: number;
  poolBps: number | null;
  poolAgeSeconds: number | null;
  liquidityUsdc: number | null;
  bookBps: number | null;
  calibration: CalibrationStatus | null;
  thresholdBps: number;
  /** Fee the hook charges on a fill, bps of notional; null when unknown. */
  feeBps?: number | null;
}

export type EdgeStatus = "no_market" | "none" | "candidate" | "qualified";

export interface EdgeQualification {
  status: EdgeStatus;
  gapVsPoolBps: number | null;
  gapVsBookBps: number | null;
  blockers: string[];
  summary: string;
}

export const MIN_SETTLED_FOR_EDGE = 30;
export const MAX_POOL_AGE_S = 15 * 60;
export const MIN_LIQUIDITY_USDC = 500;

export function qualifyEdge(i: EdgeInput): EdgeQualification {
  const gapVsBookBps = i.bookBps === null ? null : i.probabilityBps - i.bookBps;
  if (i.poolBps === null) {
    return {
      status: "no_market",
      gapVsPoolBps: null,
      gapVsBookBps,
      blockers: ["no Mantua market for this side — nothing can be executed"],
      summary:
        gapVsBookBps === null
          ? "No Mantua market and no reference line: nothing to compare, nothing to trade."
          : `No Mantua market: the ${String(Math.abs(gapVsBookBps))} bps gap to the sportsbook reference is a candidate discrepancy only; no Mantua trade can be executed.`,
    };
  }
  const gapVsPoolBps = i.probabilityBps - i.poolBps;
  if (Math.abs(gapVsPoolBps) < i.thresholdBps) {
    return {
      status: "none",
      gapVsPoolBps,
      gapVsBookBps,
      blockers: [],
      summary: `Estimate and pool are within ${String(i.thresholdBps)} bps: no discrepancy to act on.`,
    };
  }
  const blockers: string[] = [];
  if (i.poolAgeSeconds === null || i.poolAgeSeconds > MAX_POOL_AGE_S)
    blockers.push("pool price is stale or unknown");
  if (i.liquidityUsdc === null || i.liquidityUsdc < MIN_LIQUIDITY_USDC)
    blockers.push("pool is thin or depth unknown — impact would eat the gap");
  const c = i.calibration;
  if (!c || c.settled < MIN_SETTLED_FOR_EDGE)
    blockers.push(
      `forecast is uncalibrated: ${String(c?.settled ?? 0)} settled records for this model version (needs ${String(MIN_SETTLED_FOR_EDGE)})`,
    );
  else if (c.agentBrier === null || c.referenceBrier === null || c.agentBrier > c.referenceBrier)
    blockers.push("forecast has not beaten the reference line on settled games");
  if (i.feeBps !== null && i.feeBps !== undefined && Math.abs(gapVsPoolBps) <= i.feeBps)
    blockers.push("gap does not cover the fee");
  const status: EdgeStatus = blockers.length === 0 ? "qualified" : "candidate";
  const dir = gapVsPoolBps > 0 ? "cheap" : "rich";
  return {
    status,
    gapVsPoolBps,
    gapVsBookBps,
    blockers,
    summary:
      status === "qualified"
        ? `Qualified: the pool looks ${String(Math.abs(gapVsPoolBps))} bps ${dir} against a calibrated forecast; still size through the simulator and the user's confirm.`
        : `Candidate discrepancy only: the pool looks ${String(Math.abs(gapVsPoolBps))} bps ${dir}, but ${blockers.join("; ")}. Do not call this value.`,
  };
}
