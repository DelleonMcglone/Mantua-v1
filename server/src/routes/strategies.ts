import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { EspnProvider } from "../lib/sports/espn.ts";
import { marketIdsFor } from "../lib/sports/resolution.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { strategyConfigSchema } from "../lib/sports/strategies.ts";
import { parseStrategyDraft, previewLines } from "../lib/sports/strategy-parse.ts";
import {
  armStrategy,
  disarmStrategy,
  listStrategies,
  resolveUserId,
} from "../lib/sports/strategy-store.ts";

export const strategiesRouter = Router();

const espn = new EspnProvider();
const LEAGUES: readonly LeagueSlug[] = ["nfl", "wnba"];

interface MarketCandidate {
  marketId: `0x${string}`;
  side: "yes";
  label: string;
  league: string;
  startsAt: number;
}

/**
 * Resolve a free-text team reference against the upcoming slates. Each match
 * is the market whose YES is "that team wins" — side is always "yes" from
 * the user's phrasing ("close my Chiefs position" is about the Chiefs
 * market), so there is exactly one vocabulary in stored configs.
 */
async function resolveCandidates(teamQuery: string | undefined): Promise<MarketCandidate[]> {
  const q = teamQuery?.toLowerCase();
  const candidates: MarketCandidate[] = [];
  for (const league of LEAGUES) {
    try {
      const slate = await espn.getSlate(league);
      for (const event of slate.events) {
        if (event.startsAt * 1000 < Date.now()) continue;
        const [homeMarket, awayMarket] = marketIdsFor(event.providerEventId);
        const sides = [
          { market: homeMarket, team: event.home, opponent: event.away },
          { market: awayMarket, team: event.away, opponent: event.home },
        ];
        for (const side of sides) {
          const name = `${side.team.name} ${side.team.abbreviation}`.toLowerCase();
          if (q && !name.includes(q)) continue;
          candidates.push({
            marketId: side.market,
            side: "yes",
            label: `${side.team.name} to beat ${side.opponent.name}`,
            league,
            startsAt: event.startsAt,
          });
        }
      }
    } catch {
      // A league's slate being down narrows candidates; it must not 500 the preview.
    }
  }
  return candidates.slice(0, 10);
}

/**
 * B9-004 / B9-006 — the user-facing strategy API.
 *
 * The arm flow is deliberately two requests: `preview` parses natural
 * language into a structured draft the UI must display, and `POST /`
 * only accepts the STRUCTURED config — the user confirms numbers, not
 * prose. Natural language never arms anything directly.
 */

strategiesRouter.post(
  "/api/strategies/preview",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const body = z.object({ text: z.string().min(3).max(500) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request", code: "BAD_REQUEST" });
      return;
    }
    const draft = parseStrategyDraft(body.data.text);
    if (!draft) {
      res.status(422).json({
        error:
          'Couldn\'t parse a strategy from that. Try e.g. "take profit at 80%", ' +
          '"stop loss at 30% on the Chiefs market", or "keep my exposure within $50".',
        code: "UNPARSEABLE_STRATEGY",
      });
      return;
    }
    // For single-market strategies, resolve the team text to real upcoming
    // markets so the client can arm a concrete market id.
    const candidates =
      draft.kind === "take-profit-stop" ? await resolveCandidates(draft.teamQuery) : [];
    res.json({ draft, preview: previewLines(draft), candidates });
  },
);

const armSchema = z.object({
  config: strategyConfigSchema,
  capUsd: z.number().positive().max(10_000),
  /** Unix seconds. */
  expiresAt: z.number().int().positive().optional(),
});

strategiesRouter.post(
  "/api/strategies",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = armSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid strategy", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const userId = await resolveUserId(db, req.privyUserId ?? "");
    if (!userId) {
      res.status(404).json({ error: "Connect a wallet first.", code: "USER_NOT_FOUND" });
      return;
    }
    try {
      const row = await armStrategy(
        db,
        userId,
        parsed.data.config,
        parsed.data.capUsd,
        parsed.data.expiresAt ? new Date(parsed.data.expiresAt * 1000) : null,
      );
      res.status(201).json({ strategy: row });
    } catch (err) {
      logger.error({ err }, "strategies: arm failed");
      res.status(500).json({ error: "Failed to arm strategy", code: "INTERNAL" });
    }
  },
);

strategiesRouter.get("/api/strategies", requireAuth, async (req: Request, res: Response) => {
  const userId = await resolveUserId(db, req.privyUserId ?? "");
  if (!userId) {
    res.json({ strategies: [] });
    return;
  }
  res.json({ strategies: await listStrategies(db, userId) });
});

/** B9-007 — per-strategy kill. */
strategiesRouter.post(
  "/api/strategies/:id/disarm",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = z.uuid().safeParse(req.params.id);
    const userId = await resolveUserId(db, req.privyUserId ?? "");
    if (!id.success || !userId) {
      res.status(404).json({ error: "Strategy not found", code: "NOT_FOUND" });
      return;
    }
    const row = await disarmStrategy(db, userId, id.data, "user");
    if (!row) {
      res.status(409).json({ error: "Not armed (already stopped?)", code: "NOT_ARMED" });
      return;
    }
    res.json({ strategy: row });
  },
);
