import { and, eq, gte } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { forecasts, type ForecastRow } from "../../db/schema/forecasts.ts";
import { PREVIEW_TTL_MS } from "../agent/confirmation-store.ts";

/**
 * What became of a proposal. The ledger never edits the `proposed` row;
 * when the user says no, or the preview lapses with no fill, a new row with
 * the same view and the later action is appended beside it. A "sibling" is
 * a later row for the same session, game and side.
 */
export type FollowupRow = Pick<
  ForecastRow,
  "id" | "sessionId" | "providerEventId" | "outcomeIndex" | "action" | "createdAt"
>;

const CLOSED: ReadonlySet<string> = new Set(["filled", "rejected_by_user", "unfilled"]);

function hasLaterSibling(row: FollowupRow, rows: readonly FollowupRow[]): boolean {
  return rows.some(
    (r) =>
      r.id !== row.id &&
      r.sessionId === row.sessionId &&
      r.providerEventId === row.providerEventId &&
      r.outcomeIndex === row.outcomeIndex &&
      CLOSED.has(r.action) &&
      r.createdAt.getTime() >= row.createdAt.getTime(),
  );
}

/** Pure: proposals in this session still open — the ones a "no" rejects. */
export function planRejected<T extends FollowupRow>(
  rows: readonly T[],
  sessionId: string,
  nowMs: number,
  ttlMs: number = PREVIEW_TTL_MS,
): T[] {
  return rows.filter(
    (r) =>
      r.sessionId === sessionId &&
      r.action === "proposed" &&
      nowMs - r.createdAt.getTime() <= ttlMs &&
      !hasLaterSibling(r, rows),
  );
}

/** Pure: proposals past the preview lifetime with no fill or rejection. */
export function planUnfilled<T extends FollowupRow>(
  rows: readonly T[],
  nowMs: number,
  ttlMs: number = PREVIEW_TTL_MS,
): T[] {
  return rows.filter(
    (r) =>
      r.action === "proposed" && nowMs - r.createdAt.getTime() > ttlMs && !hasLaterSibling(r, rows),
  );
}

/** Append a copy of each row with the later action; the view itself is unchanged. */
export async function appendFollowups(
  db: DB,
  rows: readonly ForecastRow[],
  action: "rejected_by_user" | "unfilled",
  now: Date,
): Promise<number> {
  if (rows.length === 0) return 0;
  await db.insert(forecasts).values(
    rows.map(({ id: _id, createdAt: _c, ...rest }) => ({
      ...rest,
      action,
      tradeId: null,
      createdAt: now,
    })),
  );
  return rows.length;
}

async function recentRows(db: DB, since: Date, sessionId?: string): Promise<ForecastRow[]> {
  const where = sessionId
    ? and(gte(forecasts.createdAt, since), eq(forecasts.sessionId, sessionId))
    : gte(forecasts.createdAt, since);
  return db.select().from(forecasts).where(where).limit(2000);
}

/** The user said no to the pending preview: every open proposal in the session is rejected. */
export async function rejectPendingProposals(
  db: DB,
  sessionId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await recentRows(db, new Date(now.getTime() - PREVIEW_TTL_MS), sessionId);
  return appendFollowups(db, planRejected(rows, sessionId, now.getTime()), "rejected_by_user", now);
}

/** The daily sweep: proposals that lapsed without a decision. */
export const UNFILLED_LOOKBACK_MS = 7 * 24 * 3_600_000;

export async function markUnfilledProposals(db: DB, now: Date = new Date()): Promise<number> {
  const rows = await recentRows(db, new Date(now.getTime() - UNFILLED_LOOKBACK_MS));
  return appendFollowups(db, planUnfilled(rows, now.getTime()), "unfilled", now);
}
