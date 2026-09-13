/**
 * Phase 7 / R-010 — GET /api/ops/metrics and /api/ops/alerts: cron-secret
 * guarded, per-instance scope declared, the alert evaluator composed over
 * the injected seams. Real router on an ephemeral express app.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
process.env.CRON_SECRET = "test-cron-secret";

const { createOpsMetricsRouter } = await import("./ops-metrics.ts");
const { assessPlatformStatus } = await import("../lib/platform-status.ts");
const { LATENCY_BUDGETS_MS } = await import("../lib/metrics.ts");

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

const NOW = 1_800_000_000_000;

function serve(): Promise<string> {
  const app = express();
  app.use(
    createOpsMetricsRouter({
      readStatus: () =>
        Promise.resolve(
          assessPlatformStatus(
            {
              feeds: [{ league: "nfl", dataAsOf: NOW - 1_000, liveGames: 1 }],
              killSwitch: false,
              providerBreakers: {},
              rpc: { healthy: true },
            },
            NOW,
          ),
        ),
      readFrozenNotFinal: () =>
        Promise.resolve([
          {
            marketId: `0x${"b".repeat(64)}`,
            providerEventId: "402",
            eventStatus: "in_progress",
            frozenForMs: 20 * 60_000,
          },
        ]),
      latencySnapshot: () => [
        {
          key: "quote",
          budgetMs: LATENCY_BUDGETS_MS.quote,
          count: 50,
          p50: 300,
          p95: 2_000,
          p99: 2_500,
          max: 3_000,
          violations: 30,
          errors: 0,
        },
      ],
      counterSnapshot: () => ({ "fill.recorded": 12, "fill.tx_failed": 0 }),
      streamConnections: () => 3,
      now: () => NOW,
    }),
  );
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

const auth = { headers: { authorization: "Bearer test-cron-secret" } };

void describe("GET /api/ops/metrics + /api/ops/alerts (R-010)", () => {
  void it("refuses without the cron secret", async () => {
    const origin = await serve();
    const res = await fetch(`${origin}/api/ops/metrics`);
    assert.equal(res.status, 401);
    const res2 = await fetch(`${origin}/api/ops/alerts`, {
      headers: { authorization: "Bearer nope" },
    });
    assert.equal(res2.status, 401);
  });

  void it("returns budgets, latency, counters, stream, status, the M-01 rows, and the evaluated alerts", async () => {
    const origin = await serve();
    const res = await fetch(`${origin}/api/ops/metrics`, auth);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as {
      generatedAt: number;
      scope: string;
      budgets: Record<string, number>;
      latency: { key: string; p95: number | null }[];
      counters: Record<string, number>;
      stream: { connections: number; max: number };
      status: { mode: string };
      frozenNotFinal: unknown[];
      alerts: { id: string; severity: string }[];
    };
    assert.equal(body.generatedAt, NOW);
    assert.match(body.scope, /per-instance/);
    assert.equal(body.budgets["quote"], LATENCY_BUDGETS_MS.quote);
    assert.equal(body.budgets["confirmation_client"], 8_000);
    assert.equal(body.latency[0]?.p95, 2_000);
    assert.equal(body.counters["fill.recorded"], 12);
    assert.deepEqual(body.stream, { connections: 3, max: 200 });
    assert.equal(body.status.mode, "live");
    assert.equal(body.frozenNotFinal.length, 1);
    assert.deepEqual(
      body.alerts.map((a) => `${a.severity}:${a.id}`),
      ["critical:latency:quote", "critical:frozen_not_final"],
      "quote p95 2000 > 2×800 and the M-01 row past its grace window",
    );
  });

  void it("/api/ops/alerts is the same evaluation, alerts only", async () => {
    const origin = await serve();
    const res = await fetch(`${origin}/api/ops/alerts`, auth);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { count: number; alerts: { id: string }[] };
    assert.equal(body.count, 2);
    assert.deepEqual(
      body.alerts.map((a) => a.id),
      ["latency:quote", "frozen_not_final"],
    );
  });
});
