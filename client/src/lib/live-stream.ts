import { API_BASE } from "@/lib/api.ts";
import { readSseBody, sseJson, type SseEvent } from "@/lib/sse-core.ts";
import {
  STREAM_RETRY_AFTER_FALLBACK_MS,
  STREAM_SILENCE_TIMEOUT_MS,
  reconnectDelayMs,
  shouldFallbackToPolling,
  type StreamFailure,
} from "@/lib/stream-policy-core.ts";
import type { Slate } from "@/features/markets/use-slate.ts";
import { isPlatformStatusWire, publishPlatformStatus } from "@/features/status/status-bus.ts";
import type { PlatformStatusWire } from "@/features/status/connection-status-core.ts";
import { getAccessToken } from "@privy-io/react-auth";
import { parseBalancesFrame, parsePositionsFrame } from "@/features/portfolio/user-stream-core.ts";
import { publishUserBalances, publishUserPositions } from "@/features/portfolio/user-stream-bus.ts";

/**
 * Phase 7 / R-001 — the client for `GET /api/stream/live` (the SSE market
 * stream; protocol in `server/src/routes/live-stream.ts`).
 *
 * One subscription = one connection, kept alive across the server's
 * deliberate `end` (max duration) and across network drops with the
 * policy in `stream-policy-core.ts`: honor the server's `retry:` on a
 * clean end, back off with jitter on failures, and after enough failures
 * (or an immediate 503 STREAM_BUSY) hand control back to the caller's
 * polling for a while. Silence (no bytes, not even a heartbeat) for
 * STREAM_SILENCE_TIMEOUT_MS is treated as a drop.
 *
 * Hidden tabs disconnect and reconnect on return: a background board
 * costs the server nothing, and a returning user gets a fresh snapshot.
 *
 * Signed in, each attempt sends the Privy access token, and the server
 * adds the wallet's `positions` and `balances` frames (R-001), published
 * to the user-stream bus. The token is read per attempt, so the server's
 * max-duration reconnect also picks up a refreshed token or a new login.
 */

export type LiveStreamState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "polling"
  | "hidden"
  | "closed";

export interface LiveSnapshot {
  leagues: Record<string, Slate | { error: string }>;
  status: PlatformStatusWire | null;
}

export interface LiveStreamHandlers {
  onSnapshot: (snapshot: LiveSnapshot) => void;
  onSlate: (league: string, slate: Slate) => void;
  onState: (state: LiveStreamState) => void;
}

export interface LiveStreamOptions {
  fetchImpl?: typeof fetch;
  /** The bearer token for a signed-in stream; null = anonymous. */
  getToken?: () => Promise<string | null>;
  /** Injected for tests; defaults to the document's visibility. */
  isHidden?: () => boolean;
}

type AttemptResult = { kind: "ended" } | { kind: "failed"; failure: StreamFailure };

function query(params: { league?: string | undefined; dates?: string | undefined }): string {
  const q = new URLSearchParams();
  if (params.league) q.set("league", params.league);
  if (params.dates) q.set("dates", params.dates);
  return q.size > 0 ? `?${q.toString()}` : "";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      signal.removeEventListener("abort", done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

function waitForVisible(signal: AbortSignal, isHidden: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (!isHidden() || signal.aborted) {
      resolve();
      return;
    }
    const check = (): void => {
      if (!isHidden() || signal.aborted) {
        document.removeEventListener("visibilitychange", check);
        signal.removeEventListener("abort", check);
        resolve();
      }
    };
    document.addEventListener("visibilitychange", check);
    signal.addEventListener("abort", check, { once: true });
  });
}

/**
 * Subscribe. Returns the unsubscribe function. Handlers are only called
 * while subscribed; the last `onState` before unsubscribe is "closed".
 */
