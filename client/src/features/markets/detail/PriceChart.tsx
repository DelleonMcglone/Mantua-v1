import { useMemo } from "react";
import { ProbabilityTag } from "../ProbabilityTag.tsx";
import type { SlateEvent } from "../use-slate.ts";
import type { DetailResponse, PricePoint } from "./detail-types.ts";

const CHART_W = 640;
const CHART_H = 180;

function polyline(points: PricePoint[], t0: number, t1: number): string {
  const span = Math.max(1, t1 - t0);
  return points
    .map((p) => {
      const x = ((p.t - t0) / span) * CHART_W;
      const y = CHART_H - (Math.min(10_000, Math.max(0, p.priceBps)) / 10_000) * CHART_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** The recorded price series for both sides, anchored to the live price. */
export function PriceChart({
  event,
  detail,
  failed,
}: {
  event: SlateEvent;
  detail: DetailResponse | null;
  failed: boolean;
}) {
  const { home, away } = useMemo(() => {
    const prices = detail?.prices ?? [];
    const h = prices.filter((p) => p.outcomeIndex === 0);
    const a = prices.filter((p) => p.outcomeIndex === 1);
    // The slate's live probability anchors the right edge, so the chart
    // always ends at the price the row shows.
    if (typeof event.homeWinProbabilityBps === "number") {
      const anchor = prices.reduce((m, p) => Math.max(m, p.t), event.startsAt) + 60;
      h.push({ t: anchor, outcomeIndex: 0, priceBps: event.homeWinProbabilityBps });
      a.push({ t: anchor, outcomeIndex: 1, priceBps: 10_000 - event.homeWinProbabilityBps });
    }
    for (const series of [h, a]) {
      if (series.length === 1) {
        const only = series[0];
        series.unshift({ ...only, t: only.t - 3600 });
      }
    }
    return { home: h, away: a };
  }, [detail, event.homeWinProbabilityBps, event.startsAt]);

  const all = [...home, ...away];
  if (failed)
    return (
      <div className="rounded-md border border-border-soft px-4 py-8 text-center text-[12.5px] text-text-dim">
        Chart unavailable right now.
      </div>
    );
  if (all.length === 0)
    return (
      <div className="rounded-md border border-border-soft px-4 py-8 text-center text-[12.5px] text-text-dim">
        No market prices yet — the chart draws from live trades once this game&apos;s market opens.
      </div>
    );

  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const latest = (pts: PricePoint[]) => pts.at(-1)?.priceBps;
  const homePct = latest(home);
  const awayPct = latest(away);

  return (
    <div className="rounded-md border border-border-soft bg-panel-solid p-4">
      <div className="mb-2 flex items-center gap-4 text-[12px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" />
          {event.home.abbreviation}
          {typeof homePct === "number" && (
            <span className="font-mono font-semibold text-text">{(homePct / 100).toFixed(0)}%</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green" />
          {event.away.abbreviation}
          {typeof awayPct === "number" && (
            <span className="font-mono font-semibold text-text">{(awayPct / 100).toFixed(0)}%</span>
          )}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-text-mute">
          implied win probability <ProbabilityTag liveOdds={event.liveOdds} />
        </span>
      </div>
      <svg
        viewBox={`0 0 ${String(CHART_W)} ${String(CHART_H)}`}
        className="h-[180px] w-full"
        preserveAspectRatio="none"
        aria-label="Price history"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={CHART_W}
            y1={CHART_H * f}
            y2={CHART_H * f}
            stroke="var(--border-soft)"
            strokeDasharray="3 5"
          />
        ))}
        {home.length > 0 && (
          <polyline
            points={polyline(home, t0, t1)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        )}
        {away.length > 0 && (
          <polyline
            points={polyline(away, t0, t1)}
            fill="none"
            stroke="var(--green)"
            strokeWidth={2}
          />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-text-mute">
        <span>
          {new Date(t0 * 1000).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
          })}
        </span>
        <span>now</span>
      </div>
    </div>
  );
}
