import { formatUnits } from "viem";
import type { StatementRow } from "./custody-statement.ts";

/**
 * Task 073 / IC-002 — one mapper per ledger the statement draws on. Pure;
 * the shapes are the minimal slices of the Drizzle rows so the tests need
 * no database. Dollars are numbers rounded to cents; USDC raw is 6 dp.
 */

function usdcRawToUsd(raw: string): number {
  return Math.round(Number(formatUnits(BigInt(raw), 6)) * 100) / 100;
}

function numeric(v: string | null): number | null {
  return v === null ? null : Number(v);
}

export function fillRow(f: {
  address: string;
  direction: string;
  usdcRaw: string;
  feeUsdcRaw: string | null;
  txHash: string;
  marketId: string;
  createdAt: Date;
}): StatementRow {
  return {
    at: f.createdAt.toISOString(),
    kind: "fill",
    wallet: f.address.toLowerCase(),
    reference: f.txHash,
    amountUsd: usdcRawToUsd(f.usdcRaw),
    feeUsd: f.feeUsdcRaw === null ? null : usdcRawToUsd(f.feeUsdcRaw),
    detail: `${f.direction} ${f.marketId}`,
  };
}

/** `portfolio_transactions` — confirmed on-chain actions; a send is its own kind. */
export function portfolioRow(t: {
  walletAddress: string;
  action: string;
  txHash: string;
  usdValue: string | null;
  createdAt: Date;
}): StatementRow {
  return {
    at: t.createdAt.toISOString(),
    kind: t.action === "send" ? "send" : "execution",
    wallet: t.walletAddress.toLowerCase(),
    reference: t.txHash,
    amountUsd: numeric(t.usdValue),
    feeUsd: null,
    detail: t.action,
  };
}

/** `circle_executions` that did not confirm — what the confirmed ledgers miss. */
export function executionRow(e: {
  walletAddress: string | null;
  kind: string;
  action: string;
  status: string;
  circleTxId: string;
  createdAt: Date;
  payload: unknown;
}): StatementRow {
  const usd = (e.payload as { usdValue?: unknown } | null)?.usdValue;
  return {
    at: e.createdAt.toISOString(),
    kind: "execution",
    wallet: e.walletAddress?.toLowerCase() ?? "",
    reference: e.circleTxId,
    amountUsd: typeof usd === "number" ? usd : null,
    feeUsd: null,
    detail: `${e.action} ${e.status}`,
  };
}

export function withdrawalRow(
  w: {
    id: string;
    walletAddress: string;
    status: string;
    usdValue: string;
    amount: string;
    symbol: string;
    createdAt: Date;
  },
  destinationLabel: string,
): StatementRow {
  return {
    at: w.createdAt.toISOString(),
    kind: "withdrawal",
    wallet: w.walletAddress.toLowerCase(),
    reference: w.id,
    amountUsd: Number(w.usdValue),
    feeUsd: null,
    detail: `${w.status} ${w.amount} ${w.symbol} → ${destinationLabel}`,
  };
}

/** `daily_wallet_spend` — the cap ledger, one line per wallet-day. */
export function spendRow(s: {
  walletAddress: string;
  spendDate: string;
  spentUsd: string;
  txCount: number;
}): StatementRow {
  return {
    at: `${s.spendDate}T00:00:00.000Z`,
    kind: "spend",
    wallet: s.walletAddress.toLowerCase(),
    reference: s.spendDate,
    amountUsd: Number(s.spentUsd),
    feeUsd: null,
    detail: `${String(s.txCount)} transaction${s.txCount === 1 ? "" : "s"}`,
  };
}
