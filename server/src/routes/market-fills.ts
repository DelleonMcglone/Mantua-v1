import { activityUserId, recordActivity } from "../lib/activity.ts";
import { resolveUserId } from "../lib/sports/strategy-store.ts";
import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import type { Log } from "viem";
import { z } from "zod";
import { db } from "../db/client.ts";
import { marketFills, marketPositions, marketPrices, users } from "../db/schema/index.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { getRpcClient } from "../lib/rpc-client.ts";
import { sharedCache } from "../lib/shared-cache.ts";
import { counters } from "../lib/metrics.ts";
import { positionsCacheKey } from "./market-positions.ts";
import { DEFAULT_CHAIN_ID, isSupportedChainId, type SupportedChainId } from "../lib/chains.ts";
import { MARKETS_BY_CHAIN, MARKETS_PERIPHERY_BY_CHAIN } from "../lib/markets-contracts.ts";
import { DYNAMIC_MARKET_BY_CHAIN } from "../lib/v4-contracts.ts";
import { decodeRevertedBuyAmountIn } from "../lib/sports/market-trade-revert.ts";
import { marketTradeSpendUsd } from "../lib/sports/market-trade-build.ts";
import { reverseSpending } from "../lib/spending-cap.ts";
import { fillImpliedProbability } from "../lib/sports/market-metrics.ts";
import {
  NO_FEE_TELEMETRY,
  feeQuoteFromReceiptLogs,
  fillFeeTelemetry,
} from "../lib/sports/market-fee-telemetry.ts";

/** The slice of a viem public client the fill verifier reads. */
export interface FillReceiptReader {
  getTransactionReceipt(args: {
    hash: `0x${string}`;
  }): Promise<{ status: "success" | "reverted"; logs: readonly Log[] }>;
  getTransaction(args: {
    hash: `0x${string}`;
  }): Promise<{ to: `0x${string}` | null; from: `0x${string}`; input: `0x${string}` }>;
}

type NewMarketFill = typeof marketFills.$inferInsert;

/**
 * Seams for `createMarketFillsRouter`. Production reads the chain and
 * writes the real tables; route tests fake the receipt and the fill store
 * so the verify → insert-once → bookkeep sequence runs without a network
 * or a database.
 */
export interface MarketFillsDeps {
  /** Task 062 — the timeline entry for a verified fill (best-effort). */
  recordActivity: typeof recordActivity;
  rpc: (chainId: SupportedChainId) => FillReceiptReader;
  /** Our swap router on this chain — null when markets aren't deployed. */
  swapRouterFor: (chainId: SupportedChainId) => `0x${string}` | null;
  /** The Dynamic Market hook on this chain — null when absent (no fee telemetry). */
  hookFor: (chainId: SupportedChainId) => `0x${string}` | null;
  /** Insert the fill; resolves true when a row was written, false on a
   *  tx_hash conflict (a replayed report). */
  insertFill: (row: NewMarketFill) => Promise<boolean>;
  /** Is this tx already on record? (the trade-status read, R-004) */
  fillExists: (txHash: string) => Promise<boolean>;
  recordArtifacts: typeof recordFillArtifacts;
  /** Drop the wallet's cached positions after a verified fill (R-007). */
  invalidatePositions: (address: string) => Promise<void>;
  /** C-024 — the collateral (USDC) on this chain, for proving a reverted
   *  swap was a BUY from its calldata. Null when markets aren't deployed. */
  collateralFor: (chainId: SupportedChainId) => `0x${string}` | null;
  /** C-024 — give a reverted buy's intent back to the daily ledger. */
  releaseIntent: typeof reverseSpending;
}

async function fillRowExists(txHash: string): Promise<boolean> {
  const rows = await db
    .select({ id: marketFills.id })
    .from(marketFills)
    .where(eq(marketFills.txHash, txHash.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}

/**
 * Phase 7 / R-004 — the states a submitted trade can be in, as the server
 * can verify them from the chain. Never ambiguous: `pending` means the
 * transaction is known to the network and not yet mined; `unknown` means
 * the network has never seen this hash (dropped, replaced, or never
 * broadcast) — the client must not present either as success or failure.
 */
export type TradeTxState = "pending" | "confirmed" | "failed" | "unknown";

export interface TradeStatusResponse {
  txHash: string;
  state: TradeTxState;
  /** True once the verified fill row exists (entry-price/P&L bookkept). */
  recorded: boolean;
}

const statusQuerySchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  chainId: z.coerce.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
});

async function insertFillRow(row: NewMarketFill): Promise<boolean> {
  const inserted = await db
    .insert(marketFills)
    .values(row)
    .onConflictDoNothing({ target: marketFills.txHash })
    .returning({ id: marketFills.id });
  return inserted.length > 0;
}

const bodySchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  direction: z.enum(["buy", "sell"]),
  tokensRaw: z.string().regex(/^\d{1,30}$/),
  usdcRaw: z.string().regex(/^\d{1,30}$/),
  /** Chain the fill happened on — omitted means Base (back-compat). */
  chainId: z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
});

export function createMarketFillsRouter(overrides: Partial<MarketFillsDeps> = {}): Router {
  const deps: MarketFillsDeps = {
    rpc: overrides.rpc ?? getRpcClient,
    swapRouterFor:
      overrides.swapRouterFor ??
      ((chainId) => MARKETS_PERIPHERY_BY_CHAIN[chainId]?.poolSwapTest ?? null),
    hookFor: overrides.hookFor ?? ((chainId) => DYNAMIC_MARKET_BY_CHAIN[chainId]?.hook ?? null),
    insertFill: overrides.insertFill ?? insertFillRow,
    fillExists: overrides.fillExists ?? fillRowExists,
    recordArtifacts: overrides.recordArtifacts ?? recordFillArtifacts,
    invalidatePositions:
      overrides.invalidatePositions ??
      ((address) => sharedCache.invalidate(positionsCacheKey(address))),
    recordActivity: overrides.recordActivity ?? recordActivity,
    collateralFor:
      overrides.collateralFor ?? ((chainId) => MARKETS_BY_CHAIN[chainId]?.collateral ?? null),
    releaseIntent: overrides.releaseIntent ?? reverseSpending,
  };
  const router = Router();

  /**
   * GET /api/markets/trade/status?txHash=&chainId= — Phase 7 / R-004: the
   * server-verified state of a submitted trade, for the ticket's pending
   * state and for recovering an in-flight trade after a reload. Reads the
   * chain, never the client's claim: receipt success → `confirmed`,
   * receipt reverted → `failed`, transaction known but unmined → `pending`,
   * nothing on the network → `unknown`.
   */
  router.get("/api/markets/trade/status", requireAuth, async (req: Request, res: Response) => {
    const parsed = statusQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid status query", code: "BAD_REQUEST" });
      return;
    }
    const txHash = parsed.data.txHash.toLowerCase() as `0x${string}`;
    const chainId = parsed.data.chainId ?? DEFAULT_CHAIN_ID;
    const client = deps.rpc(chainId);
    let state: TradeTxState;
    try {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      state = receipt.status === "success" ? "confirmed" : "failed";
    } catch {
      // No receipt: mined-ness is unknown until we ask whether the network
      // knows the transaction at all.
      try {
        await client.getTransaction({ hash: txHash });
        state = "pending";
      } catch {
        state = "unknown";
      }
    }
    const recorded = await deps.fillExists(txHash).catch(() => false);
    counters.inc(`trade_status.${state}`);
    res.setHeader("Cache-Control", "no-store");
    const body: TradeStatusResponse = { txHash, state, recorded };
    res.json(body);
  });

  /**
   * POST /api/markets/fills — record one confirmed trade for entry-price /
   * P&L accounting (B6-009's final slice).
   *
   * Trust-but-verify: the client reports its own fill, and the server checks
   * the receipt before believing it — the tx must exist, have succeeded,
   * target OUR swap router, and have been sent by the address being credited.
   * Amounts are taken from the quote the client executed against (exact
   * log decoding can tighten this later). `tx_hash` is unique, so replays
   * and double-submits no-op.
   *
   * Daily spending ledger: NOT written here, by design (C-019 / task 050).
   * The buy's spend intent was inked when its calldata was issued
   * (`/api/markets/trade/calldata` → guardSpend); a second write on the
   * fill would double-count one trade, and a replayed fill report would
   * count it again. The fill confirms, it never re-records.
   */
  router.post(
    "/api/markets/fills",
    requireAuth,
    writeRateLimiter,
    async (req: Request, res: Response) => {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid fill", code: "BAD_REQUEST" });
        return;
      }
      const { txHash, marketId, direction, tokensRaw, usdcRaw } = parsed.data;

      try {
        const chainId = parsed.data.chainId ?? DEFAULT_CHAIN_ID;
        const swapRouter = deps.swapRouterFor(chainId);
        if (!swapRouter) {
          res.status(400).json({ error: "Markets not deployed on this chain", code: "BAD_CHAIN" });
          return;
        }
        const client = deps.rpc(chainId);
        const [receipt, tx] = await Promise.all([
          client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
          client.getTransaction({ hash: txHash as `0x${string}` }),
        ]);
        // C-024 — the target check runs BEFORE anything acts on the receipt.
        // A release is only safe once the transaction is proven to be one of
        // ours; checking the status first would let any reverted transaction
        // to any contract reach the release path.
        if (tx.to?.toLowerCase() !== swapRouter.toLowerCase()) {
          counters.inc("fill.wrong_target");
          res.status(422).json({ error: "Not a market trade", code: "WRONG_TARGET" });
          return;
        }
        if (receipt.status !== "success") {
          counters.inc("fill.tx_failed");
          // C-024 — the chain reverted it, so no money moved: give the
          // intent back instead of holding the headroom to the UTC reset.
          const intentReleased = await releaseRevertedIntent(deps, {
            chainId,
            txHash,
            marketId,
            tx,
            userId: await activityUserId(db, resolveUserId, req.privyUserId),
          });
          res
            .status(422)
            .json({ error: "Transaction did not succeed", code: "TX_FAILED", intentReleased });
          return;
        }

        const address = tx.from.toLowerCase();
        // H-011 — the fee this trade paid, from the hook's own log in the
        // verified receipt (never from the client). Absent hook config or
        // absent event → nulls, the row still records the fill.
        const hook = deps.hookFor(chainId);
        const feeQuote = hook
          ? feeQuoteFromReceiptLogs(receipt.logs, hook, direction, tokensRaw, usdcRaw)
          : null;
        const fee = hook ? fillFeeTelemetry(feeQuote) : NO_FEE_TELEMETRY;
        const inserted = await deps.insertFill({
          address,
          marketId,
          direction,
          tokensRaw,
          usdcRaw,
          txHash: txHash.toLowerCase(),
          ...fee,
        });

        // P-011 + P-006 — the receipt-verified fill is the server-side event
        // every downstream record derives from: one price tick (the trade's
        // effective price) and the position-mirror update. Both are gated on
        // the fill actually inserting, so a re-POST of the same tx (conflict
        // → no row returned) writes nothing twice. Best-effort: the fill row
        // is the primary record; bookkeeping failures log, never 500.
        if (inserted) {
          // Phase 7 / R-007 — the wallet's cached positions are stale the
          // moment a fill lands; drop them so the next read re-marks.
          await deps.invalidatePositions(address).catch(() => undefined);
          // Task 062 / PF-015 — the user's timeline entry for the trade.
          const userId = await activityUserId(db, resolveUserId, req.privyUserId);
          await deps.recordActivity(db, {
            kind: direction === "sell" ? "market_sell" : "market_buy",
            actor: "user",
            userId,
            walletAddress: address,
            txHash: txHash.toLowerCase(),
            chainId,
            marketId,
            asset: "YES",
            amountRaw: tokensRaw,
            valueUsd: Number(usdcRaw) / 1e6,
            data: { direction, usdcRaw, tokensRaw, feeUsdcRaw: fee.feeUsdcRaw ?? null },
          });
          try {
            // requireAuth guarantees privyUserId; belt-and-braces fallback.
            if (req.privyUserId) {
              await deps.recordArtifacts(
                req.privyUserId,
                marketId,
                direction,
                tokensRaw,
                usdcRaw,
                address,
              );
            }
          } catch (err) {
            logger.warn({ err, txHash }, "market-fills: tick/position bookkeeping failed");
          }
        }
        counters.inc(inserted ? "fill.recorded" : "fill.replayed");
        res.status(201).json({ ok: true, recorded: true });
      } catch (err) {
        counters.inc("fill.verify_failed");
        logger.warn({ err, txHash }, "market-fills: verification failed");
        res.status(422).json({ error: "Couldn't verify the transaction", code: "VERIFY_FAILED" });
      }
    },
  );

  return router;
}

