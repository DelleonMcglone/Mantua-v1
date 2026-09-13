import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { FROZEN_NOT_FINAL_GRACE_MS, LATENCY_MIN_SAMPLES, TRADE_MIN_SAMPLES, evaluateAlerts } =
  await import("./alerts.ts");
const { assessPlatformStatus } = await import("./platform-status.ts");
const { IN_PLAY_FEED_MAX_AGE_MS } = await import("./sports/market-trade-build.ts");
const { LATENCY_BUDGETS_MS } = await import("./metrics.ts");

type AlertInput = import("./alerts.ts").AlertInput;
type LatencySnapshot = import("./metrics.ts").LatencySnapshot;

const NOW = 1_800_000_000_000;

function status(
  over: {
    feedAgeMs?: number | null;
    liveGames?: number;
    killSwitch?: boolean;
    breakers?: Record<string, Record<string, { failures: number; open: boolean }>>;
    rpc?: { healthy: boolean; detail?: string } | null;
  } = {},
) {
  return assessPlatformStatus(
    {
      feeds: [
        {
          league: "nfl",
          dataAsOf: over.feedAgeMs === null ? null : NOW - (over.feedAgeMs ?? 10_000),
          liveGames: over.liveGames ?? 0,
        },
      ],
      killSwitch: over.killSwitch ?? false,
      providerBreakers: over.breakers ?? {},
      rpc: over.rpc ?? { healthy: true, detail: "ok" },
    },
    NOW,
  );
}

function lat(
  key: LatencySnapshot["key"],
  p95: number,
  count = LATENCY_MIN_SAMPLES,
): LatencySnapshot {
  return {
    key,
    budgetMs: LATENCY_BUDGETS_MS[key],
    count,
    p50: p95 / 2,
    p95,
    p99: p95,
    max: p95,
    violations: 0,
    errors: 0,
  };
}

function input(over: Partial<AlertInput> = {}): AlertInput {
  return {
    status: status(),
    latency: [],
    counters: {},
    frozenNotFinal: [],
    stream: { connections: 0, max: 200 },
    ...over,
  };
}

const ids = (a: ReturnType<typeof evaluateAlerts>) => a.map((x) => `${x.severity}:${x.id}`);

/**
 * Phase 7 / R-010 — the paging policy, pinned: each threshold fires
 * exactly where the doc says, nothing fires on a healthy platform, and
 * critical sorts first.
 */
