import { eq, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { events, markets } from "../../db/schema/markets.ts";
import { forecastOutcomes } from "../../db/schema/forecasts.ts";

/**
 * The outcome half of the ledger: when a market resolves, one row per
 * market records who won (or that it was voided). Scoring joins it to
 * every forecast row for the market, so forecasts stay untouched.
 */
export interface ResolutionLike {
  marketId: string;
  providerEventId: string;
  kind: "resolve" | "void";
  outcome: number | null;
}

/** Pure: what the outcome row says for a resolution. */
export function outcomeFromResolution(entry: Pick<ResolutionLike, "kind" | "outcome">): {
  winningOutcomeIndex: number | null;
  voided: boolean;
} {
  if (entry.kind === "void" || entry.outcome === null) {
    return { winningOutcomeIndex: null, voided: true };
  }
  return { winningOutcomeIndex: entry.outcome, voided: false };
}

async function eventStartFor(db: DB, marketId: string): Promise<Date | null> {
  const rows = await db
    .select({ startsAt: events.startsAt })
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .where(eq(markets.marketId, marketId))
    .limit(1);
  return rows[0]?.startsAt ?? null;
}

/** Upsert the outcome; the closing columns, if already captured, are kept. */
export async function recordForecastOutcome(
  db: DB,
  entry: ResolutionLike,
  now: Date = new Date(),
): Promise<void> {
  const startsAt = await eventStartFor(db, entry.marketId);
  if (!startsAt) return;
  const o = outcomeFromResolution(entry);
  await db
    .insert(forecastOutcomes)
    .values({
      marketId: entry.marketId,
      providerEventId: entry.providerEventId,
      eventStartsAt: startsAt,
      winningOutcomeIndex: o.winningOutcomeIndex,
      voided: o.voided,
      settledAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: forecastOutcomes.marketId,
      set: {
        winningOutcomeIndex: o.winningOutcomeIndex,
        voided: o.voided,
        settledAt: now,
        updatedAt: sql`now()`,
      },
    });
}
