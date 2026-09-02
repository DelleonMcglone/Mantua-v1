import type { Request } from "express";

export interface RequestContext {
  ipAddress: string | undefined;
  userAgent: string | undefined;
  walletAddress: string | undefined;
}

/**
 * Extract context for audit logging from an Express request. `walletAddress`
 * is populated by the auth middleware (Phase 2 — P2-014); until then it is
 * always undefined.
 */
export function getRequestContext(req: Request): RequestContext {
  const augmented = req as Request & { walletAddress?: string };
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
    walletAddress: augmented.walletAddress,
  };
}
