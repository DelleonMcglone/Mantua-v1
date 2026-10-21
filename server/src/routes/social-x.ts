/**
 * Connect / disconnect the user's own X account (owner, 2026-10-21).
 *
 *   GET    /api/social/x           — status: the connected handle, or null
 *   POST   /api/social/x/connect   — start OAuth: answers the consent URL,
 *                                    sets the signed handoff cookie
 *   GET    /api/social/x/callback  — X returns here; code → tokens → row;
 *                                    then back into the app
 *   DELETE /api/social/x           — revoke upstream, clear the tokens
 *
 * The callback carries no session: it is tied to the user by the HttpOnly
 * handoff cookie the connect step set (HMAC-signed, ten minutes).
 */
import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import { openToken } from "../lib/social/x-oauth.ts";
import {
  authorizeUrl,
  exchangeCode,
  openHandoff,
  pkcePair,
  revokeToken,
  sealHandoff,
  whoAmI,
  type XApp,
} from "../lib/social/x-oauth.ts";
import {
  markRevoked,
  readConnection,
  saveConnection,
  viewOf,
} from "../lib/social/x-connection-store.ts";
import { resolveUserId } from "../lib/sports/strategy-store.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

const COOKIE = "mantua_x_oauth";
const HANDOFF_TTL_S = 10 * 60;

export function xApp(): XApp | null {
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) return null;
  return {
    clientId: env.X_CLIENT_ID,
    clientSecret: env.X_CLIENT_SECRET,
    redirectUri: `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/api/social/x/callback`,
  };
}

function cookieValue(req: Request): string | null {
  const raw = req.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

const cookieOpts = "Path=/api/social/x; HttpOnly; Secure; SameSite=Lax";

export const socialXRouter = Router();

socialXRouter.get("/api/social/x", requireAuth, async (req: Request, res: Response) => {
  const app = xApp();
  const userId = req.privyUserId ? await resolveUserId(db, req.privyUserId) : null;
  const row = userId ? await readConnection(db, userId) : null;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ available: app !== null, connection: row ? viewOf(row) : null });
});

socialXRouter.post(
  "/api/social/x/connect",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const app = xApp();
    if (!app) {
      res.status(503).json({ error: "X connections are not enabled.", code: "X_UNAVAILABLE" });
      return;
    }
    const userId = req.privyUserId ? await resolveUserId(db, req.privyUserId) : null;
    if (!userId) {
      res.status(409).json({ error: "User record not found.", code: "USER_NOT_FOUND" });
      return;
    }
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(16).toString("base64url");
    const handoff = sealHandoff(app.clientSecret, {
      userId,
      state,
      verifier,
      expiresAt: Math.floor(Date.now() / 1000) + HANDOFF_TTL_S,
    });
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${encodeURIComponent(handoff)}; Max-Age=${String(HANDOFF_TTL_S)}; ${cookieOpts}`,
    );
    res.json({ url: authorizeUrl(app, state, challenge) });
  },
);

socialXRouter.get("/api/social/x/callback", async (req: Request, res: Response) => {
  const back = (outcome: "connected" | "denied" | "error") => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Max-Age=0; ${cookieOpts}`);
    res.redirect(302, `/?open=social&x=${outcome}`);
  };
  const app = xApp();
  const sealed = cookieValue(req);
  const handoff =
    app && sealed ? openHandoff(app.clientSecret, sealed, Math.floor(Date.now() / 1000)) : null;
  const code = typeof req.query["code"] === "string" ? req.query["code"] : null;
  const state = typeof req.query["state"] === "string" ? req.query["state"] : null;
  if (typeof req.query["error"] === "string") {
    back("denied");
    return;
  }
  if (!app || !handoff || !code || state !== handoff.state) {
    back("error");
    return;
  }
  try {
    const tokens = await exchangeCode(app, code, handoff.verifier, fetch);
    const account = await whoAmI(tokens.accessToken, fetch);
    await saveConnection(db, app, handoff.userId, account, tokens);
    logger.info({ userId: handoff.userId, handle: account.handle }, "x account connected");
    back("connected");
  } catch (err) {
    logger.warn({ err }, "x connect failed");
    back("error");
  }
});

socialXRouter.delete(
  "/api/social/x",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const app = xApp();
    const userId = req.privyUserId ? await resolveUserId(db, req.privyUserId) : null;
    if (!userId) {
      res.status(409).json({ error: "User record not found.", code: "USER_NOT_FOUND" });
      return;
    }
    const row = await readConnection(db, userId);
    if (row?.accessTokenSealed && app) {
      await revokeToken(app, openToken(app.clientSecret, row.accessTokenSealed), fetch);
    }
    await markRevoked(db, userId);
    res.json({ ok: true });
  },
);
