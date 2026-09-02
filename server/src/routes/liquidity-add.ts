import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { pools, portfolioTransactions, positions } from "../db/schema/trading.ts";
import { users } from "../db/schema/users.ts";
import { logAudit } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { buildPermit2BatchTypedData } from "../lib/permit2.ts";
import { buildPoolKey } from "../lib/pool-key.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { resolveHookForPool } from "../lib/hook-pair-gating.ts";
import { getToken } from "../lib/tokens.ts";
import { tokenAmountUsd } from "../lib/usd-pricing.ts";
import { buildAddLiquidityCalldata } from "../lib/v4-add-liquidity.ts";
import { readSlot0 } from "../lib/v4-state-view.ts";
import { PERMIT2 } from "../lib/v4-contracts.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { calldataSchema, recordSchema } from "./liquidity-add-schemas.ts";

import type { PermitBatchInput, PermitBatchTypedData } from "../lib/permit2.ts";

interface PermitBatchWire {
  details: { token: `0x${string}`; amount: string; expiration: number; nonce: number }[];
  spender: `0x${string}`;
  sigDeadline: string;
}

function serializePermitBatch(p: PermitBatchInput): PermitBatchWire {
  return {
    details: p.details.map((d) => ({
      token: d.token,
      amount: d.amount.toString(),
      expiration: d.expiration,
      nonce: d.nonce,
    })),
    spender: p.spender,
    sigDeadline: p.sigDeadline.toString(),
  };
}

function serializeTypedData(t: PermitBatchTypedData) {
  return {
    domain: t.domain,
    types: t.types,
    primaryType: t.primaryType,
    message: serializePermitBatch(t.message),
  };
}

export const liquidityAddRouter = Router();

liquidityAddRouter.post(
  "/api/liquidity/add/calldata",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = calldataSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        code: "BAD_REQUEST",
        details: parsed.error.issues,
      });
      return;
    }
    const ctx = getRequestContext(req);
    if (!ctx.walletAddress) {
      res.status(401).json({ error: "Wallet not linked", code: "WALLET_REQUIRED" });
      return;
    }
    if (parsed.data.tokenA === parsed.data.tokenB) {
      res.status(400).json({ error: "tokenA and tokenB must differ", code: "BAD_REQUEST" });
      return;
    }
    const { chainId } = parsed.data;
    try {
      const hookName = parsed.data.hook ?? null;
      const hookAddress = resolveHookForPool(
        hookName,
        getToken(parsed.data.tokenA, chainId).address,
        getToken(parsed.data.tokenB, chainId).address,
        chainId,
      );
      let sqrtPriceX96: bigint;
      if (parsed.data.sqrtPriceX96) {
        sqrtPriceX96 = BigInt(parsed.data.sqrtPriceX96);
      } else {
        const { key } = buildPoolKey(
          parsed.data.tokenA,
          parsed.data.tokenB,
          parsed.data.fee,
          hookAddress,
          hookName,
          chainId,
        );
        const slot0 = await readSlot0(key, chainId);
        if (!slot0) {
          res.status(400).json({
            error: "Pool not initialized — create it first",
            code: "POOL_NOT_INITIALIZED",
          });
          return;
        }
        sqrtPriceX96 = slot0.sqrtPriceX96;
      }
      const result = buildAddLiquidityCalldata({
        tokenA: parsed.data.tokenA,
        tokenB: parsed.data.tokenB,
        fee: parsed.data.fee,
        hookAddress,
        hookName,
        amountARaw: BigInt(parsed.data.amountARaw),
        amountBRaw: BigInt(parsed.data.amountBRaw),
        sqrtPriceX96,
        slippageBps: parsed.data.slippageBps,
        owner: ctx.walletAddress as `0x${string}`,
        deadlineSeconds: parsed.data.deadlineSeconds,
        chainId,
      });

      const owner = ctx.walletAddress as `0x${string}`;
      const permit2Build = await buildPermit2BatchTypedData({
        owner,
        chainId,
        // result.to is the per-hook PositionManager — approve THAT as spender.
        positionManager: result.to,
        tokens: [
          { address: result.currency0, amountNeeded: BigInt(result.amount0Max) },
          { address: result.currency1, amountNeeded: BigInt(result.amount1Max) },
        ],
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      res.json({
        ...result,
        sqrtPriceX96: sqrtPriceX96.toString(),
        permit2: permit2Build
          ? {
              permit2Address: PERMIT2,
              typedData: serializeTypedData(permit2Build.typedData),
              permitBatch: serializePermitBatch(permit2Build.permitBatch),
            }
          : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "calldata failed";
      logger.warn({ err }, "POST /api/liquidity/add/calldata failed");
      res.status(400).json({ error: message, code: "ADD_LIQUIDITY_INVALID" });
    }
  },
);

liquidityAddRouter.post(
  "/api/liquidity/add/record",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = recordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", code: "BAD_REQUEST" });
      return;
    }
    const ctx = getRequestContext(req);
    if (!ctx.walletAddress || !req.privyUserId) {
      res.status(401).json({ error: "Auth required", code: "UNAUTHENTICATED" });
      return;
    }
    const v = parsed.data;
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.privyUserId, req.privyUserId))
      .limit(1);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- drizzle types the row as defined, but the array is empty for an unknown user.
    if (!user) {
      res.status(404).json({ error: "User not found", code: "USER_NOT_FOUND" });
      return;
    }

    const usdValue = await tokenAmountUsd(v.tokenA, BigInt(v.amountARaw));
    const params = {
      chainId: v.chainId,
      tokenA: v.tokenA,
      tokenB: v.tokenB,
      fee: v.fee,
      amountARaw: v.amountARaw,
      amountBRaw: v.amountBRaw,
      liquidity: v.liquidity,
      tickLower: v.tickLower,
      tickUpper: v.tickUpper,
      poolKeyHash: v.poolKeyHash,
    };

    await db.insert(portfolioTransactions).values({
      userId: user.id,
      walletAddress: ctx.walletAddress,
      action: "add_liquidity",
      txHash: v.txHash,
      chainId: v.chainId,
      params,
      outcome: v.outcome,
      usdValue: usdValue > 0 ? usdValue.toFixed(2) : null,
    });

    if (v.outcome === "success") {
      const [pool] = await db
        .select({ id: pools.id })
        .from(pools)
        .where(eq(pools.poolKeyHash, v.poolKeyHash))
        .limit(1);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- drizzle types the row as defined, but the array is empty when the pool isn't tracked yet.
      if (pool) {
        await db.insert(positions).values({
          userId: user.id,
          poolId: pool.id,
          ...(v.tokenId ? { tokenId: v.tokenId } : {}),
          tickLower: v.tickLower,
          tickUpper: v.tickUpper,
          liquidity: v.liquidity,
          status: "open",
          openedTx: v.txHash,
        });
      }
    }
    await logAudit({
      ...ctx,
      chainId: v.chainId,
      action: "add_liquidity",
      outcome: v.outcome,
      txHash: v.txHash,
      params,
    });
    res.json({ ok: true });
  },
);
