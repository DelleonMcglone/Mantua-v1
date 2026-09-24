/**
 * Phase 7 / R-001 — the live market stream's wire protocol, driven through
 * the real router on an ephemeral express app with the readers faked at
 * the seams `createLiveStreamRouter` exposes and the timers shrunk.
 *
 * What is pinned: the first frame is a full snapshot (every league + the
 * platform status); later ticks emit `slate` only for a league whose data
 * changed and `status` only when the status changed; the stream ends
 * itself with an `end` frame at its max duration; capacity sheds the next
 * client with 503 STREAM_BUSY + Retry-After so it falls back to polling.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { createLiveStreamRouter, slateHasLiveGame } = await import("./live-stream.ts");
const { assessPlatformStatus } = await import("../lib/platform-status.ts");

type PublicSlate = import("../lib/sports/public-slate.ts").PublicSlate;
type PlatformStatus = import("../lib/platform-status.ts").PlatformStatus;
type LiveStreamDeps = import("./live-stream.ts").LiveStreamDeps;

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

const NOW = 1_800_000_000_000;

function slate(league: string, homeScore: number, status = "in_progress"): PublicSlate {
  return {
    league,
    provider: "canonical",
    delayed: false,
    fetchedAt: NOW - 1_000,
    dataAsOf: NOW - 1_000,
    events: [
      {
        providerEventId: "401",
        startsAt: Math.floor(NOW / 1000) - 600,
        status,
        home: { key: `${league}:AAA`, name: "Alpha", abbreviation: "AAA" },
        away: { key: `${league}:BBB`, name: "Beta", abbreviation: "BBB" },
        homeScore,
        awayScore: 0,
        homeWinProbabilityBps: 5_000,
      },
    ],
  };
}

function liveStatus(killSwitch: boolean): PlatformStatus {
  return assessPlatformStatus(
    {
      feeds: [{ league: "nfl", dataAsOf: NOW - 1_000, liveGames: 1 }],
      killSwitch,
      providerBreakers: {},
      rpc: null,
    },
    NOW,
  );
}

interface Frame {
  id?: string;
  event?: string;
  data?: unknown;
  comment?: string;
  retry?: string;
}

function parseFrames(text: string): Frame[] {
  return text
    .split("\n\n")
    .filter((f) => f.trim().length > 0)
    .map((f) => {
      const frame: Frame = {};
      for (const line of f.split("\n")) {
        if (line.startsWith(":")) frame.comment = line.slice(1).trim();
        else if (line.startsWith("id:")) frame.id = line.slice(3).trim();
        else if (line.startsWith("event:")) frame.event = line.slice(6).trim();
        else if (line.startsWith("retry:")) frame.retry = line.slice(6).trim();
        else if (line.startsWith("data:")) frame.data = JSON.parse(line.slice(5).trim());
      }
      return frame;
    });
}

/** `wallet` stands in for what the soft attachAuth resolves from a bearer
 *  token; omitted = an anonymous stream. */
