import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const {
  LATENCY_BUDGETS_MS,
  LatencyRecorder,
  createLatencyMiddleware,
  percentile,
  routeBudgetKey,
  Counters,
} = await import("./metrics.ts");

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

/**
 * Phase 7 / R-003 — the budget is enforced at the edge: classified routes
 * are timed, over-budget requests are counted, p95 is nearest-rank over a
 * bounded window.
 */
void describe("percentile (nearest rank)", () => {
  void it("returns the value at the nearest rank, null on empty, max at p100", () => {
    assert.equal(percentile([], 95), null);
    assert.equal(percentile([10], 95), 10);
    const s = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    assert.equal(percentile(s, 50), 500);
    assert.equal(percentile(s, 95), 1000);
    assert.equal(percentile(s, 90), 900);
    assert.equal(percentile(s, 100), 1000);
    assert.equal(percentile([5, 1, 3], 50), 3, "sorts a copy");
  });
});

void describe("routeBudgetKey", () => {
  void it("maps the budgeted routes (trailing slash tolerated) and nothing else", () => {
    assert.equal(routeBudgetKey("POST", "/api/markets/trade/quote"), "quote");
    assert.equal(routeBudgetKey("POST", "/api/markets/trade/calldata/"), "calldata");
    assert.equal(routeBudgetKey("POST", "/api/markets/fills"), "fill");
    assert.equal(routeBudgetKey("GET", "/api/markets/trade/status"), "trade_status");
    assert.equal(routeBudgetKey("GET", "/api/status"), "status");
    assert.equal(routeBudgetKey("GET", "/api/sports/slate"), "slate");
    assert.equal(routeBudgetKey("GET", "/api/markets/positions"), "positions");
    assert.equal(routeBudgetKey("GET", "/api/markets/trade/quote"), null, "wrong method");
    assert.equal(routeBudgetKey("GET", "/api/health"), null);
  });
});

void describe("LatencyRecorder", () => {
  void it("records per key, counts violations and 5xx, computes p50/p95/p99/max, and bounds the window", () => {
    const r = new LatencyRecorder({ ...LATENCY_BUDGETS_MS, quote: 100 }, 4);
    assert.equal(r.record("quote", 50, 200), false);
    assert.equal(r.record("quote", 150, 200), true, "over budget");
    assert.equal(r.record("quote", 90, 502), false);
    assert.equal(r.record("quote", 120, 200), true);
    assert.equal(r.record("quote", 10, 200), false, "5th sample evicts the 1st (window 4)");
    const q = r.snapshot().find((x) => x.key === "quote");
    assert.ok(q);
    assert.equal(q.count, 4);
    assert.equal(q.budgetMs, 100);
    assert.equal(q.violations, 2);
    assert.equal(q.errors, 1);
    assert.equal(q.max, 150);
    assert.equal(q.p95, 150);
    assert.equal(q.p50, 90);
    const untouched = r.snapshot().find((x) => x.key === "status");
    assert.deepEqual(untouched, {
      key: "status",
      budgetMs: LATENCY_BUDGETS_MS.status,
      count: 0,
      p50: null,
      p95: null,
      p99: null,
      max: null,
      violations: 0,
      errors: 0,
    });
  });
});

void describe("latency middleware", () => {
  void it("times classified requests end to end and records the status; unclassified routes are untouched", async () => {
    const r = new LatencyRecorder({ ...LATENCY_BUDGETS_MS, status: 5 });
    let clock = 0;
    const app = express();
    app.use(createLatencyMiddleware(r, undefined, () => clock));
    app.get("/api/status", (_req, res) => {
      clock += 12; // the handler "took" 12 ms
      res.json({ ok: true });
    });
    app.get("/api/health", (_req, res) => {
      clock += 100;
      res.status(500).json({ ok: false });
    });
    const origin = await new Promise<string>((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => {
        servers.push(server);
        const addr = server.address();
        if (addr === null || typeof addr === "string") throw new Error("no port");
        resolve(`http://127.0.0.1:${String(addr.port)}`);
      });
    });
    await fetch(`${origin}/api/status`);
    await fetch(`${origin}/api/health`);
    // `finish` fires after the response is flushed; give the loop a turn.
    await new Promise((res) => setTimeout(res, 20));
    const status = r.snapshot().find((x) => x.key === "status");
    assert.ok(status);
    assert.equal(status.count, 1);
    assert.equal(status.p95, 12);
    assert.equal(status.violations, 1, "12 ms > the 5 ms budget");
    assert.equal(
      r.snapshot().reduce((n, x) => n + x.count, 0),
      1,
      "the unclassified route was not recorded",
    );
  });
});

void describe("Counters", () => {
  void it("increments, reads zero for unknown, and snapshots sorted", () => {
    const c = new Counters();
    c.inc("fill.recorded");
    c.inc("fill.recorded", 2);
    c.inc("fill.tx_failed");
    assert.equal(c.get("fill.recorded"), 3);
    assert.equal(c.get("nope"), 0);
    assert.deepEqual(c.snapshot(), { "fill.recorded": 3, "fill.tx_failed": 1 });
  });
});