export function subscribeLive(
  params: { league?: string | undefined; dates?: string | undefined },
  handlers: LiveStreamHandlers,
  options: LiveStreamOptions = {},
): () => void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const getToken = options.getToken ?? (() => getAccessToken().catch((): string | null => null));
  const isHidden = options.isHidden ?? (() => document.visibilityState === "hidden");
  const controller = new AbortController();
  const { signal } = controller;
  // Per-attempt state, read through the object so aborts from the
  // visibility handler reach the attempt in flight.
  const live: {
    attempt: AbortController | null;
    lastEventId: string | null;
    retryMs: number | null;
  } = { attempt: null, lastEventId: null, retryMs: null };

  const setState = (s: LiveStreamState): void => {
    if (!signal.aborted) handlers.onState(s);
  };

  /** Dispatch one frame; true when it was the server's deliberate `end`. */
  const handleEvent = (ev: SseEvent): boolean => {
    if (ev.retry !== undefined) live.retryMs = ev.retry;
    if (ev.id !== undefined) live.lastEventId = ev.id;
    const payload = sseJson(ev);
    switch (ev.event) {
      case "snapshot": {
        if (typeof payload !== "object" || payload === null) return false;
        const p = payload as { leagues?: unknown; status?: unknown };
        const leagues =
          typeof p.leagues === "object" && p.leagues !== null
            ? (p.leagues as LiveSnapshot["leagues"])
            : {};
        const status = isPlatformStatusWire(p.status) ? p.status : null;
        if (status) publishPlatformStatus(status);
        handlers.onSnapshot({ leagues, status });
        return false;
      }
      case "slate": {
        if (typeof payload !== "object" || payload === null) return false;
        const p = payload as { league?: unknown; slate?: unknown };
        if (typeof p.league === "string" && typeof p.slate === "object" && p.slate !== null) {
          handlers.onSlate(p.league, p.slate as Slate);
        }
        return false;
      }
      case "status":
        if (isPlatformStatusWire(payload)) publishPlatformStatus(payload);
        return false;
      case "positions": {
        const frame = parsePositionsFrame(payload);
        if (frame) publishUserPositions(frame);
        return false;
      }
      case "balances": {
        const frame = parseBalancesFrame(payload);
        if (frame) publishUserBalances(frame);
        return false;
      }
      case "end":
        return true;
      default:
        return false;
    }
  };

  /** One connection attempt. Resolves with how it ended. */
  const attempt = async (): Promise<AttemptResult> => {
    const ac = new AbortController();
    live.attempt = ac;
    const abortOnParent = (): void => {
      ac.abort();
    };
    signal.addEventListener("abort", abortOnParent, { once: true });
    const outcome = { ended: false, silenced: false };
    const watchdog: { silence: ReturnType<typeof setTimeout> | null } = { silence: null };
    const armSilence = (): void => {
      if (watchdog.silence) clearTimeout(watchdog.silence);
      watchdog.silence = setTimeout(() => {
        outcome.silenced = true;
        ac.abort();
      }, STREAM_SILENCE_TIMEOUT_MS);
    };
    try {
      const headers = new Headers({ Accept: "text/event-stream" });
      if (live.lastEventId !== null) headers.set("Last-Event-ID", live.lastEventId);
      const token = await getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const res = await fetchImpl(`${API_BASE}/api/stream/live${query(params)}`, {
        headers,
        signal: ac.signal,
        cache: "no-store",
      });
      if (!res.ok || !res.body) {
        return { kind: "failed", failure: { kind: "http", status: res.status } };
      }
      setState("open");
      armSilence();
      await readSseBody(
        res.body,
        (ev) => {
          if (handleEvent(ev)) {
            outcome.ended = true;
            ac.abort();
          }
        },
        armSilence,
      );
    } catch {
      // Falls through: the outcome flags say whether this was our own
      // abort after an `end` frame, the silence watchdog, or a real drop.
    } finally {
      if (watchdog.silence) clearTimeout(watchdog.silence);
      signal.removeEventListener("abort", abortOnParent);
      live.attempt = null;
    }
    if (outcome.ended) return { kind: "ended" };
    if (outcome.silenced) return { kind: "failed", failure: { kind: "silence" } };
    return { kind: "failed", failure: { kind: "network" } };
  };

  // Read through a call so TS does not narrow `signal.aborted` to false
  // across the awaits inside the loop.
  const aborted = (): boolean => signal.aborted;
  const loop = async (): Promise<void> => {
    let consecutiveFailures = 0;
    let attemptNo = 0;
    while (!aborted()) {
      if (isHidden()) {
        setState("hidden");
        await waitForVisible(signal, isHidden);
        if (aborted()) break;
        consecutiveFailures = 0;
        attemptNo = 0;
      }
      setState(attemptNo === 0 ? "connecting" : "reconnecting");
      attemptNo += 1;
      const result = await attempt();
      if (aborted()) break;
      if (isHidden()) continue; // the visibility handler cut it; wait above
      if (result.kind === "ended") {
        consecutiveFailures = 0;
        attemptNo = 0;
        await sleep(reconnectDelayMs(1, live.retryMs), signal);
        continue;
      }
      consecutiveFailures += 1;
      if (shouldFallbackToPolling(consecutiveFailures, result.failure)) {
        setState("polling");
        await sleep(STREAM_RETRY_AFTER_FALLBACK_MS, signal);
        consecutiveFailures = 0;
        attemptNo = 0;
        continue;
      }
      setState("reconnecting");
      await sleep(reconnectDelayMs(consecutiveFailures, null), signal);
    }
    handlers.onState("closed");
  };

  const onVisibility = (): void => {
    if (isHidden()) live.attempt?.abort();
  };
  document.addEventListener("visibilitychange", onVisibility);

  void loop();

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    controller.abort();
    live.attempt?.abort();
  };
}
