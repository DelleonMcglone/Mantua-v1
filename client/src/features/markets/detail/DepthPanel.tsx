import { depthRows, depthSummary, metricLines } from "./depth-core.ts";
import type { DepthCurve, DepthMetrics } from "./depth-types.ts";

/**
 * Phase 11 (D-001 / D-006) — the Depth section: the market's numbers and
 * the depth ladder. An automated market maker has no order book, so the
 * ladder is the cost of moving the price through the pool's liquidity,
 * quoted before fees — the honest artefact for the pro layer.
 */
export function DepthPanel({
  metrics,
  depth,
}: {
  metrics: DepthMetrics | null;
  depth: DepthCurve | null;
}) {
  const lines = metricLines(metrics);
  const rows = depthRows(depth);
  const summary = depthSummary(depth);
  return (
    <div className="flex flex-col gap-4">
      {lines.length > 0 ? (
        <dl data-testid="market-metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {lines.map((l) => (
            <div
              key={l.id}
              data-metric={l.id}
              className="rounded-md border border-border-soft px-3 py-2"
            >
              <dt className="text-[11px] text-text-dim">{l.label}</dt>
              <dd className="mt-0.5 font-mono text-[15px] font-semibold text-text">{l.value}</dd>
              {l.hint && <p className="mt-0.5 text-[10.5px] text-text-mute">{l.hint}</p>}
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[12.5px] text-text-dim">Numbers appear once this market trades.</p>
      )}

      {rows.length > 0 && (
        <div data-testid="market-depth">
          {summary && (
            <p data-testid="depth-summary" className="text-[12.5px] text-text">
              {summary}
            </p>
          )}
          <div className="mt-2 grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-1 text-[11.5px]">
            <span className="text-text-mute">Price</span>
            <span className="text-text-mute">To move there</span>
            <span className="text-right text-text-mute">USDC</span>
            <span className="text-right text-text-mute">Contracts</span>
            {rows.map((r) => (
              <div key={`${r.side}-${r.price}`} data-side={r.side} className="contents">
                <span className="font-mono text-text">{r.price}</span>
                <span className="h-2 w-full rounded-sm bg-chip">
                  <span
                    className={`block h-2 rounded-sm ${r.side === "buy" ? "bg-green/60" : "bg-yellow/60"}`}
                    style={{ width: `${String(Math.round(r.share * 100))}%` }}
                  />
                </span>
                <span className="text-right font-mono text-text-dim">{r.usdc}</span>
                <span className="text-right font-mono text-text-dim">{r.contracts}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-text-mute">
            Sells push the price down, buys push it up. Each row is the size that reaches that price
            through the pool&apos;s current liquidity, before fees. There is no order book — the
            pool prices every trade from the same curve.
          </p>
        </div>
      )}
    </div>
  );
}