function serve(overrides: Partial<LiveStreamDeps>, wallet?: string): Promise<string> {
  const app = express();
  if (wallet) {
    app.use((req, _res, next) => {
      req.walletAddress = wallet;
      next();
    });
  }
  app.use(createLiveStreamRouter(overrides));
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

/** A scripted world: the slate and status the readers return per tick. */
function world() {
  const state = { nflScore: 7, killSwitch: false, reads: 0, statusReads: 0, clock: NOW };
  const deps: Partial<LiveStreamDeps> = {
    readSlate: (league) => {
      state.reads += 1;
      return Promise.resolve(
        league === "nfl" ? slate("nfl", state.nflScore) : slate("wnba", 50, "scheduled"),
      );
    },
    readStatus: () => {
      state.statusReads += 1;
      return Promise.resolve(liveStatus(state.killSwitch));
    },
    now: () => state.clock,
    liveTickMs: 20,
    idleTickMs: 20,
    heartbeatMs: 30,
    maxDurationMs: 10_000,
    maxConnections: 2,
  };
  return { state, deps };
}

async function readStream(
  res: Response,
  until: (frames: Frame[]) => boolean,
  timeoutMs = 2_000,
): Promise<Frame[]> {
  if (!res.body) throw new Error("no body");
  const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (until(parseFrames(text)) || Date.now() > deadline) break;
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return parseFrames(text);
}

void describe("GET /api/stream/live (R-001 wire protocol)", () => {
  void it("opens with retry + a full snapshot (every league and the status), then pushes only what changed", async () => {
    const w = world();
    const origin = await serve(w.deps);
    const res = await fetch(`${origin}/api/stream/live`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

    // Let two ticks pass with nothing changing, then change the NFL score.
    setTimeout(() => {
      w.state.nflScore = 14;
    }, 60);
    const frames = await readStream(res, (fs) => fs.some((f) => f.event === "slate"));
    assert.equal(frames[0]?.retry, "3000");
    const snapshot = frames.find((f) => f.event === "snapshot");
    assert.ok(snapshot, "first data frame is the snapshot");
    assert.equal(snapshot.id, "1");
    const snap = snapshot.data as { leagues: Record<string, PublicSlate>; status: PlatformStatus };
    assert.deepEqual(Object.keys(snap.leagues).sort(), ["nfl"]);
    assert.equal(snap.leagues["nfl"].events[0]?.homeScore, 7);
    assert.equal(snap.status.mode, "live");

    const slates = frames.filter((f) => f.event === "slate");
    assert.equal(
      slates.length,
      1,
      "unchanged ticks push nothing; the score change pushes one slate",
    );
    const delta = slates[0]?.data as { league: string; slate: PublicSlate };
    assert.equal(delta.league, "nfl");
    assert.equal(delta.slate.events[0]?.homeScore, 14);
    assert.equal(
      frames.filter((f) => f.event === "status").length,
      0,
      "status unchanged → no status frame",
    );
    assert.ok(w.state.reads >= 4, "the readers ran every tick");
  });

  void it("pushes a status frame when the platform state changes (kill switch engaged mid-stream)", async () => {
    const w = world();
    const origin = await serve(w.deps);
    const res = await fetch(`${origin}/api/stream/live?league=nfl`);
    setTimeout(() => {
      w.state.killSwitch = true;
    }, 40);
    const frames = await readStream(res, (fs) => fs.some((f) => f.event === "status"));
    const status = frames.find((f) => f.event === "status");
    assert.ok(status, "a status frame arrived");
    assert.equal((status.data as PlatformStatus).mode, "paused");
    assert.equal((status.data as PlatformStatus).trading, "paused");
    const snap = frames.find((f) => f.event === "snapshot")?.data as {
      leagues: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(snap.leagues), ["nfl"], "?league= scopes the stream");
  });

  void it("sends heartbeat comments so idle connections are provably alive", async () => {
    const w = world();
    w.deps.liveTickMs = 500;
    w.deps.idleTickMs = 500;
    const origin = await serve(w.deps);
    const res = await fetch(`${origin}/api/stream/live`);
    const frames = await readStream(res, (fs) => fs.some((f) => f.comment === "heartbeat"), 400);
    assert.ok(
      frames.some((f) => f.comment === "heartbeat"),
      "a heartbeat comment arrived between ticks",
    );
  });

  void it("ends itself with an `end` frame at its max duration so the client reconnects on purpose", async () => {
    const w = world();
    w.deps.maxDurationMs = 50;
    const origin = await serve(w.deps);
    const res = await fetch(`${origin}/api/stream/live`);
    // Advance the fake clock past the ceiling after the first tick.
    setTimeout(() => {
      w.state.clock = NOW + 60;
    }, 10);
    const frames = await readStream(res, (fs) => fs.some((f) => f.event === "end"), 1_000);
    const end = frames.find((f) => f.event === "end");
    assert.ok(end, "the end frame was sent");
    assert.deepEqual(end.data, { reason: "max_duration" });
  });

  void it("sheds the client past MAX_CONNECTIONS with 503 STREAM_BUSY + Retry-After, and frees the slot on disconnect", async () => {
    const w = world();
    const origin = await serve(w.deps);
    const a = await fetch(`${origin}/api/stream/live`);
    const b = await fetch(`${origin}/api/stream/live`);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const c = await fetch(`${origin}/api/stream/live`);
    assert.equal(c.status, 503);
    assert.equal(c.headers.get("retry-after"), "10");
    const body = (await c.json()) as { code?: string; retryAfterSeconds?: number };
    assert.equal(body.code, "STREAM_BUSY");
    assert.equal(body.retryAfterSeconds, 10);

    await a.body?.cancel();
    await b.body?.cancel();
    // The server sees the close asynchronously; poll briefly for the slot.
    let freed = false;
    for (let i = 0; i < 20 && !freed; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      const d = await fetch(`${origin}/api/stream/live`);
      freed = d.status === 200;
      await d.body?.cancel();
    }
    assert.equal(freed, true, "a disconnected stream releases its connection slot");
  });

  void it("validates league and dates like the slate route", async () => {
    const w = world();
    const origin = await serve(w.deps);
    const badLeague = await fetch(`${origin}/api/stream/live?league=nhl`);
    assert.equal(badLeague.status, 400);
    assert.equal(((await badLeague.json()) as { code?: string }).code, "BAD_LEAGUE");
    const badDates = await fetch(`${origin}/api/stream/live?dates=nope`);
    assert.equal(badDates.status, 400);
    assert.equal(((await badDates.json()) as { code?: string }).code, "BAD_DATES");
  });
});

void describe("slateHasLiveGame", () => {
  void it("in-play means in_progress, or scheduled and past kickoff — the trade gate's notion", () => {
    assert.equal(slateHasLiveGame(slate("nfl", 0, "in_progress"), NOW), true);
    assert.equal(
      slateHasLiveGame(slate("nfl", 0, "scheduled"), NOW),
      true,
      "kicked off by the clock",
    );
    assert.equal(
      slateHasLiveGame(slate("nfl", 0, "scheduled"), NOW - 3_600_000),
      false,
      "not yet kicked off",
    );
    assert.equal(slateHasLiveGame(slate("nfl", 0, "final"), NOW), false);
  });
});

// ─── R-001: positions and balances for a signed-in stream ───────────────────

type PositionRow = import("../lib/sports/market-positions.ts").MarketPositionRow;
type Balance = import("../lib/user-portfolio.ts").UserBalance;

const WALLET = "0x00000000000000000000000000000000000000aa";

function position(balance: string): PositionRow {
  return {
    marketId: "0xm",
    outcomeIndex: 0,
    label: "AAA to beat BBB",
    state: "open",
    startsAt: Math.floor(NOW / 1000),
    side: "yes",
    balance,
    impliedProbBps: 5_000,
    valueRaw: "500000",
    league: "nfl",
    providerEventId: "401",
    entryPriceBps: 4_800,
    pnlRaw: "20000",
    potentialPayoutRaw: "1000000",
  };
}

function usdc(raw: string): Balance {
  return {
    symbol: "USDC",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    balanceRaw: raw,
    usdValue: Number(raw) / 1e6,
  };
}

/** The scripted world plus per-wallet readers that record who they served. */
function userWorld() {
  const w = world();
  const user = {
    yes: "1000000",
    usdcRaw: "5000000",
    positionReads: [] as string[],
    failBalances: false,
  };
  w.deps.readPositions = (wallet) => {
    user.positionReads.push(wallet);
    return Promise.resolve([position(user.yes)]);
  };
  w.deps.readBalances = () =>
    user.failBalances
      ? Promise.reject(new Error("rpc down"))
      : Promise.resolve([usdc(user.usdcRaw)]);
  w.deps.balancesChainId = 8453;
  return { ...w, user };
}

void describe("GET /api/stream/live — signed-in positions and balances (R-001)", () => {
  void it("an anonymous stream carries no user frames and never reads a wallet", async () => {
    const { deps, user } = userWorld();
    const origin = await serve(deps);
    const res = await fetch(`${origin}/api/stream/live`);
    const frames = await readStream(res, (f) => f.filter((x) => x.event).length >= 1, 300);
    assert.equal(frames.find((f) => f.event)?.event, "snapshot");
    assert.ok(!frames.some((f) => f.event === "positions" || f.event === "balances"));
    assert.deepEqual(user.positionReads, []);
  });

  void it("sends the wallet's positions and balances right after the snapshot", async () => {
    const { deps, user } = userWorld();
    const origin = await serve(deps, WALLET);
    const res = await fetch(`${origin}/api/stream/live`);
    const frames = await readStream(res, (f) => f.some((x) => x.event === "balances"));
    const events = frames.filter((f) => f.event).map((f) => f.event);
    assert.deepEqual(events.slice(0, 3), ["snapshot", "positions", "balances"]);
    const pos = frames.find((f) => f.event === "positions")?.data as {
      wallet: string;
      positions: PositionRow[];
    };
    assert.equal(pos.wallet, WALLET);
    assert.equal(pos.positions[0].balance, "1000000");
    const bal = frames.find((f) => f.event === "balances")?.data as {
      wallet: string;
      chainId: number;
      balances: Balance[];
    };
    assert.equal(bal.chainId, 8453);
    assert.equal(bal.balances[0].balanceRaw, "5000000");
    assert.ok(user.positionReads.every((w) => w === WALLET));
  });

  void it("pushes a user frame only when that data changes", async () => {
    const { deps, user } = userWorld();
    const origin = await serve(deps, WALLET);
    const res = await fetch(`${origin}/api/stream/live`);
    // A fill lands: USDC down, YES up — both frames re-send, nothing else.
    setTimeout(() => {
      user.usdcRaw = "4000000";
      user.yes = "3000000";
    }, 60);
    const frames = await readStream(
      res,
      (f) => f.filter((x) => x.event === "balances").length >= 2,
    );
    const balances = frames.filter((f) => f.event === "balances");
    const positions = frames.filter((f) => f.event === "positions");
    assert.equal(balances.length, 2, "one initial + one on change");
    assert.equal((balances[1].data as { balances: Balance[] }).balances[0].balanceRaw, "4000000");
    assert.equal(positions.length, 2);
    assert.ok(!frames.some((f) => f.event === "slate"), "an unchanged slate stays quiet");
  });

  void it("a failed user read sends nothing for it and keeps the stream alive", async () => {
    const { deps, user } = userWorld();
    user.failBalances = true;
    const origin = await serve(deps, WALLET);
    const res = await fetch(`${origin}/api/stream/live`);
    const frames = await readStream(res, (f) => f.some((x) => x.event === "positions"));
    assert.ok(frames.some((f) => f.event === "snapshot"));
    assert.ok(frames.some((f) => f.event === "positions"));
    assert.ok(!frames.some((f) => f.event === "balances"));
  });
});
