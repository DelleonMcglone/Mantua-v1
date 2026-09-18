import type { RequestHandler } from "express";

/**
 * Task 067 (G-006) — the API's security headers, set once for every
 * response before any route runs. Kept explicit rather than pulling a
 * header library: the set is small, the values are policy, and the test
 * beside this file pins them.
 *
 * - `nosniff`: JSON is JSON; no MIME sniffing of error bodies.
 * - `X-Frame-Options: DENY`: the API is never framed (the SPA is served
 *   separately and carries its own headers via vercel.json).
 * - `Referrer-Policy`: never leak a query string cross-origin.
 * - `Permissions-Policy`: the API needs no device capabilities, and keeps
 *   all four closed. Task 069 (V-001) opened `microphone=(self)` for the
 *   **SPA document** in `vercel.json`, which is the response the browser
 *   applies the policy from; an API JSON response never hosts a
 *   microphone, so this stays shut.
 * - `Strict-Transport-Security`: only when the request arrived over TLS
 *   (directly or via the platform's `x-forwarded-proto`), so local HTTP
 *   dev is never pinned to HTTPS.
 * - `Cache-Control: no-store` as the default for authenticated requests;
 *   a route that serves public, cacheable data overrides it explicitly.
 */
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

export function isSecureRequest(req: {
  secure?: boolean;
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  if (req.secure) return true;
  const proto = req.headers["x-forwarded-proto"];
  const first = Array.isArray(proto) ? proto[0] : proto;
  return typeof first === "string" && first.split(",")[0].trim() === "https";
}

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (isSecureRequest(req)) res.setHeader("Strict-Transport-Security", HSTS_VALUE);
  if (req.headers.authorization) res.setHeader("Cache-Control", "no-store");
  next();
};
