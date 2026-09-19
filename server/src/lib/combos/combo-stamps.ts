import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { comboLegs, combos } from "../../db/schema/markets.ts";
import type { LegResult } from "./combo-settlement.ts";

/**
 * Task 072 / CB-007, CB-009 — the stamps a ticket collects after
 * placement: leg results as the leg markets resolve, `dead` the moment a
 * leg loses, the settlement price once the combo market resolves, a close
 * when the position was sold, a redeem when the payout was claimed. Each
 * write is conditional on the prior state so two passes cannot stamp
 * twice and a later state never regresses to an earlier one.
 */

export async function stampLegResults(
  db: DB,
  comboId: string,
  results: readonly { marketId: string; result: LegResult }[],
): Promise<number> {
  let stamped = 0;
  for (const r of results) {
    if (r.result === "pending") continue;
    const rows = await db
      .update(comboLegs)
      .set({ result: r.result, resultAt: new Date() })
      .where(
        and(
          eq(comboLegs.comboId, comboId),
          eq(comboLegs.marketId, r.marketId.toLowerCase()),
          eq(comboLegs.result, "pending"),
        ),
      )
      .returning({ id: comboLegs.id });
    stamped += rows.length;
  }
  return stamped;
}

/** open → dead, once. Returns whether this call made the change. */
export async function markComboDead(db: DB, comboId: string): Promise<boolean> {
  const rows = await db
    .update(combos)
    .set({ status: "dead", deadAt: new Date(), updatedAt: new Date() })
    .where(and(eq(combos.id, comboId), eq(combos.status, "open")))
    .returning({ id: combos.id });
  return rows.length > 0;
}

/** open|dead → won|lost|void with the per-share settlement value. */
export async function settleCombo(
  db: DB,
  comboId: string,
  status: "won" | "lost" | "void",
  settlementPrice: "1.00000" | "0.00000" | "0.50000",
): Promise<boolean> {
  const rows = await db
    .update(combos)
    .set({ status, settlementPrice, settledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(combos.id, comboId), inArray(combos.status, ["open", "dead"])))
    .returning({ id: combos.id });
  return rows.length > 0;
}

/**
 * A sell of `soldRaw` shares against a user's tickets on one market, oldest
 * first: a ticket sold in full closes with its share of the proceeds; the
 * last, partially sold ticket keeps the remainder of its shares and stake.
 */
export async function closeTicketsFifo(
  db: DB,
  tickets: readonly { id: string; sharesRaw: string | null; stakeRaw: string | null }[],
  soldRaw: bigint,
  proceedsRaw: bigint,
  closeTxHash: string,
): Promise<string[]> {
  const closed: string[] = [];
  let remaining = soldRaw;
  for (const t of tickets) {
    if (remaining <= 0n) break;
    const shares = BigInt(t.sharesRaw ?? "0");
    const stake = BigInt(t.stakeRaw ?? "0");
    if (shares === 0n) continue;
    const sold = remaining < shares ? remaining : shares;
    const proceeds = soldRaw === 0n ? 0n : (proceedsRaw * sold) / soldRaw;
    remaining -= sold;
    if (sold === shares) {
      await db
        .update(combos)
        .set({
          status: "closed",
          closeTxHash: closeTxHash.toLowerCase(),
          proceedsRaw: proceeds.toString(),
          settledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(combos.id, t.id), ne(combos.status, "closed")));
      closed.push(t.id);
    } else {
      const keptShares = shares - sold;
      const keptStake = (stake * keptShares) / shares;
      await db
        .update(combos)
        .set({
          sharesRaw: keptShares.toString(),
          stakeRaw: keptStake.toString(),
          potentialPayoutRaw: keptShares.toString(),
          updatedAt: new Date(),
        })
        .where(eq(combos.id, t.id));
    }
  }
  return closed;
}

export async function markComboRedeemed(db: DB, comboId: string, txHash: string): Promise<boolean> {
  const rows = await db
    .update(combos)
    .set({ redeemedAt: new Date(), redeemTxHash: txHash.toLowerCase(), updatedAt: new Date() })
    .where(and(eq(combos.id, comboId), sql`${combos.redeemedAt} is null`))
    .returning({ id: combos.id });
  return rows.length > 0;
}
