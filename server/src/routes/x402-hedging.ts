import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import { hedgePlans } from "../lib/x402/hedge-templates.ts";
import { getX402ServiceDef, parseCommaList, type X402ServiceDef } from "../lib/x402/catalog.ts";
import { makeDepthDb } from "../lib/sports/market-depth-db.ts";
import { readMarketDepth, type MarketDepthRead } from "../lib/sports/market-depth-read.ts";
import { sharedCache } from "../lib/shared-cache.ts";
import {
  x402PaywallDepsFromEnv,
  x402ServiceChain,
  type X402PaywallDeps,
} from "../middleware/x402-paywall.ts";

/**
 * Phase 17 (MP-010) — the PAID hedging service on /api/x402/v1: predefined
 * hedge-strategy templates rendered as concrete advisory legs, each leg
 * quotable through the paid trading services (POST /api/x402/v1/trading/
 * quote|calldata). Arms NOTHING — strategy-store.ts and the execution
 * engine stay internal (B9-004 discipline); this route never imports them.
 * The only dynamic input is the market's current price (the shared depth
 * read), which turns advisory USDC sizes into concrete amountRaw values.
 */

const eventIdSchema = z.string().regex(/^\d{1,32}$/);

const querySchema = z.object({
  providerEventId: eventIdSchema,
  side: z.enum(["yes", "no"]).default("yes"),
  exposureUsd: z.coerce.number().positive().max(100_000),
});

export interface X402HedgingDeps {
  /** The market page's deeper layer for one event; null = unknown event. */
  depth: (providerEventId: string) => Promise<MarketDepthRead | null>;
  /** The pure template renderer (unit-tested in hedge-templates.test.ts). */
  plans: typeof hedgePlans;
  /** Paywall construction inputs (env in production; inline in tests). */
  paywall: X402PaywallDeps;
}

/** The paid hedging service, by catalog id. */
const HEDGING_DEF = getX402ServiceDef("hedging") as X402ServiceDef;

export function createX402HedgingRouter(overrides: Partial<X402HedgingDeps> = {}): Router {
  const deps: X402HedgingDeps = {
    // Same 15 s shared cache as the free depth route — one read, both surfaces.
    depth:
      overrides.depth ??
      ((id) =>
        sharedCache.getOrCompute(`market-depth:${id}`, 15_000, () =>
          readMarketDepth(makeDepthDb(), id),
        )),
    plans: overrides.plans ?? hedgePlans,
    paywall:
      overrides.paywall ??
      x402PaywallDepsFromEnv({
        ...env,
        X402_SELLER_SERVICES: parseCommaList(env.X402_SELLER_SERVICES),
        X402_SPORTS_INTEL_ALLOWLIST: parseCommaList(env.X402_SPORTS_INTEL_ALLOWLIST),
      }),
  };
  const router = Router();

  /**
   * GET /api/x402/v1/hedging/plan?providerEventId=…&side=yes&exposureUsd=500
   * — the paid hedging plan (MP-010). Unknown event 404s; a read failure
   * 503s. Plans are advisory by construction: the pure renderer in
   * lib/x402/hedge-templates.ts cannot arm, store, or execute anything.
   */
  router.get(
    HEDGING_DEF.path,
    ...x402ServiceChain(HEDGING_DEF, deps.paywall),
    async (req: Request, res: Response) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(400)
          .json({
            error: "Invalid hedging request",
            code: "BAD_REQUEST",
            details: parsed.error.issues,
          });
        return;
      }
      const { providerEventId, side, exposureUsd } = parsed.data;
      try {
        const depth = await deps.depth(providerEventId);
        if (!depth) {
          res.status(404).json({ error: "Unknown game", code: "NOT_FOUND" });
          return;
        }
        const homePriceBps = depth.metrics?.priceBps ?? null;
        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
        res.json({
          providerEventId,
          side,
          exposureUsd,
          assumedHomePriceBps: homePriceBps,
          plans: deps.plans({ providerEventId, side, exposureUsd, homePriceBps }),
          quoteHowTo: {
            method: "POST",
            path: "/api/x402/v1/trading/quote",
            body: {
              providerEventId,
              outcomeIndex: "<from the leg>",
              direction: "<from the leg>",
              amountRaw: "<from the leg>",
              slippageBps: 100,
            },
          },
          armsNothing: true,
          note: "Advisory only — arms nothing (B9-004): Mantua's strategy store and execution engine stay internal.",
        });
      } catch (err) {
        logger.error({ err, providerEventId }, "x402-hedging: depth read failed");
        res.status(503).json({ error: "Hedging plans unavailable", code: "UNAVAILABLE" });
      }
    },
  );

  return router;
}

export const x402HedgingRouter = createX402HedgingRouter();
