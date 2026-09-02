import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { encodeFunctionData } from "viem";
import { db } from "../db/client.ts";
import { pools as poolsTable } from "../db/schema/trading.ts";
import { DEFAULT_CHAIN_ID, isSupportedChainId } from "../lib/chains.ts";
import { resolveHookForPool } from "../lib/hook-pair-gating.ts";
import { logAudit } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { buildPoolKey } from "../lib/pool-key.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { encodeSqrtPriceX96 } from "../lib/sqrt-price.ts";
import { getToken, isTokenSymbol } from "../lib/tokens.ts";
import { readSlot0 } from "../lib/v4-state-view.ts";
import {
  HOOK_NAMES,
  POOL_MANAGER_INITIALIZE_ABI,
  getV4StackForHook,
  isFeeTier,
} from "../lib/v4-contracts.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { keccak256, toHex } from "viem";

export const poolCreateRouter = Router();

const hookSchema = z.enum(HOOK_NAMES);

/** Supported chain ids — Base Mainnet. */
const chainIdSchema = z
  .number()
  .int()
  .refine(isSupportedChainId, "Unsupported chainId")
  .default(DEFAULT_CHAIN_ID);

const calldataSchema = z.object({
  chainId: chainIdSchema,
  tokenA: z.string(),
  tokenB: z.string(),
  fee: z.number().int().refine(isFeeTier, "Fee tier must be 100/500/3000/10000"),
  /** Optional hook binding. Omitted (or null) creates a no-hook pool. */
  hook: hookSchema.nullable().optional(),
  /** Initial price expressed as raw amounts of each side (base units). */
  initialAmount0Raw: z.string().regex(/^\d+$/),
  initialAmount1Raw: z.string().regex(/^\d+$/),
});

poolCreateRouter.post(
  "/api/pools/create/calldata",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = calldataSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const { chainId, tokenA, tokenB, fee, hook, initialAmount0Raw, initialAmount1Raw } =
      parsed.data;
    if (!isTokenSymbol(tokenA, chainId)) {
      res.status(400).json({
        error: `Unknown tokenA on chain ${String(chainId)}: ${tokenA}`,
        code: "BAD_REQUEST",
      });
      return;
    }
    if (!isTokenSymbol(tokenB, chainId)) {
      res.status(400).json({
        error: `Unknown tokenB on chain ${String(chainId)}: ${tokenB}`,
        code: "BAD_REQUEST",
      });
      return;
    }
    if (tokenA === tokenB) {
      res.status(400).json({ error: "tokenA and tokenB must differ", code: "BAD_REQUEST" });
      return;
    }
    try {
      const hookAddress = resolveHookForPool(
        hook ?? null,
        getToken(tokenA, chainId).address,
        getToken(tokenB, chainId).address,
        chainId,
      );
      // Hooks like Stable Protection require key.fee == DYNAMIC_FEE_FLAG
      // and revert in beforeInitialize otherwise. `buildPoolKey` applies
      // `effectivePoolFee` when `hookName` is provided so the user's
      // static-tier choice still drives tickSpacing while the fee field
      // is overridden when the bound hook demands it.
      const { key, flipped } = buildPoolKey(
        tokenA,
        tokenB,
        fee,
        hookAddress,
        hook ?? null,
        chainId,
      );

      // Preflight: PoolManager rejects re-initialization, but the revert
      // bubbles through the wallet as "exceeds max transaction gas limit"
      // (the RPC's eth_estimateGas falls back to the block cap when the
      // call reverts). Reading slot0 lets us return a clean 409 with
      // the existing PoolKey so the client can route to add-liquidity.
      const existing = await readSlot0(key, chainId);
      if (existing) {
        res.status(409).json({
          error: "Pool already exists. You can add liquidity to it.",
          code: "POOL_ALREADY_EXISTS",
          details: {
            poolKey: { ...key, sqrtPriceX96: existing.sqrtPriceX96.toString() },
            hook: hook ?? null,
          },
        });
        return;
      }

      const a0 = BigInt(initialAmount0Raw);
      const a1 = BigInt(initialAmount1Raw);
      // Every hook (incl. the FX-aware Stable Protection) opens at the
      // amount-derived market price. SP used to be forced to 1:1 because its
      // breaker measured deviation from parity — but the hook now anchors to a
      // live EUR/USD reference (set by the peg-sync keeper), so a market-priced
      // USDC/EURC pool reads HEALTHY and forcing 1:1 would instead trip it.
      const sqrtPriceX96 = encodeSqrtPriceX96(
        flipped ? { amount0Raw: a1, amount1Raw: a0 } : { amount0Raw: a0, amount1Raw: a1 },
      );
      const data = encodeFunctionData({
        abi: POOL_MANAGER_INITIALIZE_ABI,
        functionName: "initialize",
        args: [key, sqrtPriceX96],
      });
      res.json({
        // Initialize on the PoolManager for this pool's hook stack.
        to: getV4StackForHook(key.hooks, chainId).poolManager,
        chainId,
        data,
        value: "0",
        poolKey: { ...key, sqrtPriceX96: sqrtPriceX96.toString() },
        hook: hook ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "calldata failed";
      logger.warn({ err, hook }, "POST /api/pools/create/calldata failed");
      res.status(400).json({ error: message, code: "POOL_CREATE_INVALID" });
    }
  },
);

const recordSchema = z.object({
  chainId: chainIdSchema,
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  tokenA: z.string(),
  tokenB: z.string(),
  fee: z.number().int().refine(isFeeTier),
  hook: hookSchema.nullable().optional(),
  outcome: z.enum(["success", "failure"]),
});

poolCreateRouter.post(
  "/api/pools/create/record",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = recordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", code: "BAD_REQUEST" });
      return;
    }
    const ctx = getRequestContext(req);
    const { chainId, txHash, tokenA, tokenB, fee, hook, outcome } = parsed.data;
    if (!isTokenSymbol(tokenA, chainId) || !isTokenSymbol(tokenB, chainId)) {
      res.status(400).json({ error: "Unknown token symbol for chain", code: "BAD_REQUEST" });
      return;
    }
    let hookAddress: `0x${string}`;
    try {
      hookAddress = resolveHookForPool(
        hook ?? null,
        getToken(tokenA, chainId).address,
        getToken(tokenB, chainId).address,
        chainId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "record failed";
      res.status(400).json({ error: message, code: "POOL_CREATE_INVALID" });
      return;
    }
    const { key } = buildPoolKey(tokenA, tokenB, fee, hookAddress, hook ?? null, chainId);
    const poolKeyHash = keccak256(
      toHex(
        `${key.currency0}|${key.currency1}|${String(key.fee)}|${String(key.tickSpacing)}|${key.hooks}|${String(chainId)}`,
      ),
    );

    if (outcome === "success") {
      try {
        await db.insert(poolsTable).values({
          chainId,
          poolKeyHash,
          token0: getToken(tokenA, chainId).address,
          token1: getToken(tokenB, chainId).address,
          fee: key.fee,
          tickSpacing: key.tickSpacing,
          hookAddress: key.hooks,
          hookType: hook ?? "none",
          createdTx: txHash,
        });
      } catch (err) {
        logger.warn({ err, poolKeyHash }, "pools insert failed (likely duplicate)");
      }
    }
    await logAudit({
      ...ctx,
      chainId,
      action: "create_pool",
      outcome,
      txHash,
      params: { chainId, tokenA, tokenB, fee, hook: hook ?? null, poolKeyHash },
    });
    res.json({ ok: true, poolKeyHash });
  },
);
