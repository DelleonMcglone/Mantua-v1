import { Router, type Request, type Response, type NextFunction } from "express";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import { getTradeSignals } from "../lib/agent-signals.ts";
import { getTrendingCoins } from "../lib/trending.ts";
import { getNarrativePerformance, getTvlMovers } from "../lib/defillama.ts";

/**
 * x402 SELLER — agent-to-agent nanopayments. Mantua sells its own analyst
 * brief as a paid API: any agent (including our own buyer tools via
 * `call_paid_service`) pays a $0.01 USDC micro-payment and receives the live
 * brief. Payment IS the auth — no Privy session required.
 *
 * Protocol: x402 v2. An unpaid request gets HTTP 402 with `accepts[]`
 * (scheme "exact", USDC on Arc Mainnet); the default public facilitator
 * (x402.org) verifies + settles to X402_SELLER_ADDRESS.
 * When the seller address isn't configured the endpoint reports 503 instead
 * of paywalling — same graceful-dark pattern as the other opt-in features.
 */

export const x402ServiceRouter = Router();

const BRIEF_PATH = "/api/x402/analyst-brief";
/** CAIP-2 id for Arc Mainnet — x402's USDC settlement network. */
const X402_NETWORK = "eip155:5042";

// Build the paywall middleware once (only when a seller address exists).
const seller = env.X402_SELLER_ADDRESS;
const paywall = seller
  ? paymentMiddlewareFromConfig(
      {
        [BRIEF_PATH]: {
          accepts: {
            scheme: "exact",
            payTo: seller,
            price: "$0.01",
            network: X402_NETWORK,
          },
          description:
            "Mantua Analyst Signals — live stablecoin pegs, market pulse, narratives, TVL movers",
          mimeType: "application/json",
          serviceName: "Mantua Analyst Signals",
        },
      },
      // Default facilitator (x402.org) verifies + settles; the EVM "exact"
      // scheme server handles payment-requirement construction locally.
      undefined,
      [{ network: X402_NETWORK, server: new ExactEvmScheme() }],
      undefined,
      undefined,
      // syncFacilitatorOnStart = false: with it on, @x402/express kicks off
      // `httpServer.initialize()` as a floating promise at construction —
      // i.e. at module load — and the facilitator's "does not support
      // scheme exact on eip155:5042" answer surfaces as an UNHANDLED
      // REJECTION on every cold start (seen in production logs). Deferred,
      // the same condition is raised on the first paid request instead,
      // where the typed X402_NETWORK_UNSUPPORTED gate below catches it.
      false,
    )
  : null;

x402ServiceRouter.get(
  BRIEF_PATH,
  (req: Request, res: Response, next: NextFunction) => {
    if (!paywall) {
      res.status(503).json({
        error: "Seller not configured (X402_SELLER_ADDRESS unset).",
        code: "X402_SELLER_DISABLED",
      });
      return;
    }
    // @x402/evm's "exact" scheme builds payment requirements from a
    // built-in per-network USDC registry that has no Arc (5042) entry yet,
    // so requirement construction throws. Until this route moves onto the
    // dual-rail paywall the other services use (x402-paywall.ts, which
    // carries its own asset config), answer with a typed 503 instead of a
    // crashed request.
    const unsupported = (err: unknown): void => {
      logger.warn({ err }, "x402 analyst-brief: paywall unavailable on this network");
      if (!res.headersSent) {
        res.status(503).json({
          error: "Paid access is not available on this network yet.",
          code: "X402_NETWORK_UNSUPPORTED",
        });
      }
    };
    // The scheme can fail three ways — a sync throw, a rejected promise, or
    // next(err) — so all three land on the same typed 503.
    const guardedNext: NextFunction = (err?: unknown) => {
      if (err) unsupported(err);
      else next();
    };
    try {
      void Promise.resolve(paywall(req, res, guardedNext)).catch(unsupported);
    } catch (err) {
      unsupported(err);
    }
  },
  async (_req: Request, res: Response) => {
    try {
      const [signals, trending, narratives, tvlMovers] = await Promise.all([
        getTradeSignals({}),
        getTrendingCoins(),
        getNarrativePerformance(),
        getTvlMovers(),
      ]);
      res.json({
        service: "Mantua Analyst Signals",
        generatedAt: new Date().toISOString(),
        pegs: signals.pegs,
        prices: signals.prices,
        trending,
        narratives,
        tvlMovers,
      });
    } catch (err) {
      logger.error({ err }, "x402 analyst-brief failed");
      res.status(500).json({ error: "Brief generation failed", code: "BRIEF_FAILED" });
    }
  },
);
