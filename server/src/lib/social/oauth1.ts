import { createHmac, randomBytes } from "node:crypto";

/**
 * Task 070 / AE-001 — OAuth 1.0a (RFC 5849) request signing for the X API,
 * HMAC-SHA1 over `node:crypto`, no dependency. Pure: nonce and timestamp
 * are inputs so the reference vector pins the whole algorithm.
 *
 *   base   = METHOD & enc(url without query) & enc(sorted "k=v&…" of
 *            query/form params + oauth_* params, each key and value
 *            RFC 3986-encoded)
 *   key    = enc(consumer secret) & enc(token secret)
 *   sig    = base64(HMAC-SHA1(key, base))
 *
 * A JSON body (the v2 endpoints) contributes no params.
 */

export interface OAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface SignableRequest {
  method: "GET" | "POST";
  /** Absolute URL; any query string is folded into `params`. */
  url: string;
  /** Query-string and form-encoded body params (never a JSON body). */
  params: Record<string, string>;
  nonce: string;
  /** Unix seconds. */
  timestamp: number;
}

/** RFC 3986 §2.3 unreserved characters only; everything else is %XX. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function oauthParams(creds: OAuth1Credentials, req: SignableRequest): Record<string, string> {
  return {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: req.nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(req.timestamp),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
}

function splitUrl(url: string): { base: string; query: Record<string, string> } {
  const u = new URL(url);
  const query: Record<string, string> = {};
  for (const [k, v] of u.searchParams) query[k] = v;
  return { base: `${u.protocol}//${u.host}${u.pathname}`, query };
}

/** The signature base string of RFC 5849 §3.4.1. */
export function signatureBaseString(creds: OAuth1Credentials, req: SignableRequest): string {
  const { base, query } = splitUrl(req.url);
  const all = { ...query, ...req.params, ...oauthParams(creds, req) };
  const normalized = Object.entries(all)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `${req.method}&${percentEncode(base)}&${percentEncode(normalized)}`;
}

/** base64(HMAC-SHA1) of the base string under the two secrets. */
export function signRequest(creds: OAuth1Credentials, req: SignableRequest): string {
  const key = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  return createHmac("sha1", key).update(signatureBaseString(creds, req)).digest("base64");
}

/** The `Authorization: OAuth …` header value for the request. */
export function authorizationHeader(creds: OAuth1Credentials, req: SignableRequest): string {
  const fields = { ...oauthParams(creds, req), oauth_signature: signRequest(creds, req) };
  const parts = Object.keys(fields)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(fields[k as keyof typeof fields])}"`);
  return `OAuth ${parts.join(", ")}`;
}

/** A fresh nonce and timestamp for a live request. */
export function freshRequestIdentity(now = Date.now()): { nonce: string; timestamp: number } {
  return { nonce: randomBytes(16).toString("hex"), timestamp: Math.floor(now / 1000) };
}
