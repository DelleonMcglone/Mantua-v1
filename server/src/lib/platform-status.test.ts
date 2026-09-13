import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { assessPlatformStatus, readPlatformStatus } = await import("./platform-status.ts");
const { CANONICAL_FRESH_MS } = await import("./sports/public-slate.ts");
const { IN_PLAY_FEED_MAX_AGE_MS } = await import("./sports/market-trade-build.ts");

const NOW = 1_800_000_000_000;
const noBreakers = {};

function feed(league: string, ageMs: number | null, liveGames: number) {
  return { league, dataAsOf: ageMs === null ? null : NOW - ageMs, liveGames };
}

/**
 * Phase 7 / R-005 — the degradation ladder is pure and mirrors the
 * enforcement points: buys halt here under exactly P-012's rule, data is
 * delayed under exactly the slate route's rule, and the kill switch beats
 * everything. The banner text always names what is closed and what still
 * works.
 */
void describe("assessPlatformStatus (R-005 degradation ladder)", () => {
  void it("fresh feeds, no games, no breakers → live, open, no message", () => {
    const s = assessPlatformStatus(
      {
        feeds: [feed("nfl", 30_000, 0), feed("wnba", 60_000, 0)],
        killSwitch: false,
        providerBreakers: noBreakers,
        rpc: null,
      },
      NOW,
    );
    assert.equal(s.mode, "live");
    assert.equal(s.reads, "live");
    assert.equal(s.trading, "open");
    assert.equal(s.message, null);
    assert.equal(s.feeds["nfl"].delayed, false);
    assert.equal(s.feeds["nfl"].buysHalted, false);
  });

  void it("a live game on a feed older than IN_PLAY_FEED_MAX_AGE_MS halts buys — the same rule the trade gate refuses under — and says sells stay open", () => {
    const s = assessPlatformStatus(
      {
        feeds: [feed("nfl", IN_PLAY_FEED_MAX_AGE_MS + 1, 2), feed("wnba", 10_000, 0)],
        killSwitch: false,
        providerBreakers: noBreakers,
        rpc: null,
      },
      NOW,
    );
    assert.equal(s.trading, "buys_halted");
    assert.equal(s.mode, "degraded");
    assert.equal(s.reads, "delayed", "a stale feed with a game in play is delayed data");
    assert.equal(s.feeds["nfl"].buysHalted, true);
    assert.equal(s.feeds["wnba"].buysHalted, false);
    assert.match(s.message ?? "", /NFL/);
    assert.match(s.message ?? "", /new buys .* paused/);
    assert.match(s.message ?? "", /Selling .* unaffected/);
  });

  void it("exactly at the threshold the feed still counts as fresh (strictly older halts)", () => {
    const s = assessPlatformStatus(
      {
        feeds: [feed("nfl", IN_PLAY_FEED_MAX_AGE_MS, 1)],
        killSwitch: false,
        providerBreakers: noBreakers,
        rpc: null,
      },
      NOW,
    );
    assert.equal(s.feeds["nfl"].buysHalted, false);
    assert.equal(s.trading, "open");
  });

  void it("a never-ingested league with a game in play is halted (absence of data is an outage, never fresh)", () => {
    const s = assessPlatformStatus(
      { feeds: [feed("nfl", null, 1)], killSwitch: false, providerBreakers: noBreakers, rpc: null },
      NOW,
    );
    assert.equal(s.feeds["nfl"].ageMs, null);
    assert.equal(s.feeds["nfl"].buysHalted, true);
  });

  void it("a stale feed with NO game in play only delays reads when every league is stale — one idle league alone is not a platform degradation", () => {
    const oneIdle = assessPlatformStatus(
      {
        feeds: [feed("nfl", 20_000, 0), feed("wnba", CANONICAL_FRESH_MS * 40, 0)],
        killSwitch: false,
        providerBreakers: noBreakers,
        rpc: null,
      },
      NOW,
    );
    assert.equal(oneIdle.feeds["wnba"].delayed, true, "the league itself is labeled delayed");
    assert.equal(oneIdle.reads, "live");
    assert.equal(oneIdle.mode, "live");

    const allDark = assessPlatformStatus(
      {
        feeds: [feed("nfl", CANONICAL_FRESH_MS + 1, 0), feed("wnba", CANONICAL_FRESH_MS * 2, 0)],
        killSwitch: false,
        providerBreakers: noBreakers,
        rpc: null,
      },
      NOW,
    );
    assert.equal(allDark.reads, "delayed");
    assert.equal(allDark.mode, "degraded");
    assert.equal(allDark.trading, "open", "stale data closes nothing off-game");
    assert.match(allDark.message ?? "", /delayed/);
    assert.match(allDark.message ?? "", /Trading stays open/);
  });

  void it("the kill switch pauses trading and wins over every other signal, with reads still viewable", () => {
    const s = assessPlatformStatus(
      {
        feeds: [feed("nfl", IN_PLAY_FEED_MAX_AGE_MS * 2, 3)],
        killSwitch: true,
        providerBreakers: { espn: { "site.api.espn.com": { failures: 5, open: true } } },
        rpc: { healthy: false },
      },
      NOW,
    );
    assert.equal(s.mode, "paused");
    assert.equal(s.trading, "paused");
    assert.equal(s.killSwitch, true);
    assert.match(s.message ?? "", /paused by the operator/);
    assert.match(s.message ?? "", /stay viewable/);
    assert.deepEqual(s.openBreakers, ["espn:site.api.espn.com"]);
  });

  void it("an open provider breaker alone degrades without closing anything", () => {
    const s = assessPlatformStatus(
      {
        feeds: [feed("nfl", 5_000, 0)],
        killSwitch: false,
        providerBreakers: {
          espn: { a: { failures: 5, open: true }, b: { failures: 0, open: false } },
        },
        rpc: null,
      },
      NOW,
    );
    assert.equal(s.mode, "degraded");
    assert.equal(s.trading, "open");
    assert.deepEqual(s.openBreakers, ["espn:a"]);
    assert.match(s.message ?? "", /provider is degraded/);
  });

  void it("unhealthy RPC degrades with an RPC message; healthy or unknown RPC is silent", () => {
    const bad = assessPlatformStatus(
      {
        feeds: [feed("nfl", 5_000, 0)],
        killSwitch: false,
        providerBreakers: noBreakers,
        rpc: { healthy: false, detail: "rate-limited" },
      },
      NOW,
    );
    assert.equal(bad.mode, "degraded");
    assert.match(bad.message ?? "", /Blockchain reads are degraded/);
    const ok = assessPlatformStatus(
      {
        feeds: [feed("nfl", 5_000, 0)],
        killSwitch: false,
        providerBreakers: noBreakers,
        rpc: { healthy: true },
      },
      NOW,
    );
    assert.equal(ok.mode, "live");
  });
});

void describe("readPlatformStatus (snapshot over injected seams)", () => {
  void it("composes the seams and stamps generatedAt from the injected clock", async () => {
    const s = await readPlatformStatus({
      readFeeds: () => Promise.resolve([feed("nfl", 1_000, 1)]),
      readKillSwitch: () => Promise.resolve(false),
      readBreakers: () => ({}),
      readRpcHealth: () => null,
      now: () => NOW,
    });
    assert.equal(s.generatedAt, NOW);
    assert.equal(s.mode, "live");
    assert.equal(s.feeds["nfl"].liveGames, 1);
  });

  void it("a failing feed read reports no leagues (never invents freshness); a failing kill-switch read reads as disengaged", async () => {
    const s = await readPlatformStatus({
      readFeeds: () => Promise.reject(new Error("db down")),
      readKillSwitch: () => Promise.reject(new Error("redis down")),
      readBreakers: () => ({}),
      readRpcHealth: () => null,
      now: () => NOW,
    });
    assert.deepEqual(s.feeds, {});
    assert.equal(s.killSwitch, false);
  });
});
