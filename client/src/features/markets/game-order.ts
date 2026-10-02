/**
 * The league page's two list controls, as pure functions: which way the
 * games run, and stepping to the neighbouring week.
 */
export type GameOrder = "earliest" | "latest";

export const GAME_ORDER_KEY = "mantua:game-order";

/** Games by kickoff. Stable, so same-time games keep the feed's order. */
export function orderEvents<T extends { startsAt: number }>(
  events: readonly T[],
  order: GameOrder,
): T[] {
  const indexed = events.map((event, i) => ({ event, i }));
  indexed.sort((a, b) => {
    const d = a.event.startsAt - b.event.startsAt;
    if (d !== 0) return order === "earliest" ? d : -d;
    return a.i - b.i;
  });
  return indexed.map((x) => x.event);
}

export function parseGameOrder(raw: string | null | undefined): GameOrder {
  return raw === "latest" ? "latest" : "earliest";
}

/** The week `delta` steps from the active one, or null past either end. */
export function stepWeek<T extends { dates: string }>(
  options: readonly T[],
  active: T,
  delta: -1 | 1,
): T | null {
  const i = options.findIndex((o) => o.dates === active.dates);
  if (i === -1) return null;
  return options[i + delta] ?? null;
}
