/**
 * Task 071 (MX-003) — the live glance, pure: for every game in progress,
 * the score, both prices, and what the user holds in it — contracts,
 * the side's price now, value, P&L — with the one-tap exit attached. Games
 * the user holds come first. Pure; rendered by `LiveGlance.tsx`.
 */
import type { MarketPositionRow } from "../../portfolio/portfolio-core.ts";
import { closePositionDetail, type ClosePositionDetail } from "../market-trade-core.ts";
import type { SlateEvent } from "../use-slate.ts";

export interface GlancePosition {
  /** 0 = home, 1 = away — the side the user is long. */
  side: 0 | 1;
  team: string;
  abbreviation: string;
  contracts: number;
  valueUsd: number;
  pnlUsd: number | null;
  priceCents: number | null;
  close: ClosePositionDetail | null;
}

export interface GlanceRow {
  eventId: string;
  event: SlateEvent;
  /** "KC 14 · LV 10", or null before the feed carries a score. */
  score: string | null;
  priceCents: { home: number | null; away: number | null };
  positions: GlancePosition[];
}

export function sideCents(homeWinProbabilityBps: number | undefined, side: 0 | 1): number | null {
  if (typeof homeWinProbabilityBps !== "number") return null;
  const bps = side === 0 ? homeWinProbabilityBps : 10_000 - homeWinProbabilityBps;
  return Math.round(bps / 100);
}

/** The 0/1 side a position row is long: YES on the market's outcome, NO on the other. */
export function positionSide(row: Pick<MarketPositionRow, "side" | "outcomeIndex">): 0 | 1 {
  const yesSide: 0 | 1 = row.outcomeIndex === 1 ? 1 : 0;
  if (row.side === "yes") return yesSide;
  return yesSide === 0 ? 1 : 0;
}

export function glanceRows(
  events: readonly SlateEvent[],
  positions: readonly MarketPositionRow[] | null,
): GlanceRow[] {
  const held = new Map<string, MarketPositionRow[]>();
  for (const p of positions ?? []) {
    if (!p.providerEventId || Number(p.balance) <= 0) continue;
    held.set(p.providerEventId, [...(held.get(p.providerEventId) ?? []), p]);
  }
  const rows = events
    .filter((e) => e.status === "in_progress")
    .map((event): GlanceRow => {
      const score =
        typeof event.awayScore === "number" && typeof event.homeScore === "number"
          ? `${event.away.abbreviation} ${String(event.awayScore)} · ${event.home.abbreviation} ${String(event.homeScore)}`
          : null;
      const glancePositions = (held.get(event.providerEventId) ?? []).map((row): GlancePosition => {
        const side = positionSide(row);
        const team = side === 0 ? event.home : event.away;
        return {
          side,
          team: team.name,
          abbreviation: team.abbreviation,
          contracts: Number(row.balance) / 1e6,
          valueUsd: Number(row.valueRaw) / 1e6,
          pnlUsd: row.pnlRaw === null ? null : Number(row.pnlRaw) / 1e6,
          priceCents: sideCents(event.homeWinProbabilityBps, side),
          close: closePositionDetail(row),
        };
      });
      return {
        eventId: event.providerEventId,
        event,
        score,
        priceCents: {
          home: sideCents(event.homeWinProbabilityBps, 0),
          away: sideCents(event.homeWinProbabilityBps, 1),
        },
        positions: glancePositions,
      };
    });
  return rows.sort(
    (a, b) =>
      Number(b.positions.length > 0) - Number(a.positions.length > 0) ||
      a.event.startsAt - b.event.startsAt,
  );
}

export const usd = (n: number): string =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
