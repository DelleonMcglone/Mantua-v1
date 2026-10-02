/**
 * What the home board shows for one league: today's games when there are
 * any, otherwise the next day that has games. The board is never empty
 * while the schedule holds a future game — after Thursday night settles,
 * Sunday's slate is already there.
 */
export interface BoardPick<T> {
  mode: "today" | "next" | "empty";
  events: T[];
  /** Local midnight of the day shown when `mode` is "next". */
  day: Date | null;
}

function localMidnight(seconds: number): number {
  const d = new Date(seconds * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function pickBoardEvents<T extends { startsAt: number }>(
  events: readonly T[],
  todayStart: Date,
  todayEndExclusive: Date,
): BoardPick<T> {
  const from = todayStart.getTime();
  const to = todayEndExclusive.getTime();
  const byStart = [...events].sort((a, b) => a.startsAt - b.startsAt);
  const today = byStart.filter((e) => e.startsAt * 1000 >= from && e.startsAt * 1000 < to);
  if (today.length > 0) return { mode: "today", events: today, day: null };

  const first = byStart.find((e) => e.startsAt * 1000 >= to);
  if (!first) return { mode: "empty", events: [], day: null };
  const dayMs = localMidnight(first.startsAt);
  return {
    mode: "next",
    events: byStart.filter((e) => localMidnight(e.startsAt) === dayMs),
    day: new Date(dayMs),
  };
}

/** How far ahead the board looks for the next slate. A week reaches the
 *  next game day from any day of an NFL week; ten covers a bye-week gap. */
export const BOARD_LOOKAHEAD_DAYS = 10;
