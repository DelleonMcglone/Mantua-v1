import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.ts";
import { buildPoolKey } from "../lib/pool-key.ts";
import { readSlot0 } from "../lib/v4-state-view.ts";
import { slot0QuerySchema } from "./pool-state-schemas.ts";

export const poolStateRouter = Router();

/**
 * GET /api/pool-state — read live slot0 (sqrtPriceX96, tick) for a v4
 * pool keyed by tokenA + tokenB + fee. Used by the Add-liquidity flow
 * for existing-pool support and by the Remove flow for live slippage
 * bounds. Returns `{ exists: false }` if the pool isn't initialized
 * on-chain.
 */
poolStateRouter.get("/api/pool-state", async (req: Request, res: Response) => {
  const parsed = slot0QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid query", code: "BAD_REQUEST", details: parsed.error.issues });
    return;
  }
  if (parsed.data.tokenA === parsed.data.tokenB) {
    res.status(400).json({ error: "tokenA and tokenB must differ", code: "BAD_REQUEST" });
    return;
  }
  try {
    const { chainId } = parsed.data;
    const { key } = buildPoolKey(
      parsed.data.tokenA,
      parsed.data.tokenB,
      parsed.data.fee,
      undefined,
      null,
      chainId,
    );
    const slot0 = await readSlot0(key, chainId);
    if (!slot0) {
      res.json({ exists: false });
      return;
    }
    res.json({
      exists: true,
      sqrtPriceX96: slot0.sqrtPriceX96.toString(),
      tick: slot0.tick,
    });
  } catch (err) {
    logger.warn({ err }, "GET /api/pool-state failed");
    res.status(502).json({ error: "RPC read failed", code: "RPC_FAILED" });
  }
});
