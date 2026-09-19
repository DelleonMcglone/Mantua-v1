import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { getAgentWallet } from "../lib/agent-wallet.ts";
import { logAudit } from "../lib/audit.ts";
import { DEFAULT_CHAIN_ID } from "../lib/chains.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { decidePost } from "../lib/social/post-decision.ts";
import { listPosts, readPost } from "../lib/social/post-store.ts";
import {
  profilePatchSchema,
  readProfileByUser,
  upsertProfile,
  viewFromRow,
} from "../lib/social/profile-store.ts";
import { platformSender, publicPageUrl } from "../lib/social/tick-deps.ts";
import { resolveUserId } from "../lib/sports/strategy-store.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

/**
 * Task 070 / AE-001, AE-005, AE-006 — the user's side of their agent's voice.
 *   GET/PATCH /api/agent/social                → profile + policy (claim, update)
 *   GET       /api/agent/social/posts          → the record, newest first
 *   POST      /api/agent/social/posts/:id/approve | reject → the user's decision
 * A duplicate handle answers 409 HANDLE_TAKEN. Every write is audited.
 */
export const agentSocialRouter = Router();

async function userOf(req: Request, res: Response): Promise<string | null> {
  const userId = req.privyUserId ? await resolveUserId(db, req.privyUserId) : null;
  if (!userId) res.status(409).json({ error: "User record not found.", code: "USER_NOT_FOUND" });
  return userId;
}

function fail(res: Response, err: unknown, what: string): void {
  logger.error({ err }, `social ${what} failed`);
  res.status(500).json({ error: `Failed to ${what}`, code: "INTERNAL" });
}

agentSocialRouter.get("/api/agent/social", requireAuth, async (req, res) => {
  try {
    const userId = await userOf(req, res);
    if (!userId) return;
    const row = await readProfileByUser(db, userId);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      profile: row ? viewFromRow(row) : null,
      pageUrl: row ? publicPageUrl(row.handle) : null,
      platformConfigured: platformSender() !== null,
    });
  } catch (err) {
    fail(res, err, "load social profile");
  }
});

agentSocialRouter.patch("/api/agent/social", writeRateLimiter, requireAuth, async (req, res) => {
  const parsed = profilePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
    return;
  }
  const ctx = getRequestContext(req);
  try {
    const userId = await userOf(req, res);
    if (!userId) return;
    const wallet = await getAgentWallet(req.privyUserId ?? "", DEFAULT_CHAIN_ID);
    if (!wallet) {
      res
        .status(404)
        .json({ error: "No agent wallet provisioned.", code: "AGENT_WALLET_NOT_FOUND" });
      return;
    }
    const row = await upsertProfile(db, userId, wallet.address, parsed.data);
    await logAudit({
      ...ctx,
      action: "social_profile_update",
      outcome: "success",
      params: { patch: parsed.data },
    });
    res.json({ profile: viewFromRow(row), pageUrl: publicPageUrl(row.handle) });
  } catch (err) {
    const taken = err instanceof Error && /agent_social_profiles_handle_uq/.test(err.message);
    await logAudit({
      ...ctx,
      action: "social_profile_update",
      outcome: taken ? "rejected_other" : "failure",
      reason: err instanceof Error ? err.message : "unknown",
    });
    if (taken) res.status(409).json({ error: "That handle is taken.", code: "HANDLE_TAKEN" });
    else fail(res, err, "update social profile");
  }
});

agentSocialRouter.get("/api/agent/social/posts", requireAuth, async (req, res) => {
  try {
    const userId = await userOf(req, res);
    if (!userId) return;
    const row = await readProfileByUser(db, userId);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ posts: row ? await listPosts(db, row.id, { limit: 100 }) : [] });
  } catch (err) {
    fail(res, err, "load posts");
  }
});

async function decide(req: Request, res: Response, approve: boolean): Promise<void> {
  const id = z.uuid().safeParse(req.params["id"]);
  if (!id.success) {
    res.status(400).json({ error: "Invalid post id", code: "BAD_REQUEST" });
    return;
  }
  try {
    const userId = await userOf(req, res);
    if (!userId) return;
    const profile = await readProfileByUser(db, userId);
    const post = profile ? await readPost(db, profile.id, id.data) : null;
    if (!profile || !post) {
      res.status(404).json({ error: "Post not found.", code: "POST_NOT_FOUND" });
      return;
    }
    if (post.status !== "pending_review") {
      res
        .status(409)
        .json({ error: `Post is ${post.status}, not pending review.`, code: "POST_NOT_PENDING" });
      return;
    }
    res.json(await decidePost(db, profile, post, approve, platformSender()));
  } catch (err) {
    fail(res, err, "update post");
  }
}

agentSocialRouter.post(
  "/api/agent/social/posts/:id/approve",
  writeRateLimiter,
  requireAuth,
  (req, res) => decide(req, res, true),
);
agentSocialRouter.post(
  "/api/agent/social/posts/:id/reject",
  writeRateLimiter,
  requireAuth,
  (req, res) => decide(req, res, false),
);
