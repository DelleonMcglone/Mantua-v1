/**
 * B4-006 — the Drizzle-backed resolution log, and the DB reconcile that keeps
 * `markets` rows in step with what actually happened on-chain.
 *
 * One row per settlement action, written only after a transaction hash exists.
 * The chain is the record and the DB reflects it (spec §3.5) — which is why
 * `record` takes the hash as an input rather than writing an intent row first
 * and filling it in later: there is no state in which the log claims something
 * the chain has not done.
 */

import { eq } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { markets, resolutions } from "../../db/schema/index.ts";
import type { ResolutionLogWriter, ResolutionRecord } from "./resolution.ts";

/**
 * Map the service's vocabulary onto the schema's `method` column, which
 * predates it: `auto` for an automated resolve, `void` for a void (the schema
 * treats void as its own method with a null outcome), `manual` reserved for
 * operator overrides recorded by hand.
 */
function methodFor(record: ResolutionRecord): "auto" | "void" {
  return record.kind === "void" ? "void" : "auto";
}

export function drizzleResolutionLog(db: DB): ResolutionLogWriter {
  return {
    async record(entry: ResolutionRecord): Promise<void> {
      await db.insert(resolutions).values({
        marketId: entry.marketId,
        winningOutcomeIndex: entry.outcome,
        method: methodFor(entry),
        source: entry.source,
        sourcePayload: { providerEventId: entry.providerEventId },
        signer: entry.signer,
        txHash: entry.txHash,
      });

      // Reconcile the market row. `onConflictDoNothing`-style tolerance: the
      // row may not exist yet if market creation lagged the event feed, and a
      // missing row must not fail the log write that records a real tx.
      await db
        .update(markets)
        .set(
          entry.kind === "void"
            ? { state: "INVALID", resolvedAt: new Date() }
            : { state: "RESOLVED", resolvedAt: new Date() },
        )
        .where(eq(markets.marketId, entry.marketId));
    },
  };
}
