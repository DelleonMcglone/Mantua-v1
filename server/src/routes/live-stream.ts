import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { TtlCache } from "../lib/ttl-cache.ts";
import type { PlatformStatus } from "../lib/platform-status.ts";
import type { PublicSlate } from "../lib/sports/public-slate.ts";
import { readCanonicalPublicSlate } from "../lib/sports/store.ts";
import { withLiveOdds } from "../lib/sports/live-odds.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";
import { platformStatusReader } from "./platform-status.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "../lib/chains.ts";
import { readMarketPositions, type MarketPositionRow } from "../lib/sports/market-positions.ts";
import { readWalletBalances, type UserBalance } from "../lib/user-portfolio.ts";
import { datesToRangeMs, parseDates } from "./sports-slate.ts";

/**
 * Phase 7 / R-001 — the live market stream: `GET /api/stream/live` is one
 * Server-Sent-Events connection per client carrying the slate (scores,
 * odds, live pool prices) and the platform status, replacing the board's
 * 60-second poll with a push that moves at game speed.
 *
 * Why SSE over a WebSocket: the API is one Express function on Vercel
 * (`api/index.ts`, 300 s max duration) with no long-lived process to own a
 * socket registry, no pub/sub bus, and a client that already speaks
 * `text/event-stream` (the agent chat). SSE rides plain HTTP through the
 * same rewrite, reconnects for free (`retry:` + `Last-Event-ID`), and
 * degrades to the existing poll when it can't connect. The architecture
 * doc's WebSocket grammar (subscribe by id, event_type-discriminated
 * frames, snapshot-then-deltas, heartbeats) is honored over this transport.
 *
 * Wire protocol (every frame has an `id:`; `event:` names the type):
 *
 *   retry: 3000
 *   event: snapshot   data: { leagues: {<league>: PublicSlate | {error}}, status: PlatformStatus }
 *   event: slate      data: { league, slate: PublicSlate }     — on change only
 *   event: status     data: PlatformStatus                     — on change only
 *   : heartbeat                                                — every HEARTBEAT_MS
 *   event: positions  data: { wallet, positions: MarketPositionRow[] }  — signed-in only
 *   event: balances   data: { wallet, chainId, balances: UserBalance[] } — signed-in only
 *   event: end        data: { reason: "max_duration" }         — then the response closes
 *
 * Signed-in streams (R-001): the stream stays public, but a request that
 * carries the user's bearer token (the soft `attachAuth` resolves
 * `req.walletAddress` from it — never from a query parameter) also gets
 * that wallet's market positions and token balances: once right after the
 * snapshot, then on change. Both come through the shared per-wallet caches
 * (positions 10 s, balances 15 s) that a verified fill invalidates, so a
 * trade shows on the next tick and N tabs cost one read per window. An
 * anonymous stream is byte-for-byte what it was.
 *
 * Cadence: `LIVE_TICK_MS` while any served league has a game in play,
 * `IDLE_TICK_MS` otherwise. Every stream on an instance shares one read
 * per league per tick through a short in-process cache, so N clients cost
 * one query, not N.
 *
 * Backpressure (R-002): at most `MAX_CONNECTIONS` streams per instance;
 * the next client gets a 503 `STREAM_BUSY` with `Retry-After` and falls
 * back to polling — an overloaded instance sheds streams, it never stalls
 * the trade routes sharing it. The stream ends itself at `MAX_DURATION_MS`
 * (under the function's 300 s ceiling) with an `end` frame so the client
 * reconnects immediately instead of discovering a severed socket.
 */

export const LIVE_TICK_MS = 5_000;
export const IDLE_TICK_MS = 20_000;
export const HEARTBEAT_MS = 15_000;
export const MAX_DURATION_MS = 240_000;
export const MAX_CONNECTIONS = 200;
/** Shared read cache per instance — shorter than the live tick so a tick
 *  always sees data at most one tick old. */
const READ_CACHE_MS = 2_000;

const LEAGUES: readonly LeagueSlug[] = ["nfl"];

function isLeague(value: unknown): value is LeagueSlug {
  return typeof value === "string" && (LEAGUES as readonly string[]).includes(value);
}

