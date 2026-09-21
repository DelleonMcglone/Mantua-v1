import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { TtlCache } from "../lib/ttl-cache.ts";
import {
  readPlatformStatus,
  type PlatformStatus,
  type PlatformStatusDeps,
} from "../lib/platform-status.ts";
import { activeBreakerState } from "../lib/sports/active-provider.ts";
import { readLeagueFeedInputs } from "../lib/sports/store.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";
import { killSwitchEngaged } from "../middleware/kill-switch.ts";
import { rpcHealthSnapshot } from "../lib/rpc-client.ts";

/** How long one snapshot serves every caller on this instance. Feed
 *  freshness moves at ingest cadence (minutes), the kill switch propagates
 *  in 15 s (its own cache), so 5 s costs nothing in accuracy and keeps the
 *  status read to one DB aggregate per instance per window under a
 *  game-time fan-out of clients. */
export const STATUS_CACHE_MS = 5_000;

/** The covered leagues (NFL only). A league still in the canonical tables
 *  but no longer covered must not degrade the platform status — its feed
 *  is not ingested any more, so it is stale by design. */
const LEAGUES: readonly LeagueSlug[] = ["nfl"];

export function defaultPlatformStatusDeps(): PlatformStatusDeps {
  return {
    readFeeds: async () =>
      (await readLeagueFeedInputs(db)).filter((f) =>
        (LEAGUES as readonly string[]).includes(f.league),
      ),
    readKillSwitch: killSwitchEngaged,
    readBreakers: activeBreakerState,
    readRpcHealth: () => {
      const h = rpcHealthSnapshot();
      return { healthy: h.healthy, detail: h.detail };
    },
    now: () => Date.now(),
  };
}

/**
 * The shared, cached status reader — the route below and the live stream
 * both call this, so one instance computes one snapshot per window however
 * many clients ask.
 */
export function createPlatformStatusReader(
  deps: PlatformStatusDeps = defaultPlatformStatusDeps(),
  cacheMs: number = STATUS_CACHE_MS,
): () => Promise<PlatformStatus> {
  const cache = new TtlCache<PlatformStatus>();
  return () => cache.get("status", () => readPlatformStatus(deps), cacheMs);
}

/**
 * GET /api/status — Phase 7 / R-005. Public, unauthenticated, cheap: the
 * platform's degradation state for the client banner and for operators.
 * Always 200 — a degraded platform is a successful answer, and the client
 * treats an unreachable status endpoint as its own degradation signal.
 */
export function createPlatformStatusRouter(
  read: () => Promise<PlatformStatus> = createPlatformStatusReader(),
): Router {
  const router = Router();
  router.get("/api/status", async (_req: Request, res: Response) => {
    const status = await read();
    res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=15");
    res.json(status);
  });
  return router;
}

/** Production wiring: one reader shared with the live stream. */
export const platformStatusReader = createPlatformStatusReader();
export const platformStatusRouter = createPlatformStatusRouter(platformStatusReader);
