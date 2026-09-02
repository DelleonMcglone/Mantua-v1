import { useMemo, useState } from "react";
import { usePortfolio } from "./use-portfolio.ts";
import { type HistoryRange, usePortfolioHistory } from "./use-portfolio-history.ts";

const RANGES: HistoryRange[] = ["1H", "1D", "TW", "1M", "1Y"];

const RANGE_LABEL: Record<HistoryRange, string> = {
  "1H": "past hour",
  "1D": "past day",
  TW: "past week",
  "1M": "past month",
  "1Y": "past year",
};

const FALLBACK_POINTS = 80;

/**
 * Portfolio card. Shows the user's current portfolio value (sum of
 * on-chain balance USD valuations from `/api/portfolio`) and a
 * historical chart driven by `/api/portfolio/history` weighted by
 * current holdings. The range pills (1H/1D/TW/1M/1Y) refetch the
 * server-side series and update the headline delta + chart in lock
 * step.
 *
 * When no wallet is connected we show a placeholder ("$—") and a
 * flat synthetic shape so the card still has visual weight in the
 * design.
 */
export function PortfolioCard() {
  const [range, setRange] = useState<HistoryRange>("TW");
  const portfolio = usePortfolio();
  const history = usePortfolioHistory(range);

  const totalUsd = useMemo(
    () => portfolio.balances.reduce((sum, b) => sum + b.usdValue, 0),
    [portfolio.balances],
  );

  const connected = Boolean(portfolio.walletAddress);
  const series = history.data?.series ?? [];
  const points = series.length >= 2 ? series.map((p) => p.value) : flatSeries(totalUsd);
  const delta = history.data?.delta ?? 0;
  const pct = history.data?.pct ?? 0;
  const up = delta >= 0;

  const w = 560;
  const h = 170;
  const pad = 8;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const sx = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const sy = (v: number) => pad + (1 - (v - min) / (max - min + 0.001)) * (h - pad * 2);
  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${String(sx(points.length - 1))},${String(h - pad)} L${String(sx(0))},${String(h - pad)} Z`;

  return (
    <div
      className="bg-panel-solid border border-border-soft rounded-md transition-colors"
      style={{ padding: "calc(18px * var(--density))" }}
    >
      <div className="text-center pt-[18px]">
        <div className="text-[13px] text-text-dim">Portfolio</div>
        <div className="text-[34px] font-semibold mt-0.5 -tracking-[0.02em]">
          {connected ? formatUsd(totalUsd) : "$—"}
        </div>
        <div className={`text-[13px] mt-0.5 ${up ? "text-green" : "text-red"}`}>
          {connected && history.data ? (
            <>
              <span className="mr-1">{up ? "↗" : "↘"}</span>
              {pct.toFixed(2)}% {RANGE_LABEL[range]}
            </>
          ) : (
            <span className="text-text-mute">
              {connected ? "Loading history…" : "Connect wallet to see your portfolio"}
            </span>
          )}
        </div>
      </div>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${String(w)} ${String(h)}`} width="100%" className="block">
          <defs>
            <linearGradient id="amberFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--amber)" stopOpacity="0.25" />
              <stop offset="1" stopColor="var(--amber)" stopOpacity="0" />
            </linearGradient>
            <pattern id="dotPat" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r=".8" fill="var(--amber)" opacity=".18" />
            </pattern>
          </defs>
          <rect x="0" y={h * 0.45} width={w} height={h * 0.55} fill="url(#dotPat)" />
          <path d={area} fill="url(#amberFill)" />
          <path
            d={path}
            fill="none"
            stroke="var(--amber)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="flex justify-center gap-0.5 mt-1 items-center">
          <div className="inline-flex bg-bg-elev rounded-full p-[3px] border border-border-soft">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => {
                  setRange(r);
                }}
                className={`px-2.5 py-1 rounded-full border-none text-[12px] font-medium cursor-pointer transition-colors ${
                  range === r ? "bg-chip text-text" : "bg-transparent text-text-dim"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="ml-3 flex items-center gap-1.5 text-text-dim text-[12px]">
            <span
              className="w-1.5 h-1.5 rounded-full bg-green"
              style={{ boxShadow: "0 0 8px var(--green)" }}
            />
            Live
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Disconnected / pre-history fallback: a flat line at the user's
 * current value (or 0). Keeps the chart visually present without
 * pretending we know history.
 */
function flatSeries(value: number): number[] {
  return Array<number>(FALLBACK_POINTS).fill(value);
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$—";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
