/**
 * Task 071 (MX-004) — the two rules the live-sync tick evaluates, pure.
 *
 * Game events: a kickoff is `scheduled → in_progress`, a final is anything
 * `→ final`. Only transitions count — a game first seen in progress sends
 * nothing, and a tick that re-reads the same status sends nothing.
 *
 * Position alerts: a held side is compared with the pool price now; each
 * 10¢ step away from entry, in either direction, earns one alert (the tag
 * carries the step, so the dispatcher's delivery log dedupes the rest).
 */
import type { ProviderEvent } from "../sports/provider.ts";
import type { PushEvent } from "./notifications.ts";

export interface StatusSnapshot {
  providerEventId: string;
  status: string;
}

export interface GameTransition {
  phase: "kickoff" | "final";
  event: ProviderEvent;
}

export function gameTransitions(
  before: readonly StatusSnapshot[],
  after: readonly ProviderEvent[],
): GameTransition[] {
  const prev = new Map(before.map((s) => [s.providerEventId, s.status]));
  const out: GameTransition[] = [];
  for (const event of after) {
    const was = prev.get(event.providerEventId);
    if (was === undefined || was === event.status) continue;
    if (was === "scheduled" && event.status === "in_progress")
      out.push({ phase: "kickoff", event });
    else if (event.status === "final" && was !== "final") out.push({ phase: "final", event });
  }
  return out;
}

export function gameEventFor(t: GameTransition, league: string): PushEvent {
  const e = t.event;
  return {
    kind: "game_event",
    phase: t.phase,
    league,
    eventId: e.providerEventId,
    away: e.away.name,
    home: e.home.name,
    ...(typeof e.awayScore === "number" ? { awayScore: e.awayScore } : {}),
    ...(typeof e.homeScore === "number" ? { homeScore: e.homeScore } : {}),
  };
}

export const POSITION_ALERT_STEP_CENTS = 10;

export interface HeldPosition {
  userId: string;
  marketId: string;
  side: "yes" | "no";
  /** The market's YES outcome index — 0 home, 1 away. */
  outcomeIndex: number;
  /** Average entry as YES-side implied probability, 0–1. */
  entryPrice: number | null;
  league: string;
  providerEventId: string;
  homeTeam: string;
  awayTeam: string;
}

export interface PositionAlert {
  userId: string;
  event: PushEvent;
}

/** `priceByMarket`: the latest YES-side pool price per market, 0–1. */
export function positionAlerts(
  positions: readonly HeldPosition[],
  priceByMarket: ReadonlyMap<string, number>,
  stepCents: number = POSITION_ALERT_STEP_CENTS,
): PositionAlert[] {
  const out: PositionAlert[] = [];
  for (const p of positions) {
    const yesNow = priceByMarket.get(p.marketId);
    if (p.entryPrice === null || yesNow === undefined) continue;
    const entry = Math.round((p.side === "yes" ? p.entryPrice : 1 - p.entryPrice) * 100);
    const now = Math.round((p.side === "yes" ? yesNow : 1 - yesNow) * 100);
    const steps = Math.trunc((now - entry) / stepCents);
    if (steps === 0) continue;
    // The side the user holds, as the market page's 0/1 outcome index.
    const yesSide = p.outcomeIndex === 1 ? 1 : 0;
    const side: 0 | 1 = p.side === "yes" ? yesSide : yesSide === 0 ? 1 : 0;
    const team = side === 0 ? p.homeTeam : p.awayTeam;
    out.push({
      userId: p.userId,
      event: {
        kind: "position_alert",
        league: p.league,
        eventId: p.providerEventId,
        marketId: p.marketId,
        side,
        team,
        entryCents: entry,
        priceCents: now,
        bucket: steps,
      },
    });
  }
  return out;
}
