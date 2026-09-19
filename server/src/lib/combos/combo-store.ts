import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { comboLegs, combos, type Combo, type ComboLeg } from "../../db/schema/markets.ts";

/**
 * Task 072 / CB-005, CB-008 — the ticket ledger. One row per verified buy
 * of a combo market (unique on tx hash, so a replayed fill report writes
 * nothing), its legs frozen at placement, and the stamps the settlement
 * and monitor passes add. Everything here is keyed by the row id the
 * fill assigned; nothing edits stake, shares or legs after placement.
 */

export const OPEN_TICKET_STATUSES = ["open", "dead"] as const;
/** Statuses that hold a combo market on the operator's books (a prepared
 *  market is a `draft` row until its first ticket, and stays counted). */
const MARKET_STATUSES = ["draft", "open", "dead"] as const;

export interface PlaceLegInput {
  marketId: string;
  providerEventId: string;
  outcomeIndex: 0 | 1;
  label: string;
  opponent: string;
  league: string | null;
  kickoffAt: Date;
  /** YES price at placement, 0–1. */
  entryPrice: number;
}

export interface PlaceComboInput {
  userId: string;
  walletAddress: string;
  chainId: number;
  marketId: string;
  marketAddress: string;
  yesToken: string;
  poolId: string;
  label: string;
  startsAt: Date;
  openingProbability: number;
  stakeRaw: bigint;
  sharesRaw: bigint;
  entryPriceBps: number;
  combinedOdds: number;
  txHash: string;
  source: "user" | "agent";
  mode: string | null;
  legs: readonly PlaceLegInput[];
}

export type ComboTicketRow = Combo & { legs: ComboLeg[] };

/** Insert the ticket and its legs; null when the tx was already recorded. */
export async function placeCombo(db: DB, input: PlaceComboInput): Promise<string | null> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(combos)
      .values({
        userId: input.userId,
        walletAddress: input.walletAddress.toLowerCase(),
        status: "open",
        chainId: input.chainId,
        marketId: input.marketId.toLowerCase(),
        marketAddress: input.marketAddress,
        yesToken: input.yesToken,
        poolId: input.poolId,
        label: input.label,
        startsAt: input.startsAt,
        openingProbability: input.openingProbability.toFixed(5),
        stakeRaw: input.stakeRaw.toString(),
        sharesRaw: input.sharesRaw.toString(),
        entryPriceBps: input.entryPriceBps,
        combinedOdds: input.combinedOdds.toFixed(6),
        potentialPayoutRaw: input.sharesRaw.toString(),
        txHash: input.txHash.toLowerCase(),
        source: input.source,
        mode: input.mode,
        placedAt: new Date(),
      })
      .onConflictDoNothing({ target: combos.txHash })
      .returning({ id: combos.id });
    const id = inserted.at(0)?.id;
    if (!id) return null;
    await tx.insert(comboLegs).values(
      input.legs.map((l) => ({
        comboId: id,
        marketId: l.marketId.toLowerCase(),
        side: "yes",
        entryPrice: l.entryPrice.toFixed(5),
        providerEventId: l.providerEventId,
        outcomeIndex: l.outcomeIndex,
        label: l.label,
        opponent: l.opponent,
        league: l.league,
        kickoffAt: l.kickoffAt,
      })),
    );
    return id;
  });
}

async function withLegs(db: DB, rows: Combo[]): Promise<ComboTicketRow[]> {
  if (rows.length === 0) return [];
  const legs = await db
    .select()
    .from(comboLegs)
    .where(
      inArray(
        comboLegs.comboId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(comboLegs.kickoffAt, comboLegs.createdAt);
  const byCombo = new Map<string, ComboLeg[]>();
  for (const l of legs) byCombo.set(l.comboId, [...(byCombo.get(l.comboId) ?? []), l]);
  return rows.map((r) => ({ ...r, legs: byCombo.get(r.id) ?? [] }));
}

export async function listCombosForUser(
  db: DB,
  userId: string,
  limit = 50,
): Promise<ComboTicketRow[]> {
  const rows = await db
    .select()
    .from(combos)
    .where(and(eq(combos.userId, userId), ne(combos.status, "draft")))
    .orderBy(desc(combos.placedAt))
    .limit(limit);
  return withLegs(db, rows);
}

/** Every ticket the settlement and monitor passes still care about. */
export async function listOpenCombos(db: DB): Promise<ComboTicketRow[]> {
  const rows = await db
    .select()
    .from(combos)
    .where(inArray(combos.status, [...OPEN_TICKET_STATUSES]))
    .orderBy(combos.placedAt);
  return withLegs(db, rows);
}

/** The user's open tickets on one combo market, oldest first (a sell closes them FIFO). */
export async function openTicketsOnMarket(
  db: DB,
  userId: string,
  marketId: string,
): Promise<Combo[]> {
  return db
    .select()
    .from(combos)
    .where(
      and(
        eq(combos.userId, userId),
        eq(combos.marketId, marketId.toLowerCase()),
        inArray(combos.status, [...OPEN_TICKET_STATUSES]),
      ),
    )
    .orderBy(combos.placedAt);
}

/** Sum of open stakes, USD — the exposure the policy caps. */
export async function openExposureUsd(db: DB, userId: string): Promise<number> {
  const row = (
    await db
      .select({ total: sql<string>`coalesce(sum(${combos.stakeRaw}), 0)` })
      .from(combos)
      .where(and(eq(combos.userId, userId), inArray(combos.status, [...OPEN_TICKET_STATUSES])))
  ).at(0);
  return Number(row?.total ?? 0) / 1e6;
}

/** Distinct combo markets prepared or live — the operator's seeding capacity. */
export async function countComboMarkets(db: DB): Promise<number> {
  const row = (
    await db
      .select({ n: sql<string>`count(distinct ${combos.marketId})` })
      .from(combos)
      .where(inArray(combos.status, [...MARKET_STATUSES]))
  ).at(0);
  return Number(row?.n ?? 0);
}

/**
 * Record a prepared combo market as a `draft` row (no stake, no shares)
 * unless the market is already on the books. Returns true when the market
 * was already known; `dryRun` records nothing for a new market (capacity).
 */
export async function recordComboMarket(
  db: DB,
  input: {
    userId: string;
    walletAddress: string;
    chainId: number;
    marketId: string;
    label: string;
    startsAt: Date;
    openingProbability: number;
    dryRun: boolean;
  },
): Promise<boolean> {
  const known = await db
    .select({ id: combos.id })
    .from(combos)
    .where(
      and(
        eq(combos.marketId, input.marketId.toLowerCase()),
        inArray(combos.status, [...MARKET_STATUSES]),
      ),
    )
    .limit(1);
  if (known.length > 0) return true;
  if (input.dryRun) return false;
  await db.insert(combos).values({
    userId: input.userId,
    walletAddress: input.walletAddress.toLowerCase(),
    status: "draft",
    chainId: input.chainId,
    marketId: input.marketId.toLowerCase(),
    label: input.label,
    startsAt: input.startsAt,
    openingProbability: input.openingProbability.toFixed(5),
  });
  return false;
}

/** Whether a sell transaction has already closed tickets (replay guard). */
export async function closeTxRecorded(db: DB, txHash: string): Promise<boolean> {
  const rows = await db
    .select({ id: combos.id })
    .from(combos)
    .where(eq(combos.closeTxHash, txHash.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}
