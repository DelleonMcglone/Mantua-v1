/**
 * Task 073 / IC-002 — the institution's period statement. Pure: the
 * report module loads the rows for every member wallet and maps them to
 * `StatementRow`s (`custody-statement-rows.ts`); this file orders them,
 * totals them and renders the CSV an auditor imports.
 */

export type StatementKind = "fill" | "send" | "execution" | "withdrawal" | "spend";

export interface StatementRow {
  /** ISO-8601 instant. */
  at: string;
  kind: StatementKind;
  wallet: string;
  /** Transaction hash, execution id, withdrawal id or ledger day. */
  reference: string;
  amountUsd: number | null;
  feeUsd: number | null;
  detail: string;
}

export interface StatementTotals {
  rows: number;
  fillVolumeUsd: number;
  feesUsd: number;
  sendsUsd: number;
  withdrawalsUsd: number;
  spendUsd: number;
}

export interface Statement {
  period: { from: string; to: string };
  wallets: string[];
  rows: StatementRow[];
  totals: StatementTotals;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildStatement(input: {
  from: Date;
  to: Date;
  wallets: string[];
  rows: StatementRow[];
}): Statement {
  const rows = [...input.rows].sort((a, b) => a.at.localeCompare(b.at));
  const totals: StatementTotals = {
    rows: rows.length,
    fillVolumeUsd: 0,
    feesUsd: 0,
    sendsUsd: 0,
    withdrawalsUsd: 0,
    spendUsd: 0,
  };
  for (const r of rows) {
    const amount = r.amountUsd ?? 0;
    totals.feesUsd += r.feeUsd ?? 0;
    if (r.kind === "fill") totals.fillVolumeUsd += amount;
    else if (r.kind === "send") totals.sendsUsd += amount;
    else if (r.kind === "withdrawal") totals.withdrawalsUsd += amount;
    else if (r.kind === "spend") totals.spendUsd += amount;
  }
  for (const key of Object.keys(totals) as (keyof StatementTotals)[]) {
    totals[key] = round2(totals[key]);
  }
  return {
    period: { from: input.from.toISOString(), to: input.to.toISOString() },
    wallets: input.wallets,
    rows,
    totals,
  };
}

/** RFC 4180 cell: quoted when it holds a comma, a quote or a line break. */
export function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = typeof v === "number" ? v.toFixed(2) : v;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export const STATEMENT_COLUMNS = [
  "at",
  "kind",
  "wallet",
  "reference",
  "amount_usd",
  "fee_usd",
  "detail",
] as const;

export function statementCsv(s: Statement): string {
  const lines = [STATEMENT_COLUMNS.join(",")];
  for (const r of s.rows) {
    lines.push(
      [r.at, r.kind, r.wallet, r.reference, r.amountUsd, r.feeUsd, r.detail].map(csvCell).join(","),
    );
  }
  return lines.join("\n");
}
