/**
 * T-010 — "recent movement" for the market page's simple layer, from the
 * recorded price series (`/api/markets/detail` prices). Pure.
 */

export interface PricePoint {
  t: number;
  outcomeIndex: number;
  priceBps: number;
}

export interface Movement {
  /** Change in bps over the window; null with fewer than two points. */
  deltaBps: number | null;
  /** "▲ 4 pts today" / "▼ 2 pts today" / "No change today" / "No trades yet". */
  label: string;
  /** Seconds the comparison spans, for the tooltip. */
  windowSec: number;
}

const DAY = 86_400;

/**
 * Latest price vs the freshest point at least 24 h old (or the earliest
 * point when the series is younger than a day), for one outcome.
 */
export function priceMovement(
  points: readonly PricePoint[],
  outcomeIndex: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): Movement {
  const series = points
    .filter((p) => p.outcomeIndex === outcomeIndex && Number.isFinite(p.priceBps))
    .sort((a, b) => a.t - b.t);
  if (series.length === 0) return { deltaBps: null, label: "No trades yet", windowSec: 0 };
  const latest = series[series.length - 1];
  const cutoff = nowSec - DAY;
  let base = series[0];
  for (const p of series) {
    if (p.t <= cutoff) base = p;
    else break;
  }
  if (base === latest) return { deltaBps: null, label: "No trades yet", windowSec: 0 };
  const delta = latest.priceBps - base.priceBps;
  const pts = Math.round(Math.abs(delta) / 100);
  const window = latest.t - base.t;
  const span = nowSec - base.t >= DAY ? "today" : "recently";
  const label =
    pts === 0 ? `No change ${span}` : `${delta > 0 ? "▲" : "▼"} ${String(pts)} pts ${span}`;
  return { deltaBps: delta, label, windowSec: window };
}
