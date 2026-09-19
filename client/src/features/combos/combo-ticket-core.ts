/**
 * Task 072 / CB-008 — the pure half of the combo positions section: the
 * wire shape of `GET /api/combos` tickets, the status and leg wording,
 * and the holdings part. No React, so it runs under node:test.
 */
import type { LegResult } from "./combo-core.ts";

export const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  dead: "Dead — a leg lost",
  closed: "Sold",
  won: "Won",
  lost: "Lost",
  void: "Void",
  draft: "Draft",
};

export const LEG_LABELS: Record<LegResult, string> = {
  pending: "pending",
  won: "won",
  lost: "lost",
  void: "void",
};

export interface ComboTicket {
  id: string;
  status: string;
  label: string;
  marketId: string;
  stakeRaw: string;
  sharesRaw: string;
  potentialPayoutRaw: string;
  entryPriceBps: number | null;
  combinedOdds: number | null;
  markBps: number | null;
  valueRaw: string | null;
  pnlRaw: string | null;
  verdict: { kind: string; won: number; lost: number; void: number; pending: number };
  placedAt: string | null;
  settledAt: string | null;
  settlementPrice: number | null;
  source: string;
  legs: {
    marketId: string;
    label: string;
    opponent: string | null;
    result: LegResult;
    entryPriceBps: number | null;
  }[];
}

/** "2 of 3 won · 1 pending" */
export function verdictLine(t: Pick<ComboTicket, "verdict" | "legs">): string {
  const v = t.verdict;
  const parts = [`${String(v.won)} of ${String(t.legs.length)} won`];
  if (v.lost > 0) parts.push(`${String(v.lost)} lost`);
  if (v.void > 0) parts.push(`${String(v.void)} void`);
  if (v.pending > 0) parts.push(`${String(v.pending)} pending`);
  return parts.join(" · ");
}

/** Marked value of the open tickets, dollars — the holdings aggregate's part. */
export function sumComboValueUsd(tickets: readonly ComboTicket[]): number {
  let total = 0;
  for (const t of tickets) {
    if ((t.status === "open" || t.status === "dead") && t.valueRaw !== null) {
      total += Number(t.valueRaw) / 1e6;
    }
  }
  return Number(total.toFixed(2));
}