export interface LiveStreamDeps {
  readSlate: (
    league: LeagueSlug,
    range: { fromMs: number; toMs: number } | undefined,
  ) => Promise<PublicSlate>;
  readStatus: () => Promise<PlatformStatus>;
  /** The signed-in wallet's marked market positions (cached per wallet). */
  readPositions: (wallet: `0x${string}`) => Promise<MarketPositionRow[]>;
  /** The signed-in wallet's token balances on `balancesChainId` (cached). */
  readBalances: (wallet: `0x${string}`) => Promise<UserBalance[]>;
  balancesChainId: SupportedChainId;
  now: () => number;
  liveTickMs: number;
  idleTickMs: number;
  heartbeatMs: number;
  maxDurationMs: number;
  maxConnections: number;
}

function defaultDeps(): LiveStreamDeps {
  const cache = new TtlCache<PublicSlate>();
  return {
    readSlate: (league, range) =>
      cache.get(
        `${league}|${range ? `${String(range.fromMs)}-${String(range.toMs)}` : "default"}`,
        async () => withLiveOdds(await readCanonicalPublicSlate(db, league, range)),
        READ_CACHE_MS,
      ),
    readStatus: platformStatusReader,
    readPositions: readMarketPositions,
    readBalances: (wallet) => readWalletBalances(wallet, BASE_CHAIN_ID),
    balancesChainId: BASE_CHAIN_ID,
    now: () => Date.now(),
    liveTickMs: LIVE_TICK_MS,
    idleTickMs: IDLE_TICK_MS,
    heartbeatMs: HEARTBEAT_MS,
    maxDurationMs: MAX_DURATION_MS,
    maxConnections: MAX_CONNECTIONS,
  };
}

/** Kicked off and not final — the same notion the trade gate uses. */
export function slateHasLiveGame(slate: PublicSlate, nowMs: number): boolean {
  const nowS = Math.floor(nowMs / 1000);
  return slate.events.some(
    (e) => e.status === "in_progress" || (e.status === "scheduled" && e.startsAt <= nowS),
  );
}

type LeagueFrame = PublicSlate | { error: string };

/** Open streams on this instance (R-010's stream gauge). */
const gauge = { connections: 0 };
export function liveStreamConnections(): number {
  return gauge.connections;
}

