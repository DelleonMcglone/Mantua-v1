import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyDiscoverFilters, type DiscoverFilters, type DiscoverMarket } from "./discovery.ts";
import { describeDiscoverFilters, parseDiscoverQuery } from "./discovery-query.ts";

const NOW = 1_800_000_000; // unix seconds
const H = 3600;

function market(over: Partial<DiscoverMarket>): DiscoverMarket {
  return {
    league: "nfl",
    providerEventId: "1",
    startsAt: NOW + 2 * H,
    status: "scheduled",
    home: { key: "nfl:KC", name: "Kansas City Chiefs", abbreviation: "KC" },
    away: { key: "nfl:LV", name: "Las Vegas Raiders", abbreviation: "LV" },
    homeWinProbabilityBps: 6000,
    liveOdds: true,
    tradeable: true,
    liquidityUsdc: 1000,
    volume24hUsdc: 500,
    fills24h: 5,
    ...over,
  };
}

const MARKETS: DiscoverMarket[] = [
  market({ providerEventId: "live", status: "in_progress", startsAt: NOW - H, liquidityUsdc: 800 }),
  market({ providerEventId: "soon", startsAt: NOW + 2 * H, liquidityUsdc: 5000, fills24h: 40 }),
  market({
    providerEventId: "tomorrow",
    startsAt: NOW + 30 * H,
    liquidityUsdc: 50,
    volume24hUsdc: 0,
    fills24h: 0,
    home: { key: "nfl:BUF", name: "Buffalo Bills", abbreviation: "BUF" },
    away: { key: "nfl:NYJ", name: "New York Jets", abbreviation: "NYJ" },
  }),
  market({ providerEventId: "done", status: "final", startsAt: NOW - 5 * H, tradeable: false }),
  market({
    providerEventId: "wnba",
    league: "wnba",
    startsAt: NOW + H,
    home: { key: "wnba:LVA", name: "Las Vegas Aces", abbreviation: "LVA" },
    away: { key: "wnba:NYL", name: "New York Liberty", abbreviation: "NYL" },
    liveOdds: false,
    tradeable: false,
  }),
];

const idsOf = (rows: DiscoverMarket[]) => rows.map((m) => m.providerEventId);

test("default filters keep everything open, live first, then soonest (T-018)", () => {
  const rows = applyDiscoverFilters(MARKETS, {}, NOW);
  assert.deepEqual(idsOf(rows), ["live", "wnba", "soon", "tomorrow", "done"]);
});

test("status filters: open / live / upcoming / final", () => {
  assert.deepEqual(idsOf(applyDiscoverFilters(MARKETS, { status: "open" }, NOW)), [
    "live",
    "soon",
    "tomorrow",
  ]);
  assert.deepEqual(idsOf(applyDiscoverFilters(MARKETS, { status: "live" }, NOW)), ["live"]);
  assert.deepEqual(idsOf(applyDiscoverFilters(MARKETS, { status: "upcoming" }, NOW)), [
    "wnba",
    "soon",
    "tomorrow",
  ]);
  assert.deepEqual(idsOf(applyDiscoverFilters(MARKETS, { status: "final" }, NOW)), ["done"]);
});

test("league, team and game filters never need an id", () => {
  assert.deepEqual(idsOf(applyDiscoverFilters(MARKETS, { league: "wnba" }, NOW)), ["wnba"]);
  assert.deepEqual(idsOf(applyDiscoverFilters(MARKETS, { team: "jets" }, NOW)), ["tomorrow"]);
  assert.deepEqual(idsOf(applyDiscoverFilters(MARKETS, { team: "las vegas" }, NOW)), [
    "live",
    "wnba",
    "soon",
    "done",
  ]);
  assert.deepEqual(idsOf(applyDiscoverFilters(MARKETS, { game: "bills jets" }, NOW)), ["tomorrow"]);
});

test("start-time windows: now (live), today, week", () => {
  assert.deepEqual(idsOf(applyDiscoverFilters(MARKETS, { startsWithin: "now" }, NOW)), ["live"]);
  const today = idsOf(applyDiscoverFilters(MARKETS, { startsWithin: "today" }, NOW));
  assert.ok(today.includes("soon") && !today.includes("tomorrow"));
  assert.ok(
    idsOf(applyDiscoverFilters(MARKETS, { startsWithin: "week" }, NOW)).includes("tomorrow"),
  );
});

test("liquidity and popularity sorts and the liquidity floor", () => {
  assert.deepEqual(
    idsOf(applyDiscoverFilters(MARKETS, { sort: "liquidity", status: "open" }, NOW)),
    ["soon", "live", "tomorrow"],
  );
  assert.deepEqual(
    idsOf(applyDiscoverFilters(MARKETS, { sort: "popularity", status: "open" }, NOW)).slice(0, 1),
    ["soon"],
  );
  assert.deepEqual(idsOf(applyDiscoverFilters(MARKETS, { minLiquidityUsdc: 100 }, NOW)), [
    "live",
    "wnba",
    "soon",
    "done",
  ]);
});

test("the owner's three discovery phrases parse to filters (T-019)", () => {
  assert.deepEqual(parseDiscoverQuery("Show me today's NFL markets"), {
    league: "nfl",
    startsWithin: "today",
  } satisfies DiscoverFilters);
  assert.deepEqual(parseDiscoverQuery("Find the most liquid NFL markets"), {
    league: "nfl",
    sort: "liquidity",
  } satisfies DiscoverFilters);
  assert.deepEqual(parseDiscoverQuery("What can I trade right now?"), {
    status: "open",
    startsWithin: "now",
  } satisfies DiscoverFilters);
});

test("more discovery phrasings: popular, live, this week, a team", () => {
  assert.deepEqual(parseDiscoverQuery("most popular WNBA games this week"), {
    league: "wnba",
    sort: "popularity",
    startsWithin: "week",
  });
  assert.deepEqual(parseDiscoverQuery("live markets"), { status: "live", startsWithin: "now" });
  assert.deepEqual(parseDiscoverQuery("find Chiefs markets"), { team: "chiefs" });
});

test("filters describe themselves for the page title", () => {
  assert.equal(describeDiscoverFilters({}), "All markets");
  assert.equal(describeDiscoverFilters({ league: "nfl", startsWithin: "today" }), "NFL · today");
  assert.equal(describeDiscoverFilters({ sort: "liquidity", league: "nfl" }), "NFL · most liquid");
  assert.equal(
    describeDiscoverFilters({ status: "open", startsWithin: "now" }),
    "Open now · tradeable now",
  );
});
