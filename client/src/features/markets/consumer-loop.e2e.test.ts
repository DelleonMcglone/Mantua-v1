import { strict as assert } from "node:assert";
import { test } from "node:test";
import { detectIntent } from "../../lib/chat-intent.ts";
import { applyDiscoverFilters, type DiscoverMarket } from "./discovery.ts";
import { freshness } from "./freshness.ts";
import { groupClaims, totalClaimableUsd } from "./market-redeem-core.ts";
import { feeExceedsCeiling, feeLines } from "./fee-lines.ts";
import {
  closePositionDetail,
  feeSummary,
  isTradableStatus,
  type FeeQuoteWire,
} from "./market-trade-core.ts";
import { probabilitySource } from "./probability-source.ts";
import { resolveTeamSelection } from "./team-select.ts";
import { describeTradeError } from "./trade-errors.ts";
import {
  TAP_BUDGET,
  countTaps,
  initialTicket,
  needsFunding,
  tapTicket,
  ticketReadiness,
  type TicketTap,
} from "./trade-ticket-core.ts";

/**
 * T-014 — Discover → Analyze → Trade → Monitor → Exit/Settle, one continuous
 * journey where each stage's output is the next stage's input, composed
 * from the shipped pure modules against the server's real wire shapes
 * (`DiscoverMarketWire`, `BuiltMarketTrade.fee`, the trade route's error
 * codes, the redeemable rows). The on-chain leg on a real market waits on
 * the D-112 deploy; nothing here is faked to stand in for it.
 */
const NOW = 1_800_000_000;

const CHIEFS_AT_RAIDERS: DiscoverMarket = {
  league: "nfl",
  providerEventId: "401547401",
  startsAt: NOW + 3600,
  status: "scheduled",
  home: { key: "nfl:LV", name: "Las Vegas Raiders", abbreviation: "LV" },
  away: { key: "nfl:KC", name: "Kansas City Chiefs", abbreviation: "KC" },
  homeWinProbabilityBps: 5000,
  liveOdds: true,
  tradeable: true,
  liquidityUsdc: 6200,
  volume24hUsdc: 900,
  fills24h: 12,
};
const QUIET: DiscoverMarket = {
  ...CHIEFS_AT_RAIDERS,
  providerEventId: "401547402",
  home: { key: "nfl:BUF", name: "Buffalo Bills", abbreviation: "BUF" },
  away: { key: "nfl:NYJ", name: "New York Jets", abbreviation: "NYJ" },
  liveOdds: false,
  tradeable: false,
  liquidityUsdc: 0,
  fills24h: 0,
};

/** The hook's quote for a $100 buy at 50/50 in the playoffs at the ceiling. */
const HOOK_FEE: FeeQuoteWire = {
  feePips: 3500,
  ratePips: 7000,
  probabilityBps: 5000,
  playoffs: true,
  feeRaw: "350000",
  feeUsdcRaw: "350000",
};

test("the full consumer loop composes end to end (T-014)", () => {
  // ── Discover: the owner's phrase → filters → the one tradeable market.
  const discover = detectIntent("What can I trade right now?");
  assert.equal(discover?.kind, "discover");
  const upcoming = applyDiscoverFilters(
    [QUIET, CHIEFS_AT_RAIDERS],
    { ...discover.filters, startsWithin: "today" },
    NOW,
  );
  assert.deepEqual(
    upcoming.map((m) => m.providerEventId),
    ["401547401"],
    "only the market with a live pool is tradeable",
  );
  const market = upcoming[0];
  assert.equal(probabilitySource(market).kind, "market", "its price is the market's own (T-021)");
  assert.equal(freshness({ fetchedAt: NOW * 1000 - 20_000 }, NOW * 1000).label, "Updated just now");

  // ── Analyze: a matchup question re-detects as analysis.
  const analyze = detectIntent(
    `Analyze the ${market.away.name} at ${market.home.name} matchup and what a prediction-market trader should watch`,
  );
  assert.equal(analyze?.kind, "analyze");

  // ── Trade: "bet on the Chiefs" lands on the Chiefs' side, then three taps.
  const position = detectIntent("bet on the Chiefs");
  assert.equal(position?.kind, "position");
  const selection = resolveTeamSelection([market], position.team ?? "");
  assert.deepEqual(selection, { eventId: "401547401", outcomeIndex: 1 });
  assert.ok(isTradableStatus(market.status));

  const buyTaps: TicketTap[] = [
    { kind: "pick", side: 1 },
    { kind: "preset", amount: 100 },
    { kind: "confirm" },
  ];
  let ticket = initialTicket();
  for (const t of buyTaps) ticket = tapTicket(ticket, t);
  assert.equal(ticket.step, "executing");
  assert.ok(countTaps(buyTaps) <= TAP_BUDGET);

  // The review block renders the hook's exact numbers (T-008).
  assert.equal(feeExceedsCeiling(HOOK_FEE), false);
  const summary = feeSummary(100_000_000n, HOOK_FEE);
  assert.deepEqual(
    feeLines(summary, "buy").map((l) => l.value),
    ["$99.65", "$0.35", "0.35%", "$100.00"],
  );
  assert.equal(needsFunding("buy", "100000000", "250000000"), false);
  assert.equal(ticketReadiness({ authenticated: true, quoted: true, funding: false }), "ready");
  ticket = tapTicket(ticket, { kind: "executed" });
  assert.equal(ticket.step, "executed", "an explicit executed state (T-006)");

  // A halted feed is copy, not a stack trace (T-012).
  const halted = describeTradeError({ status: 503, code: "TRADING_HALTED" });
  assert.equal(halted.kind, "halted");

  // ── Monitor → Exit: the position row's Close is tap one, Confirm tap two.
  const row = {
    side: "yes",
    state: "OPEN",
    league: "nfl",
    providerEventId: "401547401",
    balance: "199300000",
  };
  const close = closePositionDetail(row);
  assert.ok(close);
  const exitTaps: TicketTap[] = [
    { kind: "close", side: 1, balanceRaw: close.balance },
    { kind: "confirm" },
  ];
  let exit = initialTicket();
  for (const t of exitTaps) exit = tapTicket(exit, t);
  assert.equal(exit.step, "executing");
  assert.equal(exit.direction, "sell");
  assert.equal(exit.amount, "199.3");
  assert.ok(countTaps(exitTaps) <= TAP_BUDGET);

  // ── Settle: a resolved market's claim groups to one payout.
  const claims = groupClaims([
    {
      marketId: "m",
      label: "Chiefs to beat Raiders",
      league: "nfl",
      providerEventId: "401547401",
      state: "RESOLVED",
      side: "yes",
      tokenAddress: "t",
      balanceRaw: "199300000",
      payoutRaw: "199300000",
    },
  ]);
  assert.equal(claims.length, 1);
  assert.equal(totalClaimableUsd(claims), 199.3);
});