export function createLiveStreamRouter(overrides: Partial<LiveStreamDeps> = {}): Router {
  const deps: LiveStreamDeps = { ...defaultDeps(), ...overrides };
  const router = Router();
  // Per router so tests get an isolated count; production has one router.
  const local = { connections: 0 };

  router.get("/api/stream/live", async (req: Request, res: Response) => {
    const requested = req.query.league;
    if (requested !== undefined && !isLeague(requested)) {
      res.status(400).json({ error: "Unknown league", code: "BAD_LEAGUE" });
      return;
    }
    const leagues = requested !== undefined && isLeague(requested) ? [requested] : LEAGUES;
    const dates = parseDates(req.query.dates);
    if (dates !== null && typeof dates === "object") {
      res.status(400).json({ error: dates.error, code: "BAD_DATES" });
      return;
    }
    const range = dates === null ? undefined : (datesToRangeMs(dates) ?? undefined);

    if (local.connections >= deps.maxConnections) {
      res.setHeader("Retry-After", "10");
      res.status(503).json({
        error: "Live stream is at capacity — falling back to polling.",
        code: "STREAM_BUSY",
        retryAfterSeconds: 10,
      });
      return;
    }
    local.connections += 1;
    gauge.connections += 1;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    let seq = Number(req.get("last-event-id") ?? 0);
    if (!Number.isFinite(seq) || seq < 0) seq = 0;
    const startedAt = deps.now();
    // Held in an object and read through `gone()` so the checks after each
    // await really re-read the socket state (TS would narrow a bare `let`
    // flag to its initializer inside this closure).
    const conn = { closed: false };
    const gone = (): boolean => conn.closed || res.closed;
    let tickTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const finish = (): void => {
      if (conn.closed) return;
      conn.closed = true;
      local.connections -= 1;
      gauge.connections -= 1;
      if (tickTimer) clearTimeout(tickTimer);
      if (heartbeat) clearInterval(heartbeat);
      res.end();
    };
    req.on("close", finish);

    const send = (event: string, data: unknown): void => {
      if (gone()) return;
      seq += 1;
      res.write(`id: ${String(seq)}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const readLeague = async (league: LeagueSlug): Promise<LeagueFrame> => {
      try {
        const slate = await deps.readSlate(league, range);
        if (slate.events.length === 0 && slate.dataAsOf === undefined) {
          return { error: "Slate temporarily unavailable" };
        }
        return slate;
      } catch (err) {
        logger.warn({ league, err }, "live-stream: slate read failed");
        return { error: "Slate temporarily unavailable" };
      }
    };

    // Set only by attachAuth from a verified token — the one wallet this
    // connection may see. Null = anonymous: no user frames at all.
    const wallet = (req.walletAddress?.toLowerCase() ?? null) as `0x${string}` | null;
    const readUser = async <T>(what: string, read: () => Promise<T>): Promise<T | null> => {
      try {
        return await read();
      } catch (err) {
        logger.warn({ err }, `live-stream: ${what} read failed`);
        return null;
      }
    };

    const lastSlate = new Map<string, string>();
    let lastStatus = "";
    let lastPositions = "";
    let lastBalances = "";
    let anyLive = false;

    const tick = async (initial: boolean): Promise<void> => {
      if (gone()) return;
      const [frames, status, positions, balances] = await Promise.all([
        Promise.all(leagues.map(async (l) => [l, await readLeague(l)] as const)),
        deps.readStatus().catch((err: unknown) => {
          logger.warn({ err }, "live-stream: status read failed");
          return null;
        }),
        wallet ? readUser("positions", () => deps.readPositions(wallet)) : null,
        wallet ? readUser("balances", () => deps.readBalances(wallet)) : null,
      ]);
      if (gone()) return;
      const nowMs = deps.now();
      anyLive = false;
      const statusJson = status ? JSON.stringify(status) : "";
      if (initial) {
        const snapshot: Record<string, LeagueFrame> = {};
        for (const [l, f] of frames) {
          snapshot[l] = f;
          lastSlate.set(l, JSON.stringify(f));
          if (!("error" in f) && slateHasLiveGame(f, nowMs)) anyLive = true;
        }
        lastStatus = statusJson;
        send("snapshot", { leagues: snapshot, status });
      } else {
        for (const [l, f] of frames) {
          const json = JSON.stringify(f);
          if (!("error" in f) && slateHasLiveGame(f, nowMs)) anyLive = true;
          if (json === lastSlate.get(l)) continue;
          lastSlate.set(l, json);
          if (!("error" in f)) send("slate", { league: l, slate: f });
        }
        if (status && statusJson !== lastStatus) {
          lastStatus = statusJson;
          send("status", status);
        }
      }
      // User frames after the snapshot on the first tick, then on change. A
      // failed read sends nothing (the client keeps its last value / poll).
      if (wallet && positions) {
        const json = JSON.stringify(positions);
        if (json !== lastPositions) {
          lastPositions = json;
          send("positions", { wallet, positions });
        }
      }
      if (wallet && balances) {
        const json = JSON.stringify(balances);
        if (json !== lastBalances) {
          lastBalances = json;
          send("balances", { wallet, chainId: deps.balancesChainId, balances });
        }
      }
      if (nowMs - startedAt >= deps.maxDurationMs) {
        send("end", { reason: "max_duration" });
        finish();
        return;
      }
      tickTimer = setTimeout(
        () => {
          void tick(false);
        },
        anyLive ? deps.liveTickMs : deps.idleTickMs,
      );
    };

    res.write("retry: 3000\n\n");
    heartbeat = setInterval(() => {
      if (gone()) return;
      res.write(": heartbeat\n\n");
    }, deps.heartbeatMs);
    await tick(true);
  });

  return router;
}

export const liveStreamRouter = createLiveStreamRouter();
