/**
 * Task 067 (G-001) — the API as the browser suite sees it: fixtures in the
 * shipped wire shapes (`PublicSlate`, `DiscoverRead`, `PlatformStatus`,
 * `TradeQuote` / `TradeCalldata`). `harness.ts` installs them on a page.
 */
const NOW = Math.floor(Date.now() / 1000);
export const TERMS_VERSION = "2026-09-13";

const KC = { key: "nfl:KC", name: "Kansas City Chiefs", abbreviation: "KC" };
const LV = { key: "nfl:LV", name: "Las Vegas Raiders", abbreviation: "LV" };
const BUF = { key: "nfl:BUF", name: "Buffalo Bills", abbreviation: "BUF" };
const NYJ = { key: "nfl:NYJ", name: "New York Jets", abbreviation: "NYJ" };

export const CHIEFS_GAME = {
  providerEventId: "401547401",
  startsAt: NOW + 3 * 3600,
  status: "scheduled",
  home: LV,
  away: KC,
  homeWinProbabilityBps: 5000,
  liveOdds: true,
};
const QUIET_GAME = {
  providerEventId: "401547402",
  startsAt: NOW + 30 * 3600,
  status: "scheduled",
  home: BUF,
  away: NYJ,
  homeWinProbabilityBps: 6000,
};

/** The Chiefs game an hour into play, when a spec asks for a live board. */
export const CHIEFS_LIVE = {
  ...CHIEFS_GAME,
  startsAt: NOW - 3600,
  status: "in_progress",
  homeScore: 10,
  awayScore: 14,
};

/** In-game price ticks for the live variant (home side first, mirrored). */
export function livePrices() {
  const home = [
    { t: NOW - 3600, priceBps: 5200 },
    { t: NOW - 1800, priceBps: 4800 },
    { t: NOW - 600, priceBps: 5000 },
  ];
  return home.flatMap((p) => [
    { ...p, outcomeIndex: 0 },
    { t: p.t, outcomeIndex: 1, priceBps: 10_000 - p.priceBps },
  ]);
}

export function slate(live = false) {
  return {
    leagues: {
      nfl: {
        league: "nfl",
        provider: "canonical",
        delayed: false,
        fetchedAt: Date.now(),
        events: [live ? CHIEFS_LIVE : CHIEFS_GAME, QUIET_GAME],
      },
      wnba: {
        league: "wnba",
        provider: "canonical",
        delayed: false,
        fetchedAt: Date.now(),
        events: [],
      },
    },
  };
}

export function discover() {
  return {
    markets: [
      {
        ...CHIEFS_GAME,
        league: "nfl",
        tradeable: true,
        liquidityUsdc: 6200,
        volume24hUsdc: 900,
        fills24h: 12,
      },
      {
        ...QUIET_GAME,
        league: "nfl",
        tradeable: false,
        liquidityUsdc: 0,
        volume24hUsdc: 0,
        fills24h: 0,
      },
    ],
    fetchedAt: Date.now(),
    delayed: false,
    unavailable: [],
  };
}

export function status(paused = false) {
  return {
    generatedAt: Date.now(),
    mode: paused ? "paused" : "live",
    reads: "live",
    trading: paused ? "paused" : "open",
    killSwitch: paused,
    feeds: {
      nfl: { dataAsOf: Date.now(), ageMs: 1000, delayed: false, liveGames: 0, buysHalted: false },
    },
    openBreakers: [],
    rpc: { healthy: true },
    message: paused ? "Trading is paused for maintenance." : null,
  };
}

/** The USDC balance the portfolio read reports: $250. */
export function portfolio() {
  return {
    address: "0x00000000000000000000000000000000000000aa",
    balances: [
      {
        symbol: "USDC",
        address: "0x00000000000000000000000000000000000000cc",
        decimals: 6,
        balanceRaw: "250000000",
        usdValue: 250,
      },
    ],
    transactions: [],
  };
}
