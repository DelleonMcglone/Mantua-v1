/**
 * Phase 7 / R-008 — the in-process load test: the spike shape against the
 * real routers on an ephemeral express app, so CI proves the budget and
 * the shedding rule hold before any deployment is load-tested.
 *
 * What is measured: 150 concurrent live streams open and each receives its
 * snapshot while the 151st is shed; 300 concurrent `/api/status` reads
 * collapse onto ONE underlying read; 100 concurrent quotes through the real
 * trade router (limiter bypassed with the load-test secret, as the script
 * does) return with zero errors. Timing here is the WHOLE burst's wall
 * clock against a multiple of the route's budget: client and server share
 * one event loop in-process, so per-request p95 mostly measures the burst's
 * own queueing. Per-request p95 against the budget is the deployment
 * script's gate (`scripts/load-test.ts`).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
process.env.LOAD_TEST_SECRET = "load-test-secret-for-ci-0001";

const { createLiveStreamRouter } = await import("./live-stream.ts");
const { createPlatformStatusRouter, createPlatformStatusReader } =
  await import("./platform-status.ts");
const { createMarketTradeRouter } = await import("./market-trade.ts");
const { LATENCY_BUDGETS_MS, percentile } = await import("../lib/metrics.ts");
const { LOAD_TEST_HEADER } = await import("../middleware/rate-limit.ts");

type PublicSlate = import("../lib/sports/public-slate.ts").PublicSlate;
type BuiltMarketTrade = import("../lib/sports/market-trade-build.ts").BuiltMarketTrade;

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

const NOW = 1_800_000_000_000;
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** The whole burst must complete within this many budgets of wall time. */
const BURST_BUDGETS = 3;

function slate(league: string): PublicSlate {
  return {
    league,
    provider: "canonical",
    delayed: false,
    fetchedAt: NOW,
    dataAsOf: NOW,
    events: Array.from({ length: 12 }, (_, i) => ({
      providerEventId: `40${String(i)}`,
      startsAt: Math.floor(NOW / 1000) - 600,
      status: "in_progress",
      home: {
        key: `${league}:H${String(i)}`,
        name: `Home ${String(i)}`,
        abbreviation: `H${String(i)}`,
      },
      away: {
        key: `${league}:A${String(i)}`,
        name: `Away ${String(i)}`,
        abbreviation: `A${String(i)}`,
      },
      homeScore: i,
      awayScore: 0,
      homeWinProbabilityBps: 5_000,
    })),
  };
}

function listen(app: express.Express): Promise<string> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

