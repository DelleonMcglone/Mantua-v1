/**
 * Task 070 / AE-005, AE-012 — the pure half of the public performance page:
 * the URL it lives at and the rows it renders (wire shape: `reputation-types.ts`).
 * No React, so every line the public sees is unit-tested.
 */

export type {
  LedgerMode,
  ModeTotals,
  PublicAgent,
  PublicMarket,
  PublicTrade,
} from "./reputation-types.ts";
import {
  LEDGER_MODES,
  type LedgerMode,
  type PublicAgent,
  type PublicMarket,
} from "./reputation-types.ts";
export { LEDGER_MODES };

export const AGENT_PATH_PREFIX = "/agents/";

/** The handle in a `/agents/<handle>` path, or null. */
export function agentHandleFromPath(pathname: string): string | null {
  if (!pathname.startsWith(AGENT_PATH_PREFIX)) return null;
  const rest = pathname.slice(AGENT_PATH_PREFIX.length).replace(/\/+$/, "").toLowerCase();
  return /^[a-z0-9_]{3,24}$/.test(rest) ? rest : null;
}

export function agentPagePath(handle: string): string {
  return `${AGENT_PATH_PREFIX}${handle}`;
}

export const MODE_LABELS: Record<LedgerMode, string> = {
  simulated: "Simulated",
  user_confirmed: "User-confirmed",
  autonomous: "Autonomous",
  unattributed: "Unattributed",
};

export const STATUS_LABELS: Record<PublicMarket["status"], string> = {
  resolved_win: "Win",
  resolved_loss: "Loss",
  voided: "Void",
  open: "Open",
};

const usd = (n: number): string =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number): string => (n > 0 ? `+${usd(n)}` : usd(n));
const pct = (r: number | null): string => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);

export interface StatRow {
  label: string;
  value: string;
  tone: "up" | "down" | "flat";
}

/** The headline metric tiles, in reading order. */
export function metricRows(a: PublicAgent): StatRow[] {
  const m = a.metrics;
  const tone = (n: number): StatRow["tone"] => (n > 0 ? "up" : n < 0 ? "down" : "flat");
  return [
    { label: "Realised P&L", value: signed(m.realizedPnlUsd), tone: tone(m.realizedPnlUsd) },
    {
      label: "Unrealised P&L",
      value: a.marksAvailable ? signed(m.unrealizedPnlUsd) : "unavailable",
      tone: a.marksAvailable ? tone(m.unrealizedPnlUsd) : "flat",
    },
    { label: "ROI on capital", value: pct(m.roi), tone: m.roi === null ? "flat" : tone(m.roi) },
    {
      label: "Record",
      value: `${String(a.ledger.totals.wins)}–${String(a.ledger.totals.losses)}${a.ledger.totals.voided > 0 ? ` (${String(a.ledger.totals.voided)} void)` : ""}`,
      tone: "flat",
    },
    { label: "Win rate", value: pct(m.winRate), tone: "flat" },
    {
      label: "Max drawdown",
      value: `${usd(m.maxDrawdownUsd)} (${pct(m.maxDrawdownPct)})`,
      tone: m.maxDrawdownUsd > 0 ? "down" : "flat",
    },
    {
      label: "Open exposure",
      value: `${usd(m.exposure.openCostUsd)} in ${String(m.exposure.openMarkets)} market(s)`,
      tone: "flat",
    },
    { label: "Capital deployed", value: usd(m.capitalDeployedUsd), tone: "flat" },
  ];
}

/** The risk block as label/value pairs. */
export function riskRows(a: PublicAgent): { label: string; value: string }[] {
  const r = a.metrics.risk;
  return [
    {
      label: "Largest stake",
      value: `${usd(r.largestStakeUsd)} (${pct(r.largestStakeShare)} of deployed)`,
    },
    { label: "Largest loss", value: usd(r.largestLossUsd) },
    { label: "Profit factor", value: r.profitFactor === null ? "—" : r.profitFactor.toFixed(2) },
    { label: "Average stake", value: usd(r.avgStakeUsd) },
  ];
}

/** One row per mode, including the simulated block, for the breakdown table. */
export function modeRows(a: PublicAgent): {
  mode: LedgerMode;
  label: string;
  trades: number;
  staked: string;
  realized: string;
  note: string;
}[] {
  return LEDGER_MODES.map((mode) => {
    const t = a.ledger.byMode[mode];
    const simulated = mode === "simulated";
    return {
      mode,
      label: MODE_LABELS[mode],
      trades: simulated ? a.ledger.simulated.count : t.trades,
      staked: simulated ? `${usd(a.ledger.simulated.notionalUsd)} notional` : usd(t.stakedUsd),
      realized: simulated ? "no capital at risk" : signed(t.realizedPnlUsd),
      note: simulated
        ? `${String(a.ledger.simulated.executable)} would have executed`
        : `${String(t.markets)} market(s)`,
    };
  });
}

/** Markets newest-resolved first; losses are never filtered — this is the record. */
export function marketRows(
  a: PublicAgent,
): (PublicMarket & { statusLabel: string; result: string })[] {
  return [...a.ledger.markets]
    .sort((x, y) => (y.resolvedAt ?? y.lastTradeAt).localeCompare(x.resolvedAt ?? x.lastTradeAt))
    .map((m) => ({
      ...m,
      statusLabel: STATUS_LABELS[m.status],
      result:
        m.realizedPnlUsd === null
          ? `${usd(m.costUsd - m.proceedsUsd)} at risk`
          : signed(m.realizedPnlUsd),
    }));
}

/** A short fingerprint of the digest for display beside the full value. */
export function shortDigest(digest: string): string {
  return `${digest.slice(0, 8)}…${digest.slice(-6)}`;
}
