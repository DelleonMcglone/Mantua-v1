/**
 * Connect a user's own X account (owner, 2026-10-21): OAuth 2.0 with PKCE
 * against X's authorization server, so the agent can post as the user.
 *
 * Everything here takes its `fetch` and secrets as arguments; nothing
 * reads env, so the whole flow is testable against a scripted server.
 * Tokens are sealed with AES-256-GCM before they reach the database; the
 * key is derived from the app's client secret, so a database copy alone
 * cannot drive the user's account.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
export const X_ME_URL = "https://api.x.com/2/users/me";
/** What the agent needs: post text and media, know who the user is, keep access. */
export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "media.write",
  "offline.access",
];

export interface XApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const b64url = (b: Buffer) => b.toString("base64url");

/** A PKCE verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

/** The consent-screen URL for a state + challenge. */
export function authorizeUrl(app: XApp, state: string, challenge: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: app.clientId,
    redirect_uri: app.redirectUri,
    scope: X_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${X_AUTHORIZE_URL}?${q.toString()}`;
}

// ── The handoff cookie: who started the flow, and the verifier ──────────

export interface Handoff {
  userId: string;
  state: string;
  verifier: string;
  /** Unix seconds. */
  expiresAt: number;
}

const sign = (secret: string, body: string) =>
  createHmac("sha256", secret).update(body).digest("base64url");

/** The cookie value: base64url(JSON) + "." + HMAC. */
export function sealHandoff(secret: string, h: Handoff): string {
  const body = Buffer.from(JSON.stringify(h)).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

/** Null when tampered with, malformed or expired. */
export function openHandoff(secret: string, value: string, nowSeconds: number): Handoff | null {
  const [body, mac] = value.split(".");
  if (!body || !mac || sign(secret, body) !== mac) return null;
  try {
    const h = JSON.parse(Buffer.from(body, "base64url").toString()) as Handoff;
    if (
      typeof h.userId !== "string" ||
      typeof h.state !== "string" ||
      typeof h.verifier !== "string"
    )
      return null;
    return h.expiresAt > nowSeconds ? h : null;
  } catch {
    return null;
  }
}

// ── Tokens at rest ──────────────────────────────────────────────────────

function sealKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "mantua-x-tokens", "aes-256-gcm", 32));
}

/** iv.tag.ciphertext, base64url each. */
export function sealToken(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", sealKey(secret), iv);
  const enc = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return [b64url(iv), b64url(c.getAuthTag()), b64url(enc)].join(".");
}

export function openToken(secret: string, sealed: string): string {
  const parts = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  if (parts.length !== 3 || parts.some((b) => b.length === 0))
    throw new Error("sealed token is malformed");
  const [iv, tag, enc] = parts as [Buffer, Buffer, Buffer];
  const d = createDecipheriv("aes-256-gcm", sealKey(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ── The token endpoints ─────────────────────────────────────────────────

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Unix seconds. */
  expiresAt: number;
  scope: string;
}

async function tokenCall(
  app: XApp,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
  nowSeconds: number,
): Promise<TokenSet> {
  const res = await fetchImpl(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) throw new Error(`X token endpoint answered ${String(res.status)}`);
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!body.access_token) throw new Error("X token endpoint returned no access token");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: nowSeconds + (body.expires_in ?? 7200),
    scope: body.scope ?? "",
  };
}

export function exchangeCode(
  app: XApp,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TokenSet> {
  return tokenCall(
    app,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: app.redirectUri,
      code_verifier: verifier,
    },
    fetchImpl,
    nowSeconds,
  );
}

export function refreshTokens(
  app: XApp,
  refreshToken: string,
  fetchImpl: typeof fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TokenSet> {
  return tokenCall(
    app,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    fetchImpl,
    nowSeconds,
  );
}

/** Best effort: a revoke that fails upstream still disconnects locally. */
export async function revokeToken(
  app: XApp,
  token: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(X_REVOKE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ token, token_type_hint: "access_token" }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The connected account's id and handle. */
export async function whoAmI(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<{ id: string; handle: string; name: string }> {
  const res = await fetchImpl(X_ME_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`X users/me answered ${String(res.status)}`);
  const body = (await res.json()) as { data?: { id?: string; username?: string; name?: string } };
  if (!body.data?.id || !body.data.username) throw new Error("X users/me returned no user");
  return {
    id: body.data.id,
    handle: body.data.username,
    name: body.data.name ?? body.data.username,
  };
}