void describe("R-008 in-process spike", () => {
  void it("150 concurrent streams all receive their snapshot, the burst within three stream_open budgets; the 151st is shed", async () => {
    const STREAMS = 150;
    const reads = { slate: 0, status: 0 };
    const app = express();
    app.use(
      createLiveStreamRouter({
        readSlate: async (league) => {
          reads.slate += 1;
          await delay(15); // a DB read
          return slate(league);
        },
        readStatus: async () => {
          reads.status += 1;
          await delay(5);
          const { assessPlatformStatus } = await import("../lib/platform-status.ts");
          return assessPlatformStatus(
            {
              feeds: [{ league: "nfl", dataAsOf: NOW, liveGames: 12 }],
              killSwitch: false,
              providerBreakers: {},
              rpc: { healthy: true },
            },
            NOW,
          );
        },
        now: () => Date.now(),
        liveTickMs: 5_000,
        idleTickMs: 5_000,
        heartbeatMs: 5_000,
        maxDurationMs: 60_000,
        maxConnections: STREAMS,
      }),
    );
    const origin = await listen(app);

    const opens = await Promise.all(
      Array.from({ length: STREAMS }, async () => {
        const t0 = performance.now();
        const res = await fetch(`${origin}/api/stream/live?league=nfl`);
        if (!res.ok || !res.body) return { ok: false, ms: 0, reader: null };
        const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
        const decoder = new TextDecoder();
        let text = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          if (text.includes("event: snapshot")) break;
        }
        const ms = performance.now() - t0;
        return { ok: text.includes("event: snapshot"), ms, reader };
      }),
    );
    // The 151st client is shed to polling.
    const shed = await fetch(`${origin}/api/stream/live?league=nfl`);
    assert.equal(shed.status, 503);
    assert.equal(((await shed.json()) as { code?: string }).code, "STREAM_BUSY");

    const okCount = opens.filter((o) => o.ok).length;
    assert.equal(okCount, STREAMS, "every stream received a snapshot");
    const slowest = Math.max(...opens.map((o) => o.ms));
    const limit = LATENCY_BUDGETS_MS.stream_open * BURST_BUDGETS;
    assert.ok(
      slowest <= limit,
      `all ${String(STREAMS)} streams opened within ${String(limit)} ms (slowest ${String(Math.round(slowest))} ms, p95 ${String(
        Math.round(
          percentile(
            opens.map((o) => o.ms),
            95,
          ) ?? 0,
        ),
      )} ms)`,
    );
    // N streams shared reads: far fewer slate reads than streams (the 2 s
    // per-instance cache is in the default deps; here the fake counts
    // calls directly, so what is proven is that one snapshot tick per
    // stream did not fan out into per-tick re-reads before the first frame).
    assert.ok(reads.slate <= STREAMS, "no read amplification beyond one per stream");
    for (const o of opens) await o.reader?.cancel();
  });

  void it("300 concurrent status reads collapse onto one underlying read, the burst within three status budgets", async () => {
    const READS = 300;
    let underlying = 0;
    const reader = createPlatformStatusReader(
      {
        readFeeds: async () => {
          underlying += 1;
          await delay(30);
          return [{ league: "nfl", dataAsOf: NOW, liveGames: 1 }];
        },
        readKillSwitch: () => Promise.resolve(false),
        readBreakers: () => ({}),
        readRpcHealth: () => ({ healthy: true }),
        now: () => NOW,
      },
      5_000,
    );
    const app = express();
    app.use(createPlatformStatusRouter(reader));
    const origin = await listen(app);

    const t0 = performance.now();
    const times = await Promise.all(
      Array.from({ length: READS }, async () => {
        const s = performance.now();
        const res = await fetch(`${origin}/api/status`);
        assert.equal(res.status, 200);
        await res.json();
        return performance.now() - s;
      }),
    );
    const wall = performance.now() - t0;
    assert.equal(underlying, 1, "one computation served every concurrent reader");
    const limit = LATENCY_BUDGETS_MS.status * BURST_BUDGETS;
    assert.ok(
      wall <= limit,
      `${String(READS)} concurrent status reads served within ${String(limit)} ms (wall ${String(Math.round(wall))} ms, p95 ${String(Math.round(percentile(times, 95) ?? 0))} ms)`,
    );
  });

  void it("100 concurrent quotes through the real trade router (limiter bypassed by the load-test secret) return with zero errors, the burst within three quote budgets", async () => {
    const QUOTES = 100;
    const build = async (args: {
      amountRaw: bigint;
      direction: "buy" | "sell";
    }): Promise<BuiltMarketTrade> => {
      await delay(10); // the quoter round trip
      const amountOut = args.amountRaw * 2n;
      return {
        to: "0x00000000000000000000000000000000000000f1",
        data: "0x00",
        value: "0",
        approvalTarget: null,
        inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        marketId: `0x${"11".repeat(32)}`,
        marketAddress: "0x00000000000000000000000000000000000000e1",
        yesToken: "0x00000000000000000000000000000000000000e2",
        sqrtPriceLimitX96: "1",
        quote: {
          amountIn: args.amountRaw.toString(),
          amountOut: amountOut.toString(),
          amountOutMinimum: amountOut.toString(),
          effectivePriceBps: 5_000,
        },
        fee: {
          feePips: 0,
          ratePips: 0,
          probabilityBps: 5_000,
          playoffs: false,
          stale: false,
          feeRaw: "0",
          feeUsdcRaw: "0",
          breakdown: {
            minRate: 0,
            liquidityPremium: 0,
            volatilityPremium: 0,
            activityPremium: 0,
            uncertaintyPremium: 0,
            rate: 0,
            probabilityBps: 5_000,
            playoffs: false,
            stale: false,
          },
        },
      };
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.privyUserId = "did:privy:load";
      req.walletAddress = "0x00000000000000000000000000000000000000aa";
      next();
    });
    app.use(
      createMarketTradeRouter({
        build: (args) => build(args),
        checkCap: () => Promise.resolve(),
        spendIo: { check: () => Promise.resolve(), record: () => Promise.resolve() },
      }),
    );
    const origin = await listen(app);

    const burstStart = performance.now();
    const results = await Promise.all(
      Array.from({ length: QUOTES }, async (_, i) => {
        const s = performance.now();
        const res = await fetch(`${origin}/api/markets/trade/quote`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [LOAD_TEST_HEADER]: process.env.LOAD_TEST_SECRET ?? "",
          },
          body: JSON.stringify({
            providerEventId: "401",
            outcomeIndex: 0,
            direction: "buy",
            amountRaw: String(1_000_000 + i),
          }),
        });
        await res.json();
        return { status: res.status, ms: performance.now() - s };
      }),
    );
    const wall = performance.now() - burstStart;
    const errors = results.filter((r) => r.status !== 200).length;
    assert.equal(
      errors,
      0,
      `zero errors (${String(results.filter((r) => r.status === 429).length)} would have been 429 without the bypass)`,
    );
    const limit = LATENCY_BUDGETS_MS.quote * BURST_BUDGETS;
    assert.ok(
      wall <= limit,
      `${String(QUOTES)} concurrent quotes served within ${String(limit)} ms (wall ${String(Math.round(wall))} ms, p95 ${String(
        Math.round(
          percentile(
            results.map((r) => r.ms),
            95,
          ) ?? 0,
        ),
      )} ms)`,
    );
  });
});
