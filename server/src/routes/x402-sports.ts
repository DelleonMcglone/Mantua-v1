import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import {
  getGame,
  getLiveGameState,
  getMarketOverview,
  makeSportsToolsDb,
  type SportsToolsDb,
} from "../lib/sports/agent-sports-tools.ts";
import { getX402ServiceDef, parseCommaList, type X402ServiceDef } from "../lib/x402/catalog.ts";
import {
  x402PaywallDepsFromEnv,
  x402ServiceChain,
  type X402PaywallDeps,
} from "../middleware/x402-paywall.ts";

/**
 * Phase 17 (MP-011) — the PAID sports-intelligence service on /api/x402/v1:
 * the agent's own sports context, honesty contract intact. A thin wrapper
 * over agent-sports-tools.ts (getGame / getLiveGameState /
 * getMarketOverview) — the tools' honesty statuses (unavailable /
 * not_found / ambiguous + didYouMean) pass through to the caller verbatim;
 * the route never guesses on their behalf.
 *
 * Auth is the catalog's "allowlist+payment" mode: the T1 paywall chain
 * prepends the pre-settlement allowlist gate (X402_SPORTS_INTEL_ALLOWLIST;
 * un-allowlisted payers are 403'd before any verify/settle, an empty
 * allowlist leaves the whole service dark) — no per-route payment logic.
 */

const querySchema = z
  .object({
    providerEventId: z
      .string()
      .regex(/^\d{1,32}$/)
      .optional(),
    team: z.string().min(1).max(80).optional(),
    league: z.string().min(1).max(40).optional(),
  })
  .refine((q) => q.providerEventId !== undefined || q.team !== undefined, {
    message: "Provide `team` (optionally `league`) or `providerEventId`",
  });

export interface X402SportsDeps {
  /** Game lookup by team (the honesty-contract entry point). */
  game: (input: { team: string; league?: string }) => Promise<Record<string, unknown>>;
  /** Live state / odds for one event or team. */
  live: (input: {
    providerEventId?: string;
    team?: string;
    league?: string;
  }) => Promise<Record<string, unknown>>;
  /** Market overview (prices, liquidity) for one event. */
  market: (input: { providerEventId: string }) => Promise<Record<string, unknown>>;
  /** Paywall construction inputs (env in production; inline in tests). */
  paywall: X402PaywallDeps;
}

/** The paid sports-intelligence service, by catalog id. */
const SPORTS_DEF = getX402ServiceDef("sports-intelligence") as X402ServiceDef;

export function createX402SportsRouter(overrides: Partial<X402SportsDeps> = {}): Router {
  const deps: X402SportsDeps = {
    game:
      overrides.game ??
      ((input) => {
        const dbx: SportsToolsDb = makeSportsToolsDb(db);
        return getGame(dbx, { team: input.team, league: input.league });
      }),
    live:
      overrides.live ??
      ((input) => {
        const dbx: SportsToolsDb = makeSportsToolsDb(db);
        return getLiveGameState(dbx, input);
      }),
    market:
      overrides.market ??
      ((input) => {
        const dbx: SportsToolsDb = makeSportsToolsDb(db);
        return getMarketOverview(dbx, { providerEventId: input.providerEventId });
      }),
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
   * GET /api/x402/v1/sports/context?team=…|providerEventId=… — the paid
   * sports-context read (MP-011). Team queries return the game record
   * (honesty statuses verbatim) plus live state when the game resolves to
   * an event id; event queries return live state and the market overview
   * together. Unexpected tool failures are a 503 — the caller paid for an
   * answer, not a guess.
   */
  router.get(
    SPORTS_DEF.path,
    ...x402ServiceChain(SPORTS_DEF, deps.paywall),
    async (req: Request, res: Response) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(400)
          .json({
            error: "Invalid sports context request",
            code: "BAD_REQUEST",
            details: parsed.error.issues,
          });
        return;
      }
      const q = parsed.data;
      try {
        if (q.providerEventId !== undefined) {
          const [live, market] = await Promise.all([
            deps.live({ providerEventId: q.providerEventId }),
            deps.market({ providerEventId: q.providerEventId }),
          ]);
          res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
          res.json({ providerEventId: q.providerEventId, live, market });
          return;
        }
        const team = q.team as string;
        // Conditional spread (exactOptionalPropertyTypes): no explicit
        // undefined for the optional league.
        const game = await deps.game({
          team,
          ...(q.league !== undefined ? { league: q.league } : {}),
        });
        const resolvedEventId = (game as { providerEventId?: unknown }).providerEventId;
        const live =
          typeof resolvedEventId === "string" && resolvedEventId.length > 0
            ? await deps.live({ providerEventId: resolvedEventId })
            : undefined;
        res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
        res.json({
          team,
          league: q.league ?? null,
          game,
          ...(live !== undefined ? { live } : {}),
        });
      } catch (err) {
        logger.error({ err, query: q }, "x402-sports: sports tools failed");
        res.status(503).json({ error: "Sports context unavailable", code: "UNAVAILABLE" });
      }
    },
  );

  return router;
}

export const x402SportsRouter = createX402SportsRouter();
