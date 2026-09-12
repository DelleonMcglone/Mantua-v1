import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  SimulationArgs,
  SimulationDeps,
  TradeSimulation,
  WalletPolicyRead,
  UserPolicyRead,
} from "./trade-simulation.ts";
import type { MarketTradeQuote } from "../sports/market-trade-build.ts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { MATERIAL_PRICE_MOVE_BPS, SIMULATION_TTL_MS, materialDrift, simulateMarketTrade } =
  await import("./trade-simulation.ts");
const { MarketClosedError } = await import("../sports/market-trade-build.ts");

/**
 * Phase 8 / A-025, A-030 — the simulation's verdict and the drift rule,
 * over injected readers (no chain, no db).
 */

const MARKET = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

function FEE(playoffs: boolean): MarketTradeQuote["fee"] {
  return {
    feePips: 0,
    ratePips: 0,
    probabilityBps: 5000,
    playoffs,
    stale: false,
    feeRaw: "0",
    feeUsdcRaw: "0",
    breakdown: {
      minRate: 0,
      liquidityPremium: 0,
      volatilityPremium: 0,
      activityPremium: 0,
      uncertaintyPremium: 0,
      rate: 0,
      probabilityBps: 5000,
      playoffs,
      stale: false,
    },
  };
}

function quoteOf(
  over: { amountOut?: string; effectivePriceBps?: number; playoffs?: boolean } = {},
): MarketTradeQuote {
  return {
    marketId: MARKET,
    marketAddress: "0x3333333333333333333333333333333333333333",
    yesToken: "0x3333333333333333333333333333333333333333",
    quote: {
      amountIn: "10000000",
      amountOut: over.amountOut ?? "16000000",
      amountOutMinimum: "15840000",
      effectivePriceBps: over.effectivePriceBps ?? 6250,
    },
    fee: FEE(over.playoffs ?? false),
  };
}

const ARGS: SimulationArgs = {
  providerEventId: "401",
  outcomeIndex: 0,
  direction: "buy",
  amountRaw: 10_000_000n,
};

function deps(over: {
  quote?: SimulationDeps["quote"];
  wallet?: Partial<WalletPolicyRead>;
  policy?: UserPolicyRead | null;
  league?: string | null;
  impliedBps?: number | null;
}): SimulationDeps {
  return {
    quote: over.quote ?? (() => Promise.resolve(quoteOf())),
    wallet: () =>
      Promise.resolve({
        usdcBalanceRaw: 50_000_000n,
        yesBalanceRaw: 0n,
        dailyCapUsd: 100,
        spentTodayUsd: 0,
        ...over.wallet,
      }),
    policy: () => Promise.resolve(over.policy === undefined ? null : over.policy),
    league: () => Promise.resolve(over.league === undefined ? "nfl" : over.league),
    marketImpliedBps: () => Promise.resolve(over.impliedBps === undefined ? 6000 : over.impliedBps),
    now: () => 1_000_000,
    id: () => "sim-1",
  };
}

