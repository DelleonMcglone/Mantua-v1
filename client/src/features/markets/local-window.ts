/**
 * Bridges a LOCAL calendar window (today, a Sunday-to-Saturday week) to the
 * server's `?dates=YYYYMMDD-YYYYMMDD` slate window, which the server (see
 * `server/src/routes/sports-slate.ts`'s `parseYmd`) parses as UTC calendar
 * days.
 *
 * Sending a bare local YYYYMMDD as-is bites every evening game: once local
 * time crosses UTC midnight minus the viewer's own offset, an event that
 * kicked off tonight, locally, lands on the NEXT UTC calendar day and
 * disappears from "today" — while yesterday's late game, still inside that
 * UTC day, leaks in as if it were today's. For a US evening viewer this is
 * not an edge case: it fires every single night, roughly from 8pm local on.
 *
 * The fix is over-fetch, then filter: request a window padded a full day
 * on each side (a superset of the local window in ANY timezone — no real
 * UTC offset exceeds ±14h, well under one day), then keep only the events
 * whose real epoch `startsAt` falls inside the caller's actual local
 * boundary. Pure — no fetching here, just the two halves of that trade.
 */

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear())}${m}${day}`;
}

/**
 * The `?dates=` string for the local window `[start, endExclusive)`.
 *
 * One day of padding on the front (`start`'s date minus one) is explicit.
 * The back gets its day of padding for free: `datesToRangeMs` treats a
 * `dates=` range's end day as inclusive of its own full UTC day, so using
 * `endExclusive`'s OWN calendar date as the upper bound — never
 * `endExclusive` minus a day — already reaches one UTC day past the local
 * window's last real day.
 */
export function paddedDatesRange(start: Date, endExclusive: Date): string {
  const from = new Date(start);
  from.setDate(from.getDate() - 1);
  return `${ymd(from)}-${ymd(endExclusive)}`;
}

/** Is `startsAtSeconds` inside the local window `[start, endExclusive)`? */
export function isWithinLocalWindow(
  startsAtSeconds: number,
  start: Date,
  endExclusive: Date,
): boolean {
  const t = startsAtSeconds * 1000;
  return t >= start.getTime() && t < endExclusive.getTime();
}

/** Local midnight today → local midnight tomorrow. */
export function localDayWindow(reference: Date = new Date()): {
  start: Date;
  endExclusive: Date;
} {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const endExclusive = new Date(start);
  endExclusive.setDate(start.getDate() + 1);
  return { start, endExclusive };
}
