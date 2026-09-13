/**
 * Task 067 (G-016) — the kill-switch drill from the incident runbook §13 as
 * data: what each poll of the deployment means, when the drill passes, and
 * the log the observer files. `scripts/kill-switch-drill.ts` drives a real
 * host through this; the rules live here so they are tested.
 */
export const DRILL_LIMIT_MS = 20_000;

/** One look at the deployment. */
export interface DrillPoll {
  at: number;
  /** HTTP status of an empty POST to the write path. */
  writeCode: number | null;
  /** The write path's error code, when JSON. */
  writeErrorCode: string | null;
  /** `/api/status` as read at the same moment. */
  status: { killSwitch: boolean; trading: string } | null;
}

export type WritePath = "engaged" | "open" | "unknown";

/** The write path is engaged only on the kill switch's own refusal. */
export function classifyWrite(poll: DrillPoll): WritePath {
  if (poll.writeCode === null) return "unknown";
  if (poll.writeCode === 503 && poll.writeErrorCode === "KILL_SWITCH_ACTIVE") return "engaged";
  if (poll.writeCode === 503) return "unknown";
  return "open";
}

export interface DrillRecord {
  host: string;
  commit: string;
  operator: string;
  observer: string;
  t0: number;
  t1: number | null;
  t2: number | null;
  t3: number | null;
  clientPaused: boolean | null;
  cron503: boolean | null;
  t6: number | null;
  t7: number | null;
  clientResumed: boolean | null;
}

export interface DrillVerdict {
  pass: boolean;
  reasons: string[];
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** Every §13 expectation, each failure named. */
export function judge(r: DrillRecord): DrillVerdict {
  const reasons: string[] = [];
  if (r.t1 === null || r.t2 === null) reasons.push("write path never refused after engage");
  else if (r.t2 - r.t1 > DRILL_LIMIT_MS)
    reasons.push(`engage took ${seconds(r.t2 - r.t1)} (limit ${seconds(DRILL_LIMIT_MS)})`);
  if (r.t3 === null) reasons.push("/api/status never reported the kill switch");
  if (r.clientPaused !== true) reasons.push("client did not pause without a reload");
  if (r.cron503 === false) reasons.push("a money cron ran while engaged");
  if (r.t6 === null || r.t7 === null) reasons.push("write path never reopened after release");
  else if (r.t7 - r.t6 > DRILL_LIMIT_MS)
    reasons.push(`release took ${seconds(r.t7 - r.t6)} (limit ${seconds(DRILL_LIMIT_MS)})`);
  if (r.clientResumed !== true) reasons.push("client did not resume without a reload");
  return { pass: reasons.length === 0, reasons };
}

const stamp = (t: number | null): string => (t === null ? "—" : new Date(t).toISOString());
const yesNo = (v: boolean | null): string => (v === null ? "not observed" : v ? "yes" : "no");
const delta = (a: number | null, b: number | null): string =>
  a === null || b === null ? "—" : seconds(b - a);

/** The §13 log, ready to commit under docs/ops/drills/. */
export function renderLog(r: DrillRecord, verdict: DrillVerdict = judge(r)): string {
  return [
    `Date / host / commit: ${stamp(r.t0).slice(0, 10)} / ${r.host} / ${r.commit}`,
    `Operator / observer: ${r.operator} / ${r.observer}`,
    `T0 status: ${stamp(r.t0)}   T1 engaged: ${stamp(r.t1)}   T2 first 503: ${stamp(r.t2)}   (T2−T1 = ${delta(r.t1, r.t2)})`,
    `T3 status paused: ${stamp(r.t3)}   T4 client paused (no reload): ${yesNo(r.clientPaused)}`,
    `Step 5 cron 503: ${yesNo(r.cron503)}`,
    `T6 released: ${stamp(r.t6)}   T7 write path open: ${stamp(r.t7)}   (T7−T6 = ${delta(r.t6, r.t7)})`,
    `Step 8 client resumed (no reload): ${yesNo(r.clientResumed)}`,
    `Result: ${verdict.pass ? "PASS" : `FAIL — ${verdict.reasons.join("; ")}`}`,
  ].join("\n");
}
