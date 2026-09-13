/**
 * Phase 12 — the three public reads behind the market page's deeper layer:
 * validation, the 404 for an unknown game, the status mapping for the
 * analyst, and the history query bounds. Data comes from injected fakes.
 */
import assert from "node:assert/strict";
import express from "express";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { createMarketAnalysisRouter } from "./market-analysis.ts";
import { createMarketDepthRouter } from "./market-depth.ts";
import { createMarketHistoryRouter } from "./market-history.ts";
import type { MarketDepthRead } from "../lib/sports/market-depth-read.ts";
import type { HistoryRow } from "../lib/sports/market-history.ts";

const READ: MarketDepthRead = {
  hasMarkets: true,
  game: {
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    period: null,
    clock: null,
    possession: null,
    lastPlay: null,
    asOf: null,
  },
  metrics: null,
  depth: null,
  annotations: [],
  computedAt: 1,
};
const ROW: HistoryRow = {
  league: "nfl",
  providerEventId: "1",
  home: { key: "nfl:LV", name: "Raiders", abbreviation: "LV" },
  away: { key: "nfl:KC", name: "Chiefs", abbreviation: "KC" },
  startsAt: 1,
  homeScore: 17,
  awayScore: 24,
  state: "RESOLVED",
  resolvedAt: 2,
  outcome: { winningOutcomeIndex: 1, method: "auto", label: "Chiefs won" },
  settlementPriceBps: 0,
  path: [],
};

let server: Server;
let origin = "";
const historyCalls: [string | null, number][] = [];

before(async () => {
  const app = express();
  app.use(
    createMarketDepthRouter({ read: (id) => Promise.resolve(id === "401547401" ? READ : null) }),
  );
  app.use(
    createMarketAnalysisRouter({
      analyze: (id, side) =>
        Promise.resolve(
          id === "401547401"
            ? {
                status: "ok",
                side: side === 1 ? "away" : "home",
                analysis: { probabilityBps: 5600 },
              }
            : id === "1"
              ? { status: "not_found", note: "no" }
              : { status: "unavailable", reason: "ingest" },
        ),
    }),
  );
  app.use(
    createMarketHistoryRouter({
      read: (league, limit) => {
        historyCalls.push([league, limit]);
        return Promise.resolve([ROW]);
      },
    }),
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      origin = typeof addr === "object" && addr ? `http://127.0.0.1:${String(addr.port)}` : "";
      resolve();
    });
  });
});

after(() => {
  server.close();
});

void describe("GET /api/markets/depth", () => {
  void it("validates the id, 404s an unknown game, and serves the read with a short cache", async () => {
    assert.equal((await fetch(`${origin}/api/markets/depth?providerEventId=abc`)).status, 400);
    assert.equal((await fetch(`${origin}/api/markets/depth?providerEventId=9`)).status, 404);
    const res = await fetch(`${origin}/api/markets/depth?providerEventId=401547401`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /max-age=15/);
    assert.deepEqual(await res.json(), READ);
  });
});

void describe("GET /api/markets/analysis", () => {
  void it("maps the analyst's status to HTTP and defaults to the home side", async () => {
    const ok = await fetch(`${origin}/api/markets/analysis?providerEventId=401547401`);
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { side: string }).side, "home");
    const away = await fetch(
      `${origin}/api/markets/analysis?providerEventId=401547401&outcomeIndex=1`,
    );
    assert.equal(((await away.json()) as { side: string }).side, "away");
    assert.equal((await fetch(`${origin}/api/markets/analysis?providerEventId=1`)).status, 404);
    assert.equal((await fetch(`${origin}/api/markets/analysis?providerEventId=2`)).status, 503);
    assert.equal(
      (await fetch(`${origin}/api/markets/analysis?providerEventId=x&outcomeIndex=2`)).status,
      400,
    );
  });
});

void describe("GET /api/markets/history", () => {
  void it("bounds the limit, passes the league through, and returns rows", async () => {
    const res = await fetch(`${origin}/api/markets/history?league=nfl&limit=5`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { rows: HistoryRow[]; fetchedAt: number };
    assert.deepEqual(body.rows, [ROW]);
    assert.deepEqual(historyCalls.at(-1), ["nfl", 5]);
    await fetch(`${origin}/api/markets/history`);
    assert.deepEqual(historyCalls.at(-1), [null, 30]);
    assert.equal((await fetch(`${origin}/api/markets/history?limit=500`)).status, 400);
    assert.equal((await fetch(`${origin}/api/markets/history?league=NFL!`)).status, 400);
  });
});
