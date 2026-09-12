/**
 * Phase 7 / R-001 — the reconnect policy for server streams, pure so the
 * numbers are tested: full-jitter exponential backoff capped at a ceiling,
 * an honored server `retry:` hint, and the rule for when a client should
 * stop reconnecting and fall back to polling.
 */

export const STREAM_BACKOFF_BASE_MS = 1_000;
export const STREAM_BACKOFF_MAX_MS = 30_000;
/** After this many consecutive failed connection attempts, poll instead. */
export const STREAM_FALLBACK_AFTER_FAILURES = 4;
/** A stream that stays silent (no frame, no heartbeat) this long is dead. */
export const STREAM_SILENCE_TIMEOUT_MS = 45_000;

/**
 * Delay before reconnect attempt `attempt` (1-based). The server's
 * `retry:` hint sets the floor for the first attempt so a deliberate
 * `end` (max duration) reconnects promptly; repeated failures back off
 * with full jitter so a fleet of clients does not stampede a recovering
 * server in lockstep.
 */
export function reconnectDelayMs(
  attempt: number,
  serverRetryMs: number | null,
  random: () => number = Math.random,
): number {
  if (attempt <= 1 && serverRetryMs !== null) return serverRetryMs;
  const exp = Math.min(
    STREAM_BACKOFF_MAX_MS,
    STREAM_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
  return Math.floor(random() * exp);
}

export type StreamFailure =
  /** The server refused with a status code (503 STREAM_BUSY, 429, 5xx…). */
  | { kind: "http"; status: number }
  /** The connection never opened or dropped without a frame. */
  | { kind: "network" }
  /** No frame or heartbeat within STREAM_SILENCE_TIMEOUT_MS. */
  | { kind: "silence" };

/**
 * Should the client give up on the stream (for now) and poll? Capacity
 * shedding (503 STREAM_BUSY) says so immediately — the server asked for
 * it. Anything else after enough consecutive failures.
 */
export function shouldFallbackToPolling(
  consecutiveFailures: number,
  last: StreamFailure | null,
): boolean {
  if (last?.kind === "http" && last.status === 503) return true;
  return consecutiveFailures >= STREAM_FALLBACK_AFTER_FAILURES;
}

/**
 * How long to poll before trying the stream again — long enough that a
 * shed client is not the one re-overloading the instance, short enough
 * that a recovered stream is picked back up within a game.
 */
export const STREAM_RETRY_AFTER_FALLBACK_MS = 60_000;
