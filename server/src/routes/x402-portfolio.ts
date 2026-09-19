import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import { loadExternalPositions, type EnrichedPosition } from "../lib/external-positions.ts";
import { readOnchainPositions, type OnchainPosition } from "../lib/v4-onchain-positions.ts";
import {
  getX402ServiceDef,
  parseCommaList,
  X402_NETWORK,
  type X402ServiceDef,
} from "../lib/x402/catalog.ts";
import {
  x402PaywallDepsFromEnv,
  x402ServiceChain,
  type X402PaywallDeps,
} from "../middleware/x402-paywall.ts";

/**
 * Phase 17 (MP-009) — the PAID portfolio-exposure service on /api/x402/v1:
 * positions for ANY queried Base address, deliberately limited to what is
 * already public on-chain. A thin wrapper over the existing on-chain
 * position readers — Mantua v4 LP positions (v4-onchain-positions.ts) and
 * pre-Mantua v4 positions (external-positions.ts via subgraph). No user
 * tables, no Privy identity, no wallet keys — the payment is the auth and
 * the address is a query parameter.
 *
 * Deliberate boundary: amounts are the on-chain token amounts (formatted
 * strings); no USD valuation is computed here — pricing would drag the
 * trading-side price engines into a public-data read, and the caller (a
 * trading agent) prices positions itself.
 */

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export interface X402PortfolioDeps {
  /** Mantua v4 LP positions held by the address (public chain state). */
  mantuaPositions: (owner: `0x${string}`) => Promise<OnchainPosition[]>;
  /** Pre-Mantua v4 positions discovered via subgraph (public chain state). */
  externalPositions: (walletAddress: string) => Promise<EnrichedPosition[]>;
  /** Paywall construction inputs (env in production; inline in tests). */
  paywall: X402PaywallDeps;
}

/** The paid portfolio service, by catalog id. */
const PORTFOLIO_DEF = getX402ServiceDef("portfolio-exposure") as X402ServiceDef;

export function createX402PortfolioRouter(overrides: Partial<X402PortfolioDeps> = {}): Router {
  const deps: X402PortfolioDeps = {
    mantuaPositions: overrides.mantuaPositions ?? ((owner) => readOnchainPositions(owner)),
    externalPositions:
      overrides.externalPositions ?? ((walletAddress) => loadExternalPositions(walletAddress)),
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
   * GET /api/x402/v1/portfolio/exposure?address=0x… — the paid
   * portfolio-exposure read (MP-009). An RPC failure on the Mantua read is
   * a 503 (the caller paid for an answer, not a partial guess);
   * external-position discovery already fails open to [] by its own
   * contract (an upstream subgraph outage must not sink the read).
   */
  router.get(
    PORTFOLIO_DEF.path,
    ...x402ServiceChain(PORTFOLIO_DEF, deps.paywall),
    async (req: Request, res: Response) => {
      const parsed = addressSchema.safeParse(req.query.address);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid address", code: "BAD_ADDRESS" });
        return;
      }
      const address = parsed.data.toLowerCase() as `0x${string}`;
      try {
        const [mantua, external] = await Promise.all([
          deps.mantuaPositions(address),
          deps.externalPositions(address),
        ]);
        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
        res.json({
          address,
          network: X402_NETWORK,
          positions: { mantua, external },
          totals: { mantua: mantua.length, external: external.length },
          fetchedAt: Date.now(),
        });
      } catch (err) {
        logger.error({ err, address }, "x402-portfolio: on-chain read failed");
        res.status(503).json({ error: "Portfolio unavailable", code: "UNAVAILABLE" });
      }
    },
  );

  return router;
}

export const x402PortfolioRouter = createX402PortfolioRouter();