void describe("simulateMarketTrade", () => {
  void it("is executable with the full estimate, fees, position and policy results", async () => {
    const sim = await simulateMarketTrade(deps({}), ARGS, 8453);
    assert.equal(sim.executable, true);
    assert.deepEqual(sim.blockers, []);
    assert.equal(sim.expiresAt, 1_000_000 + SIMULATION_TTL_MS);
    assert.equal(sim.market.tradability, "open");
    assert.equal(sim.market.marketId, MARKET);
    assert.equal(sim.market.league, "nfl");
    assert.ok(sim.estimate);
    assert.equal(sim.estimate.amountOut, "16000000");
    // 62.50% effective vs 60.00% implied → 250 bps of impact on a buy.
    assert.equal(sim.estimate.priceImpactBps, 250);
    assert.equal(sim.position.beforeRaw, "0");
    assert.equal(sim.position.afterRaw, "16000000");
    assert.equal(sim.position.exposureUsd, 10);
    assert.equal(sim.walletPolicy.ok, true);
    assert.equal(sim.walletPolicy.remainingTodayUsd, 100);
    assert.equal(sim.marketPolicy.ok, true);
    assert.equal(sim.marketPolicy.leagueAllowed, true);
  });

  void it("reports a closed market as a blocker, keeping the wallet numbers", async () => {
    const sim = await simulateMarketTrade(
      deps({ quote: () => Promise.reject(new MarketClosedError("Market closed: game is final")) }),
      ARGS,
      8453,
    );
    assert.equal(sim.executable, false);
    assert.equal(sim.market.tradability, "closed");
    assert.equal(sim.estimate, null);
    assert.match(sim.blockers[0] ?? "", /closed/);
    assert.equal(sim.walletPolicy.usdcBalance, 50);
  });

  void it("blocks on balance, then on the daily cap", async () => {
    const poor = await simulateMarketTrade(
      deps({ wallet: { usdcBalanceRaw: 5_000_000n } }),
      ARGS,
      8453,
    );
    assert.equal(poor.executable, false);
    assert.match(poor.walletPolicy.reason ?? "", /Insufficient agent balance/);

    const capped = await simulateMarketTrade(
      deps({ wallet: { dailyCapUsd: 25, spentTodayUsd: 20 } }),
      ARGS,
      8453,
    );
    assert.equal(capped.executable, false);
    assert.match(capped.walletPolicy.reason ?? "", /Daily cap/);
    assert.equal(capped.walletPolicy.remainingTodayUsd, 5);
  });

  void it("applies the user's policy: paused, per-trade limit, league allowlist", async () => {
    const paused = await simulateMarketTrade(
      deps({ policy: { status: "paused", maxStakePerTradeUsd: 25, allowedLeagues: [] } }),
      ARGS,
      8453,
    );
    assert.match(paused.marketPolicy.reason ?? "", /paused/);

    const limit = await simulateMarketTrade(
      deps({ policy: { status: "active", maxStakePerTradeUsd: 5, allowedLeagues: [] } }),
      ARGS,
      8453,
    );
    assert.match(limit.marketPolicy.reason ?? "", /Per-trade limit/);

    const league = await simulateMarketTrade(
      deps({ policy: { status: "active", maxStakePerTradeUsd: 25, allowedLeagues: ["nba"] } }),
      ARGS,
      8453,
    );
    assert.equal(league.marketPolicy.leagueAllowed, false);
    assert.equal(league.executable, false);

    const ok = await simulateMarketTrade(
      deps({
        policy: { status: "active", maxStakePerTradeUsd: 25, allowedLeagues: ["nfl", "nba"] },
      }),
      ARGS,
      8453,
    );
    assert.equal(ok.executable, true);
  });

  void it("sells spend YES tokens, touch no cap, and reduce the position", async () => {
    const sell: SimulationArgs = { ...ARGS, direction: "sell", amountRaw: 4_000_000n };
    const short = await simulateMarketTrade(
      deps({ wallet: { yesBalanceRaw: 1_000_000n } }),
      sell,
      8453,
    );
    assert.match(short.walletPolicy.reason ?? "", /Insufficient position/);

    const sim = await simulateMarketTrade(
      deps({ wallet: { yesBalanceRaw: 10_000_000n, dailyCapUsd: 1, spentTodayUsd: 1 } }),
      sell,
      8453,
    );
    assert.equal(sim.executable, true, "a sell is not capped");
    assert.equal(sim.position.afterRaw, "6000000");
  });
});

void describe("materialDrift", () => {
  async function pair(
    fresh: Parameters<typeof deps>[0],
  ): Promise<[TradeSimulation, TradeSimulation]> {
    return [
      await simulateMarketTrade(deps({}), ARGS, 8453),
      await simulateMarketTrade(deps(fresh), ARGS, 8453),
    ];
  }

  void it("is empty when the fresh simulation matches", async () => {
    const [a, b] = await pair({});
    assert.deepEqual(materialDrift(a, b), []);
  });

  void it("flags a price move over the limit, a shrunken output, a state change, and a fee-season flip", async () => {
    const [a, moved] = await pair({
      quote: () =>
        Promise.resolve(quoteOf({ effectivePriceBps: 6250 + MATERIAL_PRICE_MOVE_BPS + 1 })),
    });
    assert.match(materialDrift(a, moved).join(";"), /price moved/);

    const [, shrunk] = await pair({
      quote: () => Promise.resolve(quoteOf({ amountOut: "15000000" })),
    });
    assert.match(materialDrift(a, shrunk).join(";"), /expected output fell/);

    const [, closed] = await pair({ quote: () => Promise.reject(new MarketClosedError("final")) });
    const reasons = materialDrift(a, closed);
    assert.match(reasons.join(";"), /no longer executable/);
    assert.match(reasons.join(";"), /open to closed/);

    const [, playoffs] = await pair({ quote: () => Promise.resolve(quoteOf({ playoffs: true })) });
    assert.match(materialDrift(a, playoffs).join(";"), /fee season/);
  });

  void it("tolerates a small move", async () => {
    const [a, b] = await pair({
      quote: () => Promise.resolve(quoteOf({ effectivePriceBps: 6300, amountOut: "15900000" })),
    });
    assert.deepEqual(materialDrift(a, b), []);
  });

  void it("flags different parameters", async () => {
    const a = await simulateMarketTrade(deps({}), ARGS, 8453);
    const b = await simulateMarketTrade(deps({}), { ...ARGS, outcomeIndex: 1 }, 8453);
    assert.match(materialDrift(a, b).join(";"), /parameters differ/);
  });
});
