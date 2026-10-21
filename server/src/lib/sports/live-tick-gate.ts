/**
 * When the five-minute live tick is worth a database round trip (the
 * 2026-10-19 outage: the tick, two 15-minute crons and the probe kept the
 * Neon compute awake all month and burned the plan's quota by the 19th).
 *
 * Pure. Given the provider's current slate — fetched without the database
 * — the tick runs in full around games and once an hour otherwise; the
 * other eleven ticks of each quiet hour skip before touching Postgres.
 */
export interface GateEvent {
  /** Kickoff, Unix seconds. */
  startsAt: number;
  status: string;
}

export interface GateDecision {
  run: boolean;
  reason: "live_game" | "kickoff_near" | "post_game" | "hourly" | "quiet";
}

/** Kickoff this close is a game window (pre-game line moves, lineups). */
export const KICKOFF_LEAD_S = 2 * 3600;
/** A game that started this recently is still finishing or settling. */
export const POST_GAME_S = 5 * 3600;
/** The minute of the hour that keeps the hourly tick (ticks land on :00, :05, …). */
export const HOURLY_MINUTE_MAX = 4;

export function liveTickGate(nowMs: number, events: readonly GateEvent[]): GateDecision {
  const now = Math.floor(nowMs / 1000);
  if (events.some((e) => e.status === "in_progress")) return { run: true, reason: "live_game" };
  if (
    events.some(
      (e) => e.status === "scheduled" && e.startsAt > now && e.startsAt - now <= KICKOFF_LEAD_S,
    )
  )
    return { run: true, reason: "kickoff_near" };
  if (events.some((e) => e.startsAt <= now && now - e.startsAt <= POST_GAME_S))
    return { run: true, reason: "post_game" };
  const minute = new Date(nowMs).getUTCMinutes();
  if (minute <= HOURLY_MINUTE_MAX) return { run: true, reason: "hourly" };
  return { run: false, reason: "quiet" };
}
