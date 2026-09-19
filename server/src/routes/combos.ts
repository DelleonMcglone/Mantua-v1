import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { readPolicy } from "../lib/agent/policy.ts";
import { BASE_CHAIN_ID, isSupportedChainId } from "../lib/chains.ts";
import { prepareComboMarket } from "../lib/combos/combo-prepare.ts";
import { platformLimits, quoteComboTicket } from "../lib/combos/combo-quote.ts";
import { playoffsLookup } from "../lib/combos/combo-season.ts";
import { readComboTickets } from "../lib/combos/combo-tickets.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { MarketsNotDeployedError } from "../lib/sports/market-trade-build.ts";
import { resolveUserId } from "../lib/sports/strategy-store.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

/**
 * Task 072 / CB-002 … CB-005, CB-008 — the combo builder's reads and the
 * market preparation. `GET /api/combos` lists the caller's tickets marked
 * at the pool price; `POST /api/combos/quote` runs the rules, the policy
 * gate and the pricing engine for a leg set and stake (no ink, no cap
 * touch); `POST /api/combos/prepare` creates the conjunction market on
 * chain when absent — behind the same rules, the policy switch and the
 * operator's capacity, since the seed leaves the signer wallet here.
 */

export const legsSchema = z
  .array(
    z.object({
      providerEventId: z.string().min(1).max(32),
      outcomeIndex: z.union([z.literal(0), z.literal(1)]),
    }),
  )
  .min(1)
  .max(8);

const chainSchema = z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional();
const quoteSchema = z.object({
  legs: legsSchema,
  stakeRaw: z
    .string()
    .regex(/^\d+$/)
    .refine((v) => BigInt(v) > 0n && BigInt(v) <= 100_000_000_000n, {
      message: "stake out of range",
    }),
  chainId: chainSchema,
});
const prepareSchema = z.object({ legs: legsSchema.min(2), chainId: chainSchema });

async function userIdFor(req: Request, res: Response): Promise<string | null> {
  const userId = req.privyUserId ? await resolveUserId(db, req.privyUserId) : null;
  if (!userId) res.status(401).json({ error: "No user record", code: "USER_REQUIRED" });
  return userId;
}

export const combosRouter = Router();

combosRouter.get("/api/combos", requireAuth, async (req: Request, res: Response) => {
  const userId = await userIdFor(req, res);
  if (!userId) return;
  try {
    const [tickets, policy] = await Promise.all([
      readComboTickets(db, userId),
      readPolicy(db, userId),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ tickets, limits: { platform: platformLimits(), policy: policy.combo } });
  } catch (err) {
    logger.warn({ err }, "combos: listing failed");
    res.status(500).json({ error: "Failed to load combos", code: "INTERNAL" });
  }
});

combosRouter.post("/api/combos/quote", requireAuth, async (req: Request, res: Response) => {
  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid combo", code: "BAD_REQUEST", details: parsed.error.issues });
    return;
  }
  const userId = await userIdFor(req, res);
  if (!userId) return;
  try {
    const quote = await quoteComboTicket(db, {
      userId,
      legs: parsed.data.legs,
      stakeRaw: BigInt(parsed.data.stakeRaw),
      chainId: parsed.data.chainId ?? BASE_CHAIN_ID,
      policy: await readPolicy(db, userId),
      playoffsOf: await playoffsLookup(),
    });
    res.status(quote.ok ? 200 : 422).json(quote);
  } catch (err) {
    logger.warn({ err }, "combos: quote failed");
    res.status(502).json({ error: "Couldn't quote this combo", code: "QUOTE_FAILED" });
  }
});

combosRouter.post(
  "/api/combos/prepare",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = prepareSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid combo", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const userId = await userIdFor(req, res);
    if (!userId) return;
    const chainId = parsed.data.chainId ?? BASE_CHAIN_ID;
    try {
      const result = await prepareComboMarket(db, {
        userId,
        walletAddress:
          getRequestContext(req).walletAddress ?? "0x0000000000000000000000000000000000000000",
        legs: parsed.data.legs,
        chainId,
        policy: await readPolicy(db, userId),
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      switch (result.kind) {
        case "refused":
          res.status(422).json({
            error: "These legs cannot be combined",
            code: "COMBO_RULES",
            details: result.violations,
          });
          return;
        case "disabled":
          res
            .status(400)
            .json({ error: "Combos are switched off in your policy", code: "COMBO_POLICY" });
          return;
        case "no_market":
          res.status(404).json({ error: "A leg has no market yet", code: "NO_MARKET" });
          return;
        case "capacity":
          res.status(409).json({
            error: "No capacity for a new combo market right now",
            code: "COMBO_CAPACITY",
            details: result,
          });
          return;
        case "no_signer":
          res.status(503).json({
            error: "Combo markets cannot be created on this deployment",
            code: "COMBO_SIGNER_UNAVAILABLE",
          });
          return;
        case "failed":
          res.status(502).json({ error: result.error, code: "COMBO_CREATE_FAILED" });
          return;
        case "ready":
          res.json({
            marketId: result.plan.marketId,
            label: result.plan.label,
            created: result.created,
            ...result.onChain,
          });
          return;
      }
    } catch (err) {
      if (err instanceof MarketsNotDeployedError) {
        res.status(503).json({ error: err.message, code: "MARKETS_NOT_DEPLOYED" });
        return;
      }
      logger.warn({ err }, "combos: prepare failed");
      res.status(502).json({ error: "Couldn't prepare this combo", code: "PREPARE_FAILED" });
    }
  },
);
