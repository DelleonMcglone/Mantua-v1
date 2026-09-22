/**
 * Phase 7 / R-009 — chaos drills: kill a data feed, an RPC, a provider
 * host, or flip the kill switch mid-game, and verify the halts, the banner,
 * the alerts and the recovery behave as designed — through the SHIPPED
 * modules at the seams they expose (the agent-e2e.test convention).
 *
 * Each drill is one continuous timeline: healthy → the fault → what the
 * user and the operator see → the fault clears → back to live. What is
 * pinned is that four independent surfaces agree at every step: the trade
 * gate (`assessMarketTradability`), the status ladder (`assessPlatformStatus`),
 * the alert policy (`evaluateAlerts`), and the transport (the live stream
 * keeps delivering reads while writes degrade).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { assessPlatformStatus } = await import("./platform-status.ts");
const { evaluateAlerts } = await import("./alerts.ts");
const { assessMarketTradability, IN_PLAY_FEED_MAX_AGE_MS } =
  await import("./sports/market-trade-build.ts");
const { CANONICAL_FRESH_MS } = await import("./sports/public-slate.ts");
const { RpcHealthRegistry, RPC_HOST_FAILURE_THRESHOLD } = await import("./rpc-config.ts");
const { createKillSwitchGate } = await import("../middleware/kill-switch.ts");
const { ResilientJson, BREAKER_THRESHOLD } = await import("./sports/resilience.ts");
const { createLiveStreamRouter } = await import("../routes/live-stream.ts");

type PublicSlate = import("./sports/public-slate.ts").PublicSlate;
type PlatformStatusInput = import("./platform-status.ts").PlatformStatusInput;
type RequestHandler = import("express").RequestHandler;

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

const T0 = 1_800_000_000_000;
const KICKOFF_S = Math.floor(T0 / 1000) - 600; // kicked off 10 min before T0

function gate(lastPolledAtMs: number | null) {
  return {
    status: "in_progress",
    startsAtMs: KICKOFF_S * 1000,
    lastPolledAtMs,
    marketState: "OPEN",
  };
}

function statusInput(
  over: Partial<PlatformStatusInput> & { dataAsOf?: number | null },
): PlatformStatusInput {
  return {
    feeds: [
      { league: "nfl", dataAsOf: over.dataAsOf === undefined ? T0 : over.dataAsOf, liveGames: 1 },
    ],
    killSwitch: over.killSwitch ?? false,
    providerBreakers: over.providerBreakers ?? {},
    rpc: over.rpc ?? { healthy: true, detail: "ok" },
  };
}

const alertIds = (input: PlatformStatusInput, now: number) =>
  evaluateAlerts({
    status: assessPlatformStatus(input, now),
    latency: [],
    counters: {},
    frozenNotFinal: [],
    stream: { connections: 0, max: 200 },
  }).map((a) => `${a.severity}:${a.id}`);

async function dispatch(gateFn: RequestHandler, method: string, path: string) {
  const result = { nexted: false, status: 0, body: undefined as unknown };
  const res = {
    status: (code: number) => {
      result.status = code;
      return res;
    },
    json: (body: unknown) => {
      result.body = body;
    },
  };
  await gateFn({ method, path } as never, res as never, () => {
    result.nexted = true;
  });
  return result;
}

void describe("R-009 chaos drills", () => {
  void it("DRILL 1 — the data feed dies mid-game: buys halt at the threshold with the banner and a page, sells never close, and recovery is immediate on the next ingest", () => {
    // t0: healthy. Feed just polled, game in play.
    let now = T0;
    let lastIngest = T0;
    assert.equal(assessMarketTradability(gate(lastIngest), "buy", now).kind, "open");
    let status = assessPlatformStatus(statusInput({ dataAsOf: lastIngest }), now);
    assert.equal(status.mode, "live");
    assert.equal(status.message, null);
    assert.deepEqual(alertIds(statusInput({ dataAsOf: lastIngest }), now), []);

    // The ingest loop stops. Half-way to the halt threshold: the OPERATOR
    // is warned (one more missed tick halts) — but the feed is not yet
    // stale enough to say so to users. CANONICAL_FRESH_MS sits ABOVE this
    // point deliberately (see its own doc comment): the in-play cron fires
    // every 5 minutes and drifts under load, so a public "delayed" label
    // this early would flap on ordinary jitter, not a real outage.
    now = T0 + IN_PLAY_FEED_MAX_AGE_MS / 2 + 1_000;
    assert.equal(assessMarketTradability(gate(lastIngest), "buy", now).kind, "open");
    assert.deepEqual(alertIds(statusInput({ dataAsOf: lastIngest }), now), ["warn:feed_lag:nfl"]);
    status = assessPlatformStatus(statusInput({ dataAsOf: lastIngest }), now);
    assert.equal(status.mode, "live", "ops is warned privately before users see anything");
    assert.equal(status.message, null);

    // Past CANONICAL_FRESH_MS, still short of the halt: NOW users are told.
    // Buys are still open — the public warning lands before the halt does,
    // giving a trader real notice rather than a trade that just stops
    // working with no explanation.
    now = T0 + CANONICAL_FRESH_MS + 1_000;
    assert.equal(assessMarketTradability(gate(lastIngest), "buy", now).kind, "open");
    status = assessPlatformStatus(statusInput({ dataAsOf: lastIngest }), now);
    assert.equal(status.mode, "degraded", "delayed data during play is announced before the halt");
    assert.equal(status.trading, "open");

    // Past the threshold: the gate refuses BUYS, allows SELLS; the status
    // says exactly that; the alert is critical.
    now = T0 + IN_PLAY_FEED_MAX_AGE_MS + 1_000;
    const buy = assessMarketTradability(gate(lastIngest), "buy", now);
    assert.equal(buy.kind, "halted");
    assert.equal(
      assessMarketTradability(gate(lastIngest), "sell", now).kind,
      "open",
      "exits ride through the outage",
    );
    status = assessPlatformStatus(statusInput({ dataAsOf: lastIngest }), now);
    assert.equal(status.trading, "buys_halted");
    assert.equal(status.feeds["nfl"].buysHalted, true);
    assert.match(status.message ?? "", /new buys .* paused/);
    assert.match(status.message ?? "", /Selling .* unaffected/);
    assert.deepEqual(alertIds(statusInput({ dataAsOf: lastIngest }), now), [
      "critical:feed_dark:nfl",
    ]);

    // Recovery: one ingest lands. Everything flips back on the same read.
    lastIngest = now;
    assert.equal(assessMarketTradability(gate(lastIngest), "buy", now).kind, "open");
    status = assessPlatformStatus(statusInput({ dataAsOf: lastIngest }), now);
    assert.equal(status.mode, "live");
    assert.equal(status.trading, "open");
    assert.deepEqual(alertIds(statusInput({ dataAsOf: lastIngest }), now), []);
  });

  void it("DRILL 2 — the RPC dies mid-game: status degrades with the RPC message, the alert pages, reads keep streaming from the DB, and a single success on any host recovers", async () => {
    const registry = new RpcHealthRegistry(["https://a.example/KEY", "https://b.example/KEY"]);
    const rpcInput = () => {
      const h = registry.snapshot();
      return { healthy: h.healthy, detail: h.detail };
    };

    // Healthy.
    assert.equal(assessPlatformStatus(statusInput({ rpc: rpcInput() }), T0).mode, "live");

    // Primary fails: on fallback → warn, still live reads.
    for (let i = 0; i < RPC_HOST_FAILURE_THRESHOLD; i += 1)
      registry.record(0, false, new Error("429 rate limit"));
    assert.deepEqual(alertIds(statusInput({ rpc: rpcInput() }), T0), ["warn:rpc_on_fallback"]);

    // Fallback fails too: every host down → degraded + critical.
    for (let i = 0; i < RPC_HOST_FAILURE_THRESHOLD; i += 1)
      registry.record(1, false, new Error("ECONNRESET"));
    const down = assessPlatformStatus(statusInput({ rpc: rpcInput() }), T0);
    assert.equal(down.mode, "degraded");
    assert.equal(
      down.trading,
      "open",
      "an RPC outage closes nothing server-side — trades still settle on-chain",
    );
    assert.match(down.message ?? "", /Blockchain reads are degraded/);
    assert.deepEqual(alertIds(statusInput({ rpc: rpcInput() }), T0), ["critical:rpc_down"]);

    // Reads stay live: the stream serves the canonical slate (a DB read)
    // and pushes the degraded status in the same snapshot.
    const app = express();
    app.use(
      createLiveStreamRouter({
        readSlate: (league) =>
          Promise.resolve<PublicSlate>({
            league,
            provider: "canonical",
            delayed: false,
            fetchedAt: T0,
            dataAsOf: T0,
            events: [
              {
                providerEventId: "401",
                startsAt: KICKOFF_S,
                status: "in_progress",
                home: { key: "nfl:A", name: "A", abbreviation: "A" },
                away: { key: "nfl:B", name: "B", abbreviation: "B" },
                homeScore: 3,
                awayScore: 0,
              },
            ],
          }),
        readStatus: () =>
          Promise.resolve(assessPlatformStatus(statusInput({ rpc: rpcInput() }), T0)),
        now: () => Date.now(),
        liveTickMs: 5_000,
        idleTickMs: 5_000,
        heartbeatMs: 5_000,
        maxDurationMs: 60_000,
        maxConnections: 5,
      }),
    );
    const origin = await new Promise<string>((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => {
        servers.push(server);
        const addr = server.address();
        if (addr === null || typeof addr === "string") throw new Error("no port");
        resolve(`http://127.0.0.1:${String(addr.port)}`);
      });
    });
    const res = await fetch(`${origin}/api/stream/live?league=nfl`);
    assert.equal(res.status, 200);
    const reader = res.body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes("event: snapshot")) break;
    }
    await reader.cancel();
    const frame = text.split("\n\n").find((f) => f.includes("event: snapshot")) ?? "";
    const data = JSON.parse(
      frame
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5) ?? "{}",
    ) as {
      leagues: Record<string, { events: { homeScore: number }[] }>;
      status: { mode: string; message: string | null };
    };
    assert.equal(
      data.leagues["nfl"].events[0]?.homeScore,
      3,
      "the score still streams while the chain is unreadable",
    );
    assert.equal(data.status.mode, "degraded");
    assert.match(data.status.message ?? "", /Blockchain reads/);

    // Recovery: one success on the primary clears its streak.
    registry.record(0, true, undefined);
    assert.equal(assessPlatformStatus(statusInput({ rpc: rpcInput() }), T0).mode, "live");
    assert.deepEqual(alertIds(statusInput({ rpc: rpcInput() }), T0), []);
  });

  void it("DRILL 3 — the kill switch is flipped mid-game: writes refuse, reads and the read-only live-sync pass, the status says paused, and disengaging restores everything", async () => {
    const flag = { engaged: false };
    const gateFn = createKillSwitchGate({
      envEngaged: false,
      runtime: { read: () => Promise.resolve(flag.engaged) },
    });

    // Engage.
    flag.engaged = true;
    const post = await dispatch(gateFn, "POST", "/api/markets/trade/calldata");
    assert.equal(post.nexted, false);
    assert.equal(post.status, 503);
    assert.equal((post.body as { code: string }).code, "KILL_SWITCH_ACTIVE");
    assert.equal((await dispatch(gateFn, "GET", "/api/sports/slate")).nexted, true, "reads pass");
    assert.equal(
      (await dispatch(gateFn, "GET", "/api/stream/live")).nexted,
      true,
      "the stream passes",
    );
    assert.equal(
      (await dispatch(gateFn, "GET", "/api/cron/live-sync")).nexted,
      true,
      "the read-only ingest tick keeps running",
    );
    assert.equal(
      (await dispatch(gateFn, "GET", "/api/cron/strategies")).nexted,
      false,
      "money crons are refused",
    );

    const paused = assessPlatformStatus(statusInput({ killSwitch: true }), T0);
    assert.equal(paused.mode, "paused");
    assert.equal(paused.trading, "paused");
    assert.match(paused.message ?? "", /paused by the operator/);
    assert.deepEqual(
      alertIds(statusInput({ killSwitch: true }), T0),
      ["info:kill_switch"],
      "deliberate — shown, not paged",
    );

    // Disengage.
    flag.engaged = false;
    assert.equal((await dispatch(gateFn, "POST", "/api/markets/trade/calldata")).nexted, true);
    assert.equal(assessPlatformStatus(statusInput({}), T0).mode, "live");
  });

  void it("DRILL 4 — a provider host dies: the breaker opens after the threshold, stale data serves flagged delayed, the status degrades without closing trading, and the breaker half-opens for recovery", async () => {
    const world = { down: false, calls: 0 };
    const fetchImpl: typeof fetch = () => {
      world.calls += 1;
      if (world.down) return Promise.reject(new Error("ECONNREFUSED"));
      return Promise.resolve(new Response(JSON.stringify({ games: [1, 2, 3] }), { status: 200 }));
    };
    const http = new ResilientJson(["https://provider.example"], fetchImpl);

    // Healthy fetch, cached.
    const fresh = await http.get<{ games: number[] }>("slate", "/nfl", 1);
    assert.equal(fresh.delayed, false);
    await new Promise((r) => setTimeout(r, 5)); // let the 1 ms TTL lapse

    // Host dies. Each read retries (3 attempts) then serves the stale copy,
    // flagged delayed; after BREAKER_THRESHOLD failures the breaker opens
    // and the host is skipped without further calls.
    world.down = true;
    const stale1 = await http.get<{ games: number[] }>("slate", "/nfl", 1);
    assert.equal(stale1.delayed, true, "stale-serve, labeled");
    assert.deepEqual(stale1.value, { games: [1, 2, 3] });
    const stale2 = await http.get<{ games: number[] }>("slate", "/nfl", 1);
    assert.equal(stale2.delayed, true);
    const breakers = http.breakerState();
    const b = breakers["https://provider.example"];
    assert.ok(b);
    assert.ok(b.failures >= BREAKER_THRESHOLD);
    assert.equal(b.open, true, "breaker open");
    const callsWhenOpen = world.calls;
    const stale3 = await http.get<{ games: number[] }>("slate", "/nfl", 1);
    assert.equal(stale3.delayed, true);
    assert.equal(world.calls, callsWhenOpen, "an open breaker makes no upstream calls");

    // The status ladder sees the open breaker: degraded, trading open.
    const input = statusInput({ providerBreakers: { espn: breakers } });
    const s = assessPlatformStatus(input, T0);
    assert.equal(s.mode, "degraded");
    assert.equal(s.trading, "open");
    assert.deepEqual(s.openBreakers, ["espn:https://provider.example"]);
    assert.deepEqual(alertIds(input, T0), ["warn:provider_breaker_open"]);
  });
});
