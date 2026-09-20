import { Router, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { custodyDestinations, custodyWithdrawals } from "../db/schema/institutions.ts";
import { BASE_CHAIN_ID, isSupportedChainId } from "../lib/chains.ts";
import { requestWithdrawal } from "../lib/custody/custody-withdrawal-request.ts";
import { isTokenSymbol } from "../lib/tokens.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { allow, memberContext } from "./institution-context.ts";
import {
  respondWithdrawal,
  withdrawalAuditFor,
  withdrawalFailure,
} from "./institution-withdrawal-respond.ts";

/**
 * Task 073 / IC-001 — withdrawals: the institution's list and a member's
 * request. Decisions and cancellation live in
 * `institution-withdrawals-decide.ts`; the library owns the rules.
 */

export const institutionWithdrawalsRouter = Router();

const requestSchema = z.object({
  destinationId: z.uuid(),
  symbol: z.string().refine(isTokenSymbol, "Unsupported token"),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string"),
  chainId: z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
});

institutionWithdrawalsRouter.get("/api/institution/withdrawals", requireAuth, async (req, res) => {
  const ctx = await memberContext(req, res);
  if (!ctx) return;
  const rows = await db
    .select({ w: custodyWithdrawals, destination: custodyDestinations.label })
    .from(custodyWithdrawals)
    .innerJoin(custodyDestinations, eq(custodyDestinations.id, custodyWithdrawals.destinationId))
    .where(eq(custodyWithdrawals.institutionId, ctx.institution.id))
    .orderBy(desc(custodyWithdrawals.createdAt))
    .limit(50);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ withdrawals: rows.map((r) => ({ ...r.w, destination: r.destination })) });
});

institutionWithdrawalsRouter.post(
  "/api/institution/withdrawals",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid withdrawal", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const ctx = await memberContext(req, res);
    if (!ctx || !allow(ctx, "request_withdrawal", res) || !req.privyUserId) return;
    try {
      respondWithdrawal(
        res,
        await requestWithdrawal(db, {
          userId: ctx.userId,
          privyUserId: req.privyUserId,
          destinationId: parsed.data.destinationId,
          symbol: parsed.data.symbol,
          amount: parsed.data.amount,
          chainId: parsed.data.chainId ?? BASE_CHAIN_ID,
          audit: withdrawalAuditFor(req),
        }),
      );
    } catch (err) {
      withdrawalFailure(res, err, "WITHDRAWAL_FAILED", "request the withdrawal");
    }
  },
);
