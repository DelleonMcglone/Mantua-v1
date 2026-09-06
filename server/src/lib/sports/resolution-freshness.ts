/**
 * S-022 — feed freshness and store reconciliation for the resolution path.
 *
 * The resilience layer (B3-003) already flags `delayed` when a value was
 * stale-served past its TTL, but "not flagged delayed" is a weaker statement
 * than "fresh enough to settle a market on": a cached slate can be legally
 * un-delayed and still older than any window in which a settlement decision
 * is defensible, and the ingest pipeline (whose `lastPolledAt` timestamps
 * are the record of what Mantua itself has been seeing) can silently fall
 * behind the direct fetch the cron makes. This module measures both lags
 * explicitly and turns them into hard refusals:
 *
 *  - `checkFeedFreshness` is the stale-data circuit breaker — a slate older
 *    than MAX_RESOLUTION_FEED_AGE_MS (or flagged delayed) must not feed a
 *    settlement decision;
 *  - `reconcileWithStoredEvent` is the reconciliation precheck — the
 *    provider snapshot being settled on must not contradict what the ingest
 *    worker has been persisting, and the ingest worker itself must not have
 *    gone dark.
 *
 * Both are pure; the criteria gate (S-025) consumes them, and the cron
 * surfaces their verdicts in logs, audit rows, and its response body.
 */

import type { ProviderEvent } from "./provider.ts";

/** Oldest a slate may be and still authorise settlement. Slate fetches ride
 *  a 60s TTL cache (PREGAME_TTL_MS), so 5 minutes tolerates normal caching
 *  and cron jitter while refusing anything that smells like an outage. */
export const MAX_RESOLUTION_FEED_AGE_MS = 5 * 60_000;

/** Oldest the ingest worker's `lastPolledAt` may be before the pipeline is
 *  declared stale. The sports-sync cron ticks every few minutes; half an
 *  hour of silence means ingestion is down, and a settlement made while the
 *  house's own record-keeping is dark gets no benefit of the doubt. */
export const STORE_POLL_MAX_AGE_MS = 30 * 60_000;

export interface FeedFreshness {
  fresh: boolean;
  /** How far behind "now" the data is, in ms. */
  lagMs: number;
  reason: string | null;
}

/** Feed lag of a fetch timestamp against now, floored at zero. */
export function feedLagMs(fetchedAtMs: number, nowMs: number): number {
  return Math.max(0, nowMs - fetchedAtMs);
}

/**
 * The stale-data circuit breaker. A slate that is `delayed` (stale-served or
 * breaker-served) or simply too old refuses freshness; resolution-consuming
 * paths treat a non-fresh slate exactly like a delayed one — freezes still
 * sweep (timestamp-driven, cannot be wrong), settlement holds.
 */
export function checkFeedFreshness(
  slate: { delayed: boolean; fetchedAt: number },
  nowMs: number,
): FeedFreshness {
  const lagMs = feedLagMs(slate.fetchedAt, nowMs);
  if (slate.delayed) {
    return { fresh: false, lagMs, reason: "provider data is delayed (stale-served or breaker)" };
  }
  if (lagMs > MAX_RESOLUTION_FEED_AGE_MS) {
    return {
      fresh: false,
      lagMs,
      reason: `feed lag ${String(lagMs)}ms exceeds ${String(MAX_RESOLUTION_FEED_AGE_MS)}ms bound`,
    };
  }
  return { fresh: true, lagMs, reason: null };
}

/** The ingest worker's persisted view of an event (`events` table). */
export interface StoredEventSnapshot {
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  /** When the ingest worker last saw this event (`events.last_polled_at`). */
  lastPolledAt: Date | null;
}

export interface Reconciliation {
  ok: boolean;
  detail: string;
}

/**
 * Reconciliation precheck: does the snapshot about to settle a market agree
 * with what ingestion has been writing? Three ways to fail, each meaning a
 * different broken thing:
 *
 *  - ingestion stale → the pipeline that would have caught a provider glitch
 *    has been dark too long;
 *  - stored final names a different winner → the two reads of the same
 *    provider disagree, i.e. the data is unstable;
 *  - stored final is a tie while the live read is decisive → same.
 *
 * A missing stored row passes with a note: the FK chain (markets → events)
 * means a resolvable market implies a stored event, so absence here is a
 * bookkeeping gap, not a contradiction — and refusing on it would deadlock
 * resolution against its own log.
 */
export function reconcileWithStoredEvent(
  event: ProviderEvent,
  stored: StoredEventSnapshot | null,
  nowMs: number,
): Reconciliation {
  if (!stored) return { ok: true, detail: "no stored snapshot to compare" };

  const polledAgo = stored.lastPolledAt ? nowMs - stored.lastPolledAt.getTime() : null;
  if (polledAgo === null || polledAgo > STORE_POLL_MAX_AGE_MS) {
    return {
      ok: false,
      detail: `ingestion stale: last polled ${polledAgo === null ? "never" : `${String(polledAgo)}ms ago`}`,
    };
  }

  if (stored.status === "final" && stored.homeScore !== null && stored.awayScore !== null) {
    if (event.homeScore === undefined || event.awayScore === undefined) {
      return { ok: true, detail: "live snapshot has no scores yet; store ahead" };
    }
    const liveWinner =
      event.homeScore === event.awayScore ? null : event.homeScore > event.awayScore ? 0 : 1;
    const storedWinner =
      stored.homeScore === stored.awayScore ? null : stored.homeScore > stored.awayScore ? 0 : 1;
    if (storedWinner !== liveWinner) {
      return {
        ok: false,
        detail:
          `stored final disagrees with live snapshot: stored ${String(stored.homeScore)}-${String(stored.awayScore)}, ` +
          `live ${String(event.homeScore)}-${String(event.awayScore)}`,
      };
    }
  }

  return { ok: true, detail: `stored snapshot consistent (polled ${String(polledAgo)}ms ago)` };
}
