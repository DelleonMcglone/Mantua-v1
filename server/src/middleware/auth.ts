import type { RequestHandler } from "express";
import { getPrivyClient } from "../lib/privy.ts";
import { logger } from "../lib/logger.ts";

declare module "express-serve-static-core" {
  interface Request {
    privyUserId?: string;
    walletAddress?: string;
  }
}

/**
 * P2-014 — Privy access-token verification middleware.
 *
 * Reads `Authorization: Bearer <token>` (the identity token from
 * `getAccessToken()` on the client) and populates:
 *   - req.privyUserId : the Privy user id (e.g. did:privy:...)
 *   - req.walletAddress : the user's primary wallet address (lowercased)
 *
 * Soft mode (default): if the header is missing, request continues with
 * undefined fields. Use `requireAuth` for routes that MUST be authenticated.
 */
export const attachAuth: RequestHandler = async (req, _res, next) => {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    next();
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    next();
    return;
  }
  try {
    const claims = await getPrivyClient().verifyAuthToken(token);
    req.privyUserId = claims.userId;
    const user = await getPrivyClient().getUserById(claims.userId);
    const wallet = user.linkedAccounts.find(
      (a): a is typeof a & { address: string } =>
        a.type === "wallet" && typeof (a as { address?: unknown }).address === "string",
    );
    if (wallet) req.walletAddress = wallet.address.toLowerCase();
    next();
  } catch (err) {
    logger.warn({ err }, "privy token verification failed");
    next();
  }
};

/** Hard auth for routes that must reject unauthenticated traffic. */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.privyUserId) {
    res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
    return;
  }
  next();
};
