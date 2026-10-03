import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { createPortfolioEconomicsRouter } = await import("./portfolio-economics.ts");
const { computePerformance } = await import("../lib/agent/performance.ts");

/**
 * Phase 9 / PF-002, PF-007, PF-012 — the economics and settled-history routes
 * through the real router with every reader faked at the seam.
 */

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

const WALLET = "0x00000000000000000000000000000000000000aa";
const T = (h: number): Date => new Date(Date.UTC(2026, 8, 12, h));

function perf() {
  return computePerformance(
    WALLET,
    [
      {
        marketId: "0xwin",
        direction: "buy",
        tokensRaw: "16000000",
        usdcRaw: "10000000",
        createdAt: T(1),
      },
      {
        marketId: "0xopen",
        direction: "buy",
        tokensRaw: "5000000",
        usdcRaw: "3000000",
        createdAt: T(2),
      },
    ],
    [
      { marketId: "0xwin", outcomeIndex: 0, state: "RESOLVED", resolvedAt: T(5) },
      { marketId: "0xopen", outcomeIndex: 1, state: "OPEN", resolvedAt: null },
    ],
    [{ marketId: "0xwin", winningOutcomeIndex: 0, method: "auto" }],
  );
}

function serve(): Promise<string> {
  const app = express();
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    req.walletAddress = WALLET;
    next();
  });
  app.use(
    createPortfolioEconomicsRouter({
      performance: () => Promise.resolve(perf()),
      labels: (ids) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              {
                marketId: id,
                label: "Falcons to beat Saints",
                league: "nfl",
                providerEventId: "401",
                state: "RESOLVED",
                resolvedAt: "2026-09-12T05:00:00.000Z",
              },
            ]),
          ),
        ),
      redeemed: () => Promise.resolve(new Set(["0xwin"])),
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

void describe("GET /api/portfolio/economics", () => {
  void it("reports realized market results and an empty LP list", async () => {
    const origin = await serve();
    const res = await fetch(`${origin}/api/portfolio/economics`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      lp: unknown[];
      lpTotals: { positions: number; pnlUsd: number };
      realized: { marketRealizedPnlUsd: number; marketWinRate: number };
    };
    assert.deepEqual(body.lp, []);
    assert.equal(body.lpTotals.positions, 0);
    assert.equal(body.realized.marketRealizedPnlUsd, 6);
    assert.equal(body.realized.marketWinRate, 1);
  });
});

void describe("GET /api/portfolio/settled", () => {
  void it("lists resolved markets with labels, realized P&L and the redeemed flag; open markets are excluded", async () => {
    const origin = await serve();
    const res = await fetch(`${origin}/api/portfolio/settled`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      rows: {
        marketId: string;
        label: string;
        realizedPnlUsd: number;
        redeemed: boolean;
        status: string;
      }[];
      totals: { wins: number; realizedPnlUsd: number };
    };
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0]?.marketId, "0xwin");
    assert.equal(body.rows[0]?.label, "Falcons to beat Saints");
    assert.equal(body.rows[0]?.status, "resolved_win");
    assert.equal(body.rows[0]?.realizedPnlUsd, 6);
    assert.equal(body.rows[0]?.redeemed, true);
    assert.equal(body.totals.wins, 1);
  });
});