void describe("evaluateAlerts", () => {
  void it("a healthy platform raises nothing", () => {
    assert.deepEqual(evaluateAlerts(input()), []);
  });

  void it("feed lag during play warns past half the halt threshold and pages once buys halt", () => {
    const lag = evaluateAlerts(
      input({ status: status({ feedAgeMs: IN_PLAY_FEED_MAX_AGE_MS / 2 + 1, liveGames: 1 }) }),
    );
    assert.deepEqual(ids(lag), ["warn:feed_lag:nfl"]);
    const dark = evaluateAlerts(
      input({ status: status({ feedAgeMs: IN_PLAY_FEED_MAX_AGE_MS + 1, liveGames: 2 }) }),
    );
    assert.deepEqual(ids(dark), ["critical:feed_dark:nfl"]);
    assert.match(dark[0]?.detail ?? "", /2 game\(s\) in play/);
    const idle = evaluateAlerts(
      input({ status: status({ feedAgeMs: IN_PLAY_FEED_MAX_AGE_MS * 3, liveGames: 0 }) }),
    );
    assert.deepEqual(ids(idle), [], "no game in play → feed age is not an alert");
  });

  void it("kill switch is info (deliberate), an open breaker warns", () => {
    assert.deepEqual(ids(evaluateAlerts(input({ status: status({ killSwitch: true }) }))), [
      "info:kill_switch",
    ]);
    assert.deepEqual(
      ids(
        evaluateAlerts(
          input({ status: status({ breakers: { espn: { h: { failures: 5, open: true } } } }) }),
        ),
      ),
      ["warn:provider_breaker_open"],
    );
  });

  void it("RPC on fallback warns; all hosts down pages", () => {
    assert.deepEqual(
      ids(
        evaluateAlerts(
          input({
            status: status({ rpc: { healthy: true, detail: "primary x failing — on fallback" } }),
          }),
        ),
      ),
      ["warn:rpc_on_fallback"],
    );
    assert.deepEqual(
      ids(
        evaluateAlerts(
          input({ status: status({ rpc: { healthy: false, detail: "all 2 RPC hosts failing" } }) }),
        ),
      ),
      ["critical:rpc_down"],
    );
  });

  void it("latency: nothing under the sample floor; warn over budget; critical over 2× budget", () => {
    const few = evaluateAlerts(input({ latency: [lat("quote", 5_000, LATENCY_MIN_SAMPLES - 1)] }));
    assert.deepEqual(ids(few), []);
    const warn = evaluateAlerts(input({ latency: [lat("quote", LATENCY_BUDGETS_MS.quote + 1)] }));
    assert.deepEqual(ids(warn), ["warn:latency:quote"]);
    const crit = evaluateAlerts(
      input({ latency: [lat("quote", LATENCY_BUDGETS_MS.quote * 2 + 1)] }),
    );
    assert.deepEqual(ids(crit), ["critical:latency:quote"]);
    const fine = evaluateAlerts(input({ latency: [lat("quote", LATENCY_BUDGETS_MS.quote)] }));
    assert.deepEqual(ids(fine), [], "exactly at budget is within budget");
  });

  void it("trade success rate pages past 10% failures once enough fills were reported", () => {
    const tooFew = evaluateAlerts(input({ counters: { "fill.recorded": 1, "fill.tx_failed": 5 } }));
    assert.deepEqual(ids(tooFew), [], `${String(TRADE_MIN_SAMPLES)} samples needed`);
    const bad = evaluateAlerts(
      input({ counters: { "fill.recorded": 8, "fill.tx_failed": 1, "fill.verify_failed": 1 } }),
    );
    assert.deepEqual(ids(bad), ["critical:trade_success_rate"]);
    assert.match(bad[0]?.title ?? "", /80%/);
    const ok = evaluateAlerts(input({ counters: { "fill.recorded": 19, "fill.wrong_target": 1 } }));
    assert.deepEqual(ids(ok), [], "5% failures is under the 10% threshold");
  });

  void it("A-040: the agent gate's refusal rate warns past 50% once enough executions were gated", () => {
    const tooFew = evaluateAlerts(
      input({ counters: { "agent.funnel.refused.CONFIRMATION_REQUIRED": 5 } }),
    );
    assert.deepEqual(ids(tooFew), [], "10 gated samples needed");
    const bad = evaluateAlerts(
      input({
        counters: {
          "agent.funnel.execute_ok": 3,
          "agent.funnel.refused.CONFIRMATION_REQUIRED": 6,
          "agent.funnel.refused.SIMULATION_DRIFT": 2,
        },
      }),
    );
    assert.deepEqual(ids(bad), ["warn:agent_refusal_rate"]);
    assert.match(bad[0]?.title ?? "", /73%/);
    assert.match(bad[0]?.detail ?? "", /CONFIRMATION_REQUIRED 6/);
    const ok = evaluateAlerts(
      input({
        counters: { "agent.funnel.execute_ok": 8, "agent.funnel.refused.CONFIRMATION_EXPIRED": 4 },
      }),
    );
    assert.deepEqual(ids(ok), [], "33% is under the 50% threshold");
  });

  void it("M-01: a FROZEN market whose game is not final pages after the grace window", () => {
    const young = evaluateAlerts(
      input({
        frozenNotFinal: [
          {
            marketId: `0x${"a".repeat(64)}`,
            providerEventId: "401",
            eventStatus: "in_progress",
            frozenForMs: FROZEN_NOT_FINAL_GRACE_MS - 1,
          },
        ],
      }),
    );
    assert.deepEqual(
      ids(young),
      [],
      "inside the grace window: the same tick may still land the registry write",
    );
    const old = evaluateAlerts(
      input({
        frozenNotFinal: [
          {
            marketId: `0x${"a".repeat(64)}`,
            providerEventId: "401",
            eventStatus: "in_progress",
            frozenForMs: FROZEN_NOT_FINAL_GRACE_MS + 60_000,
          },
        ],
      }),
    );
    assert.deepEqual(ids(old), ["critical:frozen_not_final"]);
    assert.match(old[0]?.detail ?? "", /game 401 is in_progress/);
    assert.match(old[0]?.runbook ?? "", /M-01/);
  });

  void it("stream at capacity warns, and critical alerts sort before warn before info", () => {
    const all = evaluateAlerts(
      input({
        status: status({ killSwitch: true, feedAgeMs: IN_PLAY_FEED_MAX_AGE_MS + 1, liveGames: 1 }),
        stream: { connections: 200, max: 200 },
      }),
    );
    assert.deepEqual(ids(all), [
      "critical:feed_dark:nfl",
      "warn:stream_at_capacity",
      "info:kill_switch",
    ]);
  });
});
