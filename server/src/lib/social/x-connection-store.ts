/**
 * The `social_connections` rows for X: save a fresh connection, read the
 * user's, hand out a usable access token (refreshing first when it is
 * about to expire), and revoke. Tokens are sealed at rest; `openToken`
 * happens here and nowhere else.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { socialConnections, type SocialConnection } from "../../db/schema/social.ts";
import { openToken, refreshTokens, sealToken, type TokenSet, type XApp } from "./x-oauth.ts";

/** Refresh when fewer than this many seconds remain. */
const REFRESH_LEAD_S = 5 * 60;

export interface ConnectionView {
  handle: string;
  displayName: string;
  connectedAt: string;
  scopes: string[];
}

export function viewOf(row: SocialConnection): ConnectionView {
  return {
    handle: row.handle,
    displayName: row.displayName,
    connectedAt: row.connectedAt.toISOString(),
    scopes: row.scopes.split(" ").filter(Boolean),
  };
}

export async function readConnection(db: DB, userId: string): Promise<SocialConnection | null> {
  const row = await db.query.socialConnections.findFirst({
    where: and(eq(socialConnections.userId, userId), eq(socialConnections.platform, "x")),
  });
  return row && row.revokedAt === null && row.accessTokenSealed ? row : null;
}

export async function saveConnection(
  db: DB,
  app: XApp,
  userId: string,
  account: { id: string; handle: string; name: string },
  tokens: TokenSet,
): Promise<void> {
  const values = {
    externalUserId: account.id,
    handle: account.handle,
    displayName: account.name,
    accessTokenSealed: sealToken(app.clientSecret, tokens.accessToken),
    refreshTokenSealed: tokens.refreshToken
      ? sealToken(app.clientSecret, tokens.refreshToken)
      : null,
    scopes: tokens.scope,
    expiresAt: new Date(tokens.expiresAt * 1000),
    revokedAt: null,
    updatedAt: new Date(),
  };
  await db
    .insert(socialConnections)
    .values({ userId, platform: "x", ...values })
    .onConflictDoUpdate({
      target: [socialConnections.userId, socialConnections.platform],
      set: { ...values, connectedAt: new Date() },
    });
}

/** Clear the tokens, keep the handle for the record. */
export async function markRevoked(db: DB, userId: string): Promise<void> {
  await db
    .update(socialConnections)
    .set({
      accessTokenSealed: null,
      refreshTokenSealed: null,
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(socialConnections.userId, userId), eq(socialConnections.platform, "x")));
}

/**
 * A live access token for the user, refreshed and re-sealed when it is
 * about to expire. Null when the user has no live connection.
 */
export async function accessTokenFor(
  db: DB,
  app: XApp,
  userId: string,
  fetchImpl: typeof fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  const row = await readConnection(db, userId);
  if (!row?.accessTokenSealed) return null;
  const expiresAt = row.expiresAt ? Math.floor(row.expiresAt.getTime() / 1000) : 0;
  if (expiresAt - nowSeconds > REFRESH_LEAD_S)
    return openToken(app.clientSecret, row.accessTokenSealed);
  if (!row.refreshTokenSealed) return null;
  const fresh = await refreshTokens(
    app,
    openToken(app.clientSecret, row.refreshTokenSealed),
    fetchImpl,
    nowSeconds,
  );
  await db
    .update(socialConnections)
    .set({
      accessTokenSealed: sealToken(app.clientSecret, fresh.accessToken),
      refreshTokenSealed: fresh.refreshToken
        ? sealToken(app.clientSecret, fresh.refreshToken)
        : row.refreshTokenSealed,
      expiresAt: new Date(fresh.expiresAt * 1000),
      updatedAt: new Date(),
    })
    .where(eq(socialConnections.id, row.id));
  return fresh.accessToken;
}
