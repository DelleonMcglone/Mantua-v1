/**
 * Game-time freshness: twice the five-minute tick, so scheduler drift never
 * labels a current feed delayed, and well inside the 15-minute buy halt
 * (`IN_PLAY_FEED_MAX_AGE_MS`). The reasoning lives on `canonicalToPublicSlate`.
 */
export const CANONICAL_FRESH_MS = 10 * 60_000;

/**
 * How old the feed may be before a read is labeled delayed — a function of
 * whether anything is happening. The live tick runs every five minutes
 * only around games (live-tick-gate.ts, the 2026-10-19 database-quota
 * lesson); on a quiet day it runs once an hour, on purpose. Judging a quiet
 * hour by the game-time rule labeled the board "delayed" for fifty minutes
 * of every hour with nothing on. So: a game in play (or kicked off and not
 * final) keeps the game-time rule; otherwise one hourly tick plus slack.
 *
 * The buy halt (`IN_PLAY_FEED_MAX_AGE_MS`) is untouched — it only ever
 * applies to a game in play, where the game-time rule still holds.
 */
export const QUIET_FRESH_MS = 65 * 60_000;

export function freshMsFor(anyInPlay: boolean): number {
  return anyInPlay ? CANONICAL_FRESH_MS : QUIET_FRESH_MS;
}

/** The trade gate's notion of in play: kicked off and not over. */
export function anyInPlay(
  events: readonly { startsAt: Date | number; status: string }[],
  nowMs: number,
): boolean {
  return events.some((e) => {
    const start = e.startsAt instanceof Date ? e.startsAt.getTime() : e.startsAt;
    const over = e.status === "final" || e.status === "cancelled" || e.status === "postponed";
    return !over && (e.status === "in_progress" || start <= nowMs);
  });
}