export const marketFillsRouter = createMarketFillsRouter();

/**
 * C-024 — hand back the daily-cap intent behind a market buy the chain
 * reverted. Returns whether headroom was actually released.
 *
 * Two properties make this safe to expose to a caller-driven endpoint:
 *
 *  - **the amount is the user's own signed bytes.** `decodeRevertedBuyAmountIn`
 *    reads it out of the transaction input and refuses anything that is not
 *    a collateral-funded exact-input swap, so the reported `usdcRaw` — which
 *    a caller controls — never reaches the ledger.
 *  - **exactly once per transaction.** The activity spine carries a unique
 *    index on (tx_hash, kind), so `recordActivity` returns a row the first
 *    time this failure is reported and null on every replay. Claiming the
 *    entry BEFORE releasing means a crash between the two leaves the intent
 *    held rather than released twice: over-counting spend is safe, and
 *    under-counting is the bug the cap exists to prevent.
 */
async function releaseRevertedIntent(
  deps: MarketFillsDeps,
  args: {
    chainId: SupportedChainId;
    txHash: string;
    marketId: string;
    tx: { from: `0x${string}`; input: `0x${string}` };
    userId: string | null;
  },
): Promise<boolean> {
  const collateral = deps.collateralFor(args.chainId);
  if (!collateral) return false;
  const amountIn = decodeRevertedBuyAmountIn(args.tx.input, collateral);
  if (amountIn === null) return false;
  const usd = marketTradeSpendUsd("buy", amountIn);
  if (usd === null || usd <= 0) return false;

  const address = args.tx.from.toLowerCase();
  const entry = await deps.recordActivity(db, {
    kind: "market_buy",
    actor: "user",
    status: "failed",
    userId: args.userId,
    walletAddress: address,
    txHash: args.txHash.toLowerCase(),
    chainId: args.chainId,
    marketId: args.marketId,
    asset: "YES",
    amountRaw: amountIn.toString(),
    valueUsd: usd,
    data: { direction: "buy", reverted: true, releasedUsd: usd },
  });
  if (!entry) return false;

  try {
    await deps.releaseIntent(address, usd);
  } catch (err) {
    logger.warn({ err, txHash: args.txHash }, "market-fills: cap release failed");
    return false;
  }
  counters.inc("fill.intent_released");
  return true;
}

