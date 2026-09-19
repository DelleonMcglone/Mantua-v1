import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { readAgentLedger, type PublicLedger } from "../lib/agent/ledger-read.ts";
import { logger } from "../lib/logger.ts";
import { listPosts } from "../lib/social/post-store.ts";
import { handleSchema, readProfileByHandle } from "../lib/social/profile-store.ts";
import { sharedCache } from "../lib/shared-cache.ts";

/**
 * Task 070 / AE-005, AE-012 — GET /api/agents/:handle: the public
 * performance page. No authentication; an unknown or private handle
 * answers 404 without distinguishing the two, so the handle namespace does
 * not leak. The ledger is derived on read (never stored) and shared across
 * instances for a minute, which is also the rate protection for a public
 * page over a chain-backed computation.
 *
 * The response carries every trade, every market including the losses,
 * the mode breakdown, the simulated block, the metrics and the digest. There
 * is no query parameter that filters any of it.
 */
export const agentsPublicRouter = Router();

export const PUBLIC_LEDGER_CACHE_MS = 60_000;
const POSTS_SHOWN = 20;

export interface PublicAgentResponse {
  handle: string;
  displayName: string;
  bio: string;
  walletAddress: string;
  platform: string;
  ledger: PublicLedger["ledger"];
  metrics: PublicLedger["metrics"];
  marksAvailable: boolean;
  computedAt: string;
  posts: {
    id: string;
    template: string;
    marketId: string | null;
    text: string;
    postedAt: string;
    externalId: string | null;
  }[];
}

agentsPublicRouter.get("/api/agents/:handle", async (req: Request, res: Response) => {
  const handle = handleSchema.safeParse(String(req.params["handle"]).toLowerCase());
  if (!handle.success) {
    res.status(404).json({ error: "No such agent.", code: "AGENT_NOT_FOUND" });
    return;
  }
  try {
    const profile = await readProfileByHandle(db, handle.data);
    if (!profile || !profile.isPublic) {
      res.status(404).json({ error: "No such agent.", code: "AGENT_NOT_FOUND" });
      return;
    }
    const body = await sharedCache.getOrCompute(
      `public-agent:${profile.handle}`,
      PUBLIC_LEDGER_CACHE_MS,
      async (): Promise<PublicAgentResponse> => {
        const [ledger, posts] = await Promise.all([
          readAgentLedger(db, profile.walletAddress, profile.userId),
          listPosts(db, profile.id, { statuses: ["posted"], limit: POSTS_SHOWN }),
        ]);
        return {
          handle: profile.handle,
          displayName: profile.displayName,
          bio: profile.bio,
          walletAddress: profile.walletAddress,
          platform: profile.platform,
          ...ledger,
          posts: posts.map((p) => ({
            id: p.id,
            template: p.template,
            marketId: p.marketId,
            text: p.text,
            postedAt: p.createdAt.toISOString(),
            externalId: p.externalId,
          })),
        };
      },
    );
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(body);
  } catch (err) {
    logger.error({ err, handle: handle.data }, "public agent page failed");
    res.status(500).json({ error: "Failed to load agent", code: "INTERNAL" });
  }
});
