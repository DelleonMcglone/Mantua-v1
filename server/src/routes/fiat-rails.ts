import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logAudit } from "../lib/audit.ts";
import {
  FiatRailsUnavailableError,
  completeBankLinkExchange,
  createFiatLinkToken,
  createFiatTransfer,
  getFiatRailState,
  linkSandboxBank,
} from "../lib/fiat-rails.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

/**
 * Fiat rails product contract (D-101). The user-facing shape is dollars and
 * clear status only — Plaid/Zero Hash/wallet choreography stays server-side.
 *
 * F-002 endpoints:
 *   POST /api/fiat/link-token — mint a Plaid Link token for the authed user.
 *   POST /api/fiat/exchange   — receive Link's short-lived public token; the
 *                               server exchanges it and creates the Zero Hash
 *                               external account. Raw account numbers and the
 *                               Plaid access token never transit this route's
 *                               request or response (D-101 — see
 *                               lib/plaid-fiat.ts for the boundary comments).
 */
export const fiatRailsRouter = Router();
const amountSchema = z.object({
  amountUsd: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((v) => Number(v) > 0 && Number(v) <= 100_000),
});
const exchangeSchema = z.object({
  publicToken: z.string().min(1).max(256),
});

function unavailable(res: Response, err: unknown): boolean {
  if (!(err instanceof FiatRailsUnavailableError)) return false;
  res.status(503).json({ error: err.message, code: "FIAT_RAILS_UNAVAILABLE" });
  return true;
}

function authedUser(req: Request, res: Response): string | null {
  const userId = req.privyUserId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
    return null;
  }
  return userId;
}

fiatRailsRouter.get("/api/fiat-rails", requireAuth, async (req: Request, res: Response) => {
  const userId = authedUser(req, res);
  if (!userId) return;
  res.json(await getFiatRailState(userId));
});

/** Sandbox stand-in for Plaid Link, kept for local/E2E use without creds. */
fiatRailsRouter.post(
  "/api/fiat-rails/bank-link",
  writeRateLimiter,
  requireAuth,
  async (req, res) => {
    const userId = authedUser(req, res);
    if (!userId) return;
    try {
      const result = await linkSandboxBank(userId);
      await logAudit({
        ...getRequestContext(req),
        action: "fiat_bank_link",
        outcome: "success",
        params: { provider: "sandbox", mode: "sandbox" },
      });
      res.json(result);
    } catch (err) {
      if (unavailable(res, err)) return;
      throw err;
    }
  },
);

/** F-002 — Plaid Link token, minted server-side for the authed user. */
fiatRailsRouter.post("/api/fiat/link-token", writeRateLimiter, requireAuth, async (req, res) => {
  const userId = authedUser(req, res);
  if (!userId) return;
  try {
    res.json(await createFiatLinkToken(userId));
  } catch (err) {
    if (unavailable(res, err)) return;
    throw err;
  }
});

/** F-002 — exchange Link's public token; server-side only (D-101). */
fiatRailsRouter.post("/api/fiat/exchange", writeRateLimiter, requireAuth, async (req, res) => {
  const userId = authedUser(req, res);
  if (!userId) return;
  const parsed = exchangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bank link response.", code: "BAD_REQUEST" });
    return;
  }
  try {
    const result = await completeBankLinkExchange(userId, parsed.data.publicToken);
    await logAudit({
      ...getRequestContext(req),
      action: "fiat_bank_link",
      outcome: "success",
      params: { provider: "plaid" },
    });
    res.json(result);
  } catch (err) {
    if (unavailable(res, err)) return;
    await logAudit({
      ...getRequestContext(req),
      action: "fiat_bank_link",
      outcome: "failure",
      params: { provider: "plaid" },
      reason: err instanceof Error ? err.message : "bank link failed",
    });
    res.status(502).json({ error: "We couldn’t connect your bank.", code: "BANK_LINK_FAILED" });
  }
});

for (const kind of ["deposit", "withdraw"] as const) {
  fiatRailsRouter.post(
    `/api/fiat-rails/${kind}s`,
    writeRateLimiter,
    requireAuth,
    async (req, res) => {
      const userId = authedUser(req, res);
      if (!userId) return;
      const parsed = amountSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Enter a dollar amount up to $100,000.", code: "BAD_REQUEST" });
        return;
      }
      try {
        const transfer = await createFiatTransfer(userId, kind, parsed.data.amountUsd);
        await logAudit({
          ...getRequestContext(req),
          action: kind === "deposit" ? "fiat_deposit" : "fiat_withdraw",
          outcome: "pending",
          params: {
            amountUsd: parsed.data.amountUsd,
            provider: "zerohash",
            transferId: transfer.id,
          },
        });
        res.status(202).json(transfer);
      } catch (err) {
        if (unavailable(res, err)) return;
        throw err;
      }
    },
  );
}
