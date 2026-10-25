import { desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { marketPrices, markets } from "../../db/schema/markets.ts";
import { forecastOutcomes } from "../../db/schema/forecasts.ts";

/**
 * The closing reference: the sportsbook line and the pool price at the
 * last tick before kickoff, kept once per market so closing-line value can
 * be scored. The live tick runs every five minutes around a kickoff
 * (live-tick-gate.ts), so the first observation inside the window below is
 * the closing one; later ticks never overwrite it.
 */
export interface ClosingCandidate {
  providerEventId: string;
  /** Unix seconds. */
  startsAt: number;
  status: string;
  homeWinProbabilityBps: number | null;
}

/** A kickoff this close ahead is the last pre-game tick. */
export const CLOSING_LEAD_S = 5 * 60;
/** A game this recently started still counts when the pre-game tick was missed. */
export const CLOSING_GRACE_S = 15 * 60;

/** Pure: the events whose closing reference this tick should write. */
export function closingCandidates(
  events: readonly ClosingCandidate[],
  nowMs: number,
): ClosingCandidate[] {
  const now = Math.floor(nowMs / 1000);
  return events.filter(
    (e) =>
      (e.status === "scheduled" || e.status === "in_progress") &&
      e.startsAt - now <= CLOSING_LEAD_S &&
      now - e.startsAt <= CLOSING_GRACE_S,
  );
}

/** The home side's pool price in bps for one market, from its latest capture. */
async function latestPoolBps(db: DB, marketId: string): Promise<number | null> {
  const rows = await db
    .select({ p: marketPrices.impliedProbability })
    .from(marketPrices)
    .where(eq(marketPrices.marketId, marketId))
    .orderBy(desc(marketPrices.capturedAt))
    .limit(1);
  const first = rows.at(0);
  return first ? Math.round(Number(first.p) * 10_000) : null;
}

export async function captureClosingLines(
  db: DB,
  candidates: readonly ClosingCandidate[],
  now: Date = new Date(),
): Promise<number> {
  if (candidates.length === 0) return 0;
  const byEvent = new Map(candidates.map((c) => [c.providerEventId, c]));
  const rows = await db
    .select({
      marketId: markets.marketId,
      providerEventId: markets.providerEventId,
      outcomeIndex: markets.outcomeIndex,
    })
    .from(markets)
    .where(inArray(markets.providerEventId, [...byEvent.keys()]));
  let written = 0;
  for (const m of rows) {
    const c = m.providerEventId === null ? undefined : byEvent.get(m.providerEventId);
    if (!c || m.providerEventId === null) continue;
    // The pool price is read on the home market; the outcome row is per
    // market, so the away market carries the complement.
    const home = rows.find((r) => r.providerEventId === m.providerEventId && r.outcomeIndex === 0);
    const homePool = home ? await latestPoolBps(db, home.marketId) : null;
    const pool = homePool === null ? null : m.outcomeIndex === 0 ? homePool : 10_000 - homePool;
    const book =
      c.homeWinProbabilityBps === null
        ? null
        : m.outcomeIndex === 0
          ? c.homeWinProbabilityBps
          : 10_000 - c.homeWinProbabilityBps;
    await db
      .insert(forecastOutcomes)
      .values({
        marketId: m.marketId,
        providerEventId: m.providerEventId,
        eventStartsAt: new Date(c.startsAt * 1000),
        closingBookBps: book,
        closingPoolBps: pool,
        closingCapturedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: forecastOutcomes.marketId,
        // First observation wins: coalesce keeps an existing capture.
        set: {
          closingBookBps: sql`coalesce(${forecastOutcomes.closingBookBps}, excluded.closing_book_bps)`,
          closingPoolBps: sql`coalesce(${forecastOutcomes.closingPoolBps}, excluded.closing_pool_bps)`,
          closingCapturedAt: sql`coalesce(${forecastOutcomes.closingCapturedAt}, excluded.closing_captured_at)`,
          updatedAt: now,
        },
      });
    written += 1;
  }
  return written;
}
