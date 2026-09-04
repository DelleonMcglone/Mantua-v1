import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logAudit } from "../lib/audit.ts";
import {
  FiatRailsUnavailableError,
  createSandboxTransfer,
  getFiatRailState,
  linkSandboxBank,
} from "../lib/fiat-rails.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export const fiatRailsRouter = Router();
const amountSchema = z.object({
  amountUsd: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((v) => Number(v) > 0 && Number(v) <= 100_000),
});

function unavailable(res: Response, err: unknown): boolean {
  if (!(err instanceof FiatRailsUnavailableError)) return false;
  res.status(503).json({ error: err.message, code: "FIAT_RAILS_UNAVAILABLE" });
  return true;
}

fiatRailsRouter.get("/api/fiat-rails", requireAuth, (req: Request, res: Response) => {
  const userId = req.privyUserId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
    return;
  }
  res.json(getFiatRailState(userId));
});

fiatRailsRouter.post(
  "/api/fiat-rails/bank-link",
  writeRateLimiter,
  requireAuth,
  async (req, res) => {
    const userId = req.privyUserId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    try {
      const result = linkSandboxBank(userId);
      await logAudit({
        ...getRequestContext(req),
        action: "fiat_bank_link",
        outcome: "success",
        params: { provider: "plaid", mode: "sandbox" },
      });
      res.json(result);
    } catch (err) {
      if (unavailable(res, err)) return;
      throw err;
    }
  },
);

for (const kind of ["deposit", "withdraw"] as const) {
  fiatRailsRouter.post(
    `/api/fiat-rails/${kind}s`,
    writeRateLimiter,
    requireAuth,
    async (req, res) => {
      const userId = req.privyUserId;
      if (!userId) {
        res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
        return;
      }
      const parsed = amountSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Enter a dollar amount up to $100,000.", code: "BAD_REQUEST" });
        return;
      }
      try {
        const transfer = createSandboxTransfer(userId, kind, parsed.data.amountUsd);
        await logAudit({
          ...getRequestContext(req),
          action: kind === "deposit" ? "fiat_deposit" : "fiat_withdraw",
          outcome: "pending",
          params: { amountUsd: parsed.data.amountUsd, provider: "zerohash", mode: "sandbox" },
        });
        res.status(202).json(transfer);
      } catch (err) {
        if (unavailable(res, err)) return;
        throw err;
      }
    },
  );
}
