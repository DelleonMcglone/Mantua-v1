import type { ScoredRecord } from "./scoring.ts";

/**
 * Human-in-the-loop health, pure: for each proposal the user saw, what they
 * decided and how long it took, so confirmation turning into a
 * rubber-stamp click is visible (a high approval rate with a very short
 * median time).
 */
export interface HitlReport {
  proposals: number;
  approved: number;
  rejected: number;
  unfilled: number;
  pending: number;
  /** approved / (approved + rejected); null with no decisions. */
  approvalRate: number | null;
  medianTimeToApproveMs: number | null;
  medianTimeToRejectMs: number | null;
}

type Row = Pick<
  ScoredRecord,
  "sessionId" | "providerEventId" | "outcomeIndex" | "action" | "createdAt"
>;

const key = (r: Row) => `${r.sessionId ?? ""}|${r.providerEventId}|${String(r.outcomeIndex)}`;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function hitlReport(rows: readonly Row[]): HitlReport {
  const decisions = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.action === "proposed") continue;
    const k = key(r);
    const g = decisions.get(k);
    if (g) g.push(r);
    else decisions.set(k, [r]);
  }
  const out: HitlReport = {
    proposals: 0,
    approved: 0,
    rejected: 0,
    unfilled: 0,
    pending: 0,
    approvalRate: null,
    medianTimeToApproveMs: null,
    medianTimeToRejectMs: null,
  };
  const approveMs: number[] = [];
  const rejectMs: number[] = [];
  for (const p of rows) {
    if (p.action !== "proposed") continue;
    out.proposals += 1;
    const later = (decisions.get(key(p)) ?? [])
      .filter((d) => d.createdAt.getTime() >= p.createdAt.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .at(0);
    if (!later) out.pending += 1;
    else if (later.action === "filled") {
      out.approved += 1;
      approveMs.push(later.createdAt.getTime() - p.createdAt.getTime());
    } else if (later.action === "rejected_by_user") {
      out.rejected += 1;
      rejectMs.push(later.createdAt.getTime() - p.createdAt.getTime());
    } else out.unfilled += 1;
  }
  const decided = out.approved + out.rejected;
  out.approvalRate = decided === 0 ? null : out.approved / decided;
  out.medianTimeToApproveMs = median(approveMs);
  out.medianTimeToRejectMs = median(rejectMs);
  return out;
}
