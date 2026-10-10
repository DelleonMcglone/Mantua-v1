/**
 * Task 067 (G-001) — the API as the browser suite sees it: fixtures in the
 * shipped wire shapes (`PublicSlate`, `DiscoverRead`, `PlatformStatus`,
 * `TradeQuote` / `TradeCalldata`). `harness.ts` installs them on a page.
 */
const NOW_MS = Date.now();
const NOW = Math.floor(NOW_MS / 1000);
export const TERMS_VERSION = "2026-10-02";

/**
 * The viewer's LOCAL calendar day, in epoch seconds. The home board, the
 * league page's "This week" and Discover's "Today" all filter on the local
 * day (`local-window.ts`), so a fixture kickoff has to stay inside it
 * whatever the clock says when the suite runs: a bare `NOW + 3h` built after
 * 21:00 UTC lands on the next day — and on a Saturday in the next week —
 * and the Chiefs game vanishes from every window the specs tap into.
 */
function localDayBounds(): { start: number; end: number } {
  const start = new Date(NOW_MS);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
}
const DAY = localDayBounds();

/**
 * `NOW + offsetSeconds`, pulled back inside today's local day (a minute off
 * each edge). Within a minute of local midnight the clamp can put a
 * "scheduled" kickoff a few seconds in the past; that is the one-minute
 * residue of a window that used to be three hours.
 */
function todayAt(offsetSeconds: number): number {
  return Math.min(Math.max(NOW + offsetSeconds, DAY.start + 60), DAY.end - 60);
}

const KC = { key: "nfl:KC", name: "Kansas City Chiefs", abbreviation: "KC" };
const LV = { key: "nfl:LV", name: "Las Vegas Raiders", abbreviation: "LV" };
const BUF = { key: "nfl:BUF", name: "Buffalo Bills", abbreviation: "BUF" };
const NYJ = { key: "nfl:NYJ", name: "New York Jets", abbreviation: "NYJ" };

export const CHIEFS_GAME = {
  providerEventId: "401547401",
  startsAt: todayAt(3 * 3600),
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
  startsAt: todayAt(-3600),
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
