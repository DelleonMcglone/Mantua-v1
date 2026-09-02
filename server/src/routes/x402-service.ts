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
 * (scheme "exact", USDC on Base Mainnet); the default public facilitator
 * (x402.org) verifies + settles to X402_SELLER_ADDRESS.
 * When the seller address isn't configured the endpoint reports 503 instead
 * of paywalling — same graceful-dark pattern as the other opt-in features.
 */

export const x402ServiceRouter = Router();

const BRIEF_PATH = "/api/x402/analyst-brief";
/** CAIP-2 id for Base Mainnet — x402's USDC settlement network. */
const X402_NETWORK = "eip155:8453";

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
    void paywall(req, res, next);
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