/** users.id for the authenticated caller, inserting the row on first sight
 *  (the fiat-store ensureUser pattern). */
async function ensureUserId(privyUserId: string, primaryAddress: string): Promise<string> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const found = existing.at(0);
  if (found) return found.id;
  const inserted = await db
    .insert(users)
    .values({ privyUserId, primaryAddress })
    .onConflictDoNothing({ target: users.privyUserId })
    .returning({ id: users.id });
  const row = inserted.at(0);
  if (row) return row.id;
  const reread = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const rerow = reread.at(0);
  if (!rerow) throw new Error("could not ensure a users row for the fill");
  return rerow.id;
}

/**
 * The per-fill bookkeeping behind P-011/P-006:
 *
 *  - **price tick** — the fill's effective price (`usdc / tokens`) lands in
 *    `market_prices` as source `fill`, which is what the chart, history.ts
 *    and the agent's price tools read;
 *  - **position mirror** — one aggregate `market_positions` row per
 *    (market, wallet, side). Buys grow `size` and re-average `entryPrice`
 *    in a single atomic upsert (RHS expressions see the OLD row, so the
 *    weighted average is race-safe under the unique); sells shrink `size`
 *    at average cost, floored at zero. Fills index YES-side trades, so
 *    `side` is always "yes" here.
 *
 * Exported for the scratch-DB migration smoke.
 */
export async function recordFillArtifacts(
  privyUserId: string,
  marketId: string,
  direction: "buy" | "sell",
  tokensRaw: string,
  usdcRaw: string,
  address: string,
): Promise<void> {
  const probability = fillImpliedProbability(usdcRaw, tokensRaw);
  if (probability !== null) {
    await db.insert(marketPrices).values({
      marketId,
      impliedProbability: probability,
      source: "fill",
    });
  }

  const tokens = sql`${tokensRaw}::numeric`;
  if (direction === "buy") {
    const userId = await ensureUserId(privyUserId, address);
    await db
      .insert(marketPositions)
      .values({
        userId,
        marketId,
        walletAddress: address,
        side: "yes",
        size: tokensRaw,
        entryPrice: probability,
      })
      .onConflictDoUpdate({
        target: [marketPositions.marketId, marketPositions.walletAddress, marketPositions.side],
        set: {
          // Weighted-average entry across the aggregate; every RHS reads
          // the pre-update row, so entryPrice averages over the OLD size.
          entryPrice:
            probability === null
              ? sql`${marketPositions.entryPrice}`
              : sql`round(((coalesce(${marketPositions.entryPrice}, 0) * ${marketPositions.size} + ${probability}::numeric * ${tokens}) / nullif(${marketPositions.size} + ${tokens}, 0)), 5)`,
          size: sql`${marketPositions.size} + ${tokens}`,
          updatedAt: sql`now()`,
        },
      });
    return;
  }

  // Sell: reduce the aggregate at average cost. Tokens sold that the mirror
  // never saw bought (e.g. acquired by split) floor at zero rather than
  // going negative — the chain stays authoritative for actual balances.
  await db
    .update(marketPositions)
    .set({ size: sql`greatest(${marketPositions.size} - ${tokens}, 0)`, updatedAt: sql`now()` })
    .where(
      and(
        eq(marketPositions.marketId, marketId),
        eq(marketPositions.walletAddress, address),
        eq(marketPositions.side, "yes"),
      ),
    );
}
