import type { Request, Response } from "express";
import { CircleUnavailableError } from "../lib/circle/client.ts";
import type { RequestResult } from "../lib/custody/custody-withdrawal-request.ts";
import type { DecideResult } from "../lib/custody/custody-withdrawals.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";

/**
 * Task 073 — one status per withdrawal outcome, shared by the request and
 * the decision routes. Every outcome that is not a plain success is a
 * 4xx/5xx whose `code` the client shows verbatim.
 */

const STATUS: Record<(RequestResult | DecideResult)["kind"], number> = {
  not_member: 404,
  no_wallet: 404,
  no_destination: 404,
  not_found: 404,
  refused: 422,
  pending: 202,
  executed: 200,
  pending_receipt: 202,
  failed: 502,
  not_claimable: 409,
  not_pending: 409,
  expired: 410,
  forbidden: 403,
  requester_inactive: 409,
  rejected: 200,
};

export function respondWithdrawal(res: Response, result: RequestResult | DecideResult): void {
  res.status(STATUS[result.kind]).json({ code: result.kind.toUpperCase(), ...result });
}

export function withdrawalAuditFor(req: Request) {
  const ctx = getRequestContext(req);
  return { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent };
}

/** Circle absent → 503; anything else → 502 with the given code. */
export function withdrawalFailure(res: Response, err: unknown, code: string, what: string): void {
  if (err instanceof CircleUnavailableError) {
    res.status(503).json({ error: err.message, code: "CIRCLE_UNAVAILABLE" });
    return;
  }
  logger.error({ err }, `custody: ${what} failed`);
  res.status(502).json({ error: `Couldn't ${what}.`, code });
}
