/**
 * Phase 11 (D-001 / D-006) — the numbers behind the Depth section, shaped
 * for display: labelled metric lines and the depth ladder as rows with a
 * bar share. Pure; rendered by `DepthPanel.tsx`.
 */
import type { DepthCurve, DepthMetrics } from "./depth-types.ts";

export interface MetricLine {
  id: string;
  label: string;
  value: string;
  /** A second line under the value, when the number needs context. */
  hint: string | null;
}

export interface DepthRow {
  side: "buy" | "sell";
  price: string;
  usdc: string;
  contracts: string;
  /** 0–1 share of the largest USDC amount on the ladder, for the bar. */
  share: number;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const formatUsd = (n: number): string => (n >= 1000 ? usd.format(n) : usdCents.format(n));
export const formatCents = (bps: number): string => `${String(Math.round(bps / 100))}¢`;

/** "+3.2 pts" / "−1.0 pts" / "flat" for a 24 h move, or null when unknown. */
export function movement(change24hBps: number | null): string | null {
  if (change24hBps === null) return null;
  const pts = change24hBps / 100;
  if (Math.abs(pts) < 0.05) return "flat over 24h";
  return `${pts > 0 ? "+" : "−"}${Math.abs(pts).toFixed(1)} pts over 24h`;
}

export function metricLines(m: DepthMetrics | null): MetricLine[] {
  if (!m) return [];
  const lines: MetricLine[] = [
    {
      id: "price",
      label: "Price",
      value: m.priceBps === null ? "—" : formatCents(m.priceBps),
      hint: m.priceBps === null ? "no trades yet" : movement(m.change24hBps),
    },
    {
      id: "volume",
      label: "Volume",
      value: formatUsd(m.volume.usdc24h),
      hint: `${formatUsd(m.volume.totalUsdc)} all time`,
    },
    {
      id: "trades",
      label: "Trades",
      value: count.format(m.activity.fillCount24h),
      hint: `${count.format(m.activity.fillCount)} all time · ${count.format(m.activity.uniqueTraders)} traders`,
    },
    {
      id: "open-interest",
      label: "Open interest",
      value: `${count.format(m.openInterest.contractsOpen)} contracts`,
      hint: `${count.format(m.openInterest.positions)} open positions`,
    },
  ];
  return lines;
}

export function depthRows(curve: DepthCurve | null): DepthRow[] {
  if (!curve) return [];
  const max = Math.max(1, ...curve.levels.map((l) => l.usdc));
  const order = (side: "buy" | "sell") =>
    curve.levels
      .filter((l) => l.side === side)
      .sort((a, b) => (side === "buy" ? a.priceBps - b.priceBps : b.priceBps - a.priceBps));
  return [...order("sell").reverse(), ...order("buy")].map((l) => ({
    side: l.side,
    price: formatCents(l.priceBps),
    usdc: formatUsd(l.usdc),
    contracts: count.format(l.contracts),
    share: Math.min(1, l.usdc / max),
  }));
}

/** One line explaining the ladder in the user's terms. */
export function depthSummary(curve: DepthCurve | null): string | null {
  if (!curve) return null;
  const up = curve.levels.find((l) => l.side === "buy" && l.priceBps === curve.priceBps + 500);
  if (!up) return `${formatUsd(curve.liquidityUsdc)} of liquidity behind this price.`;
  return `${formatUsd(curve.liquidityUsdc)} of liquidity · a ${formatUsd(up.usdc)} buy moves the price 5¢.`;
}
