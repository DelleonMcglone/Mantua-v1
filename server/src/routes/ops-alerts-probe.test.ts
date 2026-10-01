/**
 * R-010 — GET /api/ops/alerts/probe: the unauthenticated pager probe an
 * uptime monitor polls. 200 with no critical alert, 503 with one; only ids
 * and counts in the body.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import type { FrozenNotFinalRow } from "../lib/alerts.ts";

process.env["NODE_ENV"] ??= "test";
process.env["CRON_SECRET"] ??= "test-cron-secret";

const { createOpsMetricsRouter } = await import("./ops-metrics.ts");
const { assessPlatformStatus } = await import("../lib/platform-status.ts");

const NOW = 1_800_000_000_000;
const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function serve(frozen: readonly FrozenNotFinalRow[]): Promise<string> {
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
      readFrozenNotFinal: () => Promise.resolve(frozen),
      latencySnapshot: () => [],
      counterSnapshot: () => ({}),
      streamConnections: () => 0,
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

void describe("GET /api/ops/alerts/probe (R-010 pager probe)", () => {
  void it("answers 200 ok with no auth when nothing critical is open", async () => {
    const base = await serve([]);
    const res = await fetch(`${base}/api/ops/alerts/probe`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as { ok: boolean; critical: string[]; warn: number };
    assert.equal(body.ok, true);
    assert.deepEqual(body.critical, []);
  });

  void it("answers 503 naming the alert id — and nothing else — on a frozen-but-not-final market", async () => {
    const base = await serve([
      {
        marketId: `0x${"b".repeat(64)}`,
        providerEventId: "402",
        eventStatus: "in_progress",
        frozenForMs: 20 * 60_000,
      },
    ]);
    const res = await fetch(`${base}/api/ops/alerts/probe`);
    assert.equal(res.status, 503);
    const text = await res.text();
    const body = JSON.parse(text) as { ok: boolean; critical: string[] };
    assert.equal(body.ok, false);
    assert.ok(body.critical.includes("frozen_not_final"), text);
    assert.ok(!text.includes("b".repeat(64)), "market id must not leak through the probe");
    assert.ok(!text.includes("402"), "provider event id must not leak through the probe");
  });
});
