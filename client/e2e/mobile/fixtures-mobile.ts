import type { Page } from "@playwright/test";
import { CHIEFS_GAME, CHIEFS_LIVE } from "../fixtures.ts";
import { mockApi, type MockOptions } from "../harness.ts";

/**
 * Task 071 — the mobile suite's extra fixtures: a held position in the
 * Chiefs game (the row `GET /api/markets/positions` returns for the shimmed
 * wallet), and the push config.
 */
export const CHIEFS_MARKET_ID = `0x${"5a".repeat(32)}`;

/** 200 YES contracts on the Raiders' market = long Kansas City (away, side 1). */
export function chiefsPosition(live = false) {
  const game = live ? CHIEFS_LIVE : CHIEFS_GAME;
  return {
    marketId: CHIEFS_MARKET_ID,
    outcomeIndex: 1,
    label: "Kansas City Chiefs to beat Las Vegas Raiders",
    state: "OPEN",
    startsAt: game.startsAt,
    side: "yes",
    balance: "200000000",
    impliedProbBps: 10_000 - game.homeWinProbabilityBps,
    valueRaw: "100000000",
    league: "nfl",
    providerEventId: game.providerEventId,
    entryPriceBps: 4500,
    pnlRaw: "10000000",
    potentialPayoutRaw: "200000000",
  };
}

export interface MobileMockOptions extends MockOptions {
  /** The shimmed wallet holds the Chiefs position. */
  position?: boolean;
  /** The deployment has push configured. */
  push?: boolean;
}

export async function mockMobileApi(page: Page, opts: MobileMockOptions = {}) {
  const base = await mockApi(page, opts);
  if (opts.position) {
    await page.route("**/api/markets/positions**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ positions: [chiefsPosition(Boolean(opts.liveGame))] }),
      }),
    );
  }
  // The desktop harness answers every `/api/portfolio*` path with the balance
  // read; the phone profile also reads these three, in their own shapes.
  await page.route("**/api/portfolio/economics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ lp: [], totals: { currentValueUsd: 0, accruedFeesUsd: 0 } }),
    }),
  );
  await page.route("**/api/portfolio/settled", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [],
        totals: { wins: 0, losses: 0, voided: 0, realizedPnlUsd: 0, winRate: null },
      }),
    }),
  );
  await page.route("**/api/portfolio/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ series: [], delta: 0, pct: 0 }),
    }),
  );
  await page.route("**/api/push/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: Boolean(opts.push),
        publicKey: opts.push ? "B".repeat(87) : null,
        topics: ["trades", "positions", "games", "agent", "settlement"],
      }),
    }),
  );
  return base;
}

/** The centre of an element must be reachable by a thumb: the bottom 60% of the viewport. */
export function inThumbZone(box: { y: number; height: number }, viewportHeight: number): boolean {
  return box.y + box.height / 2 >= viewportHeight * 0.4;
}
