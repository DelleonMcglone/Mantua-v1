import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/**
 * Task 074 — the operator guard, pure of configuration: `Authorization:
 * Bearer <key>` against the key the caller reads (env in production, a
 * literal in tests), disabled (503) rather than open when no key is
 * configured, compared in constant time.
 */
export function opsAuthGuard(
  readKey: () => string | undefined,
  onReject: () => void = () => undefined,
): RequestHandler {
  return (req, res, next) => {
    const key = readKey();
    if (!key) {
      res.status(503).json({ error: "Operator access is not configured.", code: "OPS_DISABLED" });
      return;
    }
    const header = req.get("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    const a = Buffer.from(provided);
    const b = Buffer.from(key);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      onReject();
      res.status(401).json({ error: "Invalid operator key.", code: "UNAUTHENTICATED" });
      return;
    }
    next();
  };
}
