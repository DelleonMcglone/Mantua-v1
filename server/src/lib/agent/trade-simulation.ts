import type { MarketTradeQuote } from "../sports/market-trade-build.ts";
import {
  MarketClosedError,
  MarketDataOutageError,
  MarketsNotDeployedError,
  NoMarketError,
} from "../sports/market-trade-build.ts";

/**
 * Phase 8 / A-009, A-025, A-030 — the mandatory pre-execution simulation
 * for a market trade, and the material-drift rule that a later execution
 * is checked against.
 *
 * Pure over injected readers (the quote, the wallet's balance and cap, the
 * user's policy, the agent's existing position) so the shape and the drift
 * rule are unit-tested; the production deps wrap the same modules the
 * user's own trade ticket uses (`quoteMarketTrade`, `spending-cap.ts`).
 *
 * `executable` is the single verdict the model may act on. When false,
 * `blockers` says why in the vocabulary the user will see, and the
 * simulation is still returned in full so the model can explain the
 * situation rather than guess.
 */

export type TradeDirection = "buy" | "sell";

export interface SimulationArgs {
  providerEventId: string;
  outcomeIndex: 0 | 1;
  direction: TradeDirection;
  /** Raw 6-decimal units: USDC for buys, YES tokens for sells. */
  amountRaw: bigint;
}

export interface WalletPolicyRead {
  usdcBalanceRaw: bigint;
  yesBalanceRaw: bigint;
  dailyCapUsd: number;
  spentTodayUsd: number;
}

export interface UserPolicyRead {
  status: "active" | "paused";
  maxStakePerTradeUsd: number;
  /** Empty = every launch league. */
  allowedLeagues: readonly string[];
}

export interface SimulationDeps {
  quote: (args: SimulationArgs) => Promise<MarketTradeQuote>;
  wallet: (marketId: `0x${string}` | null) => Promise<WalletPolicyRead>;
  policy: () => Promise<UserPolicyRead | null>;
  /** The game's league slug, or null when the event is unknown. */
  league: (providerEventId: string) => Promise<string | null>;
  /** Current implied probability for the outcome (bps), null when unknown. */
  marketImpliedBps: (marketId: `0x${string}`) => Promise<number | null>;
  now: () => number;
  id: () => string;
}

export type Tradability = "open" | "closed" | "halted" | "no_market" | "not_deployed";

export interface TradeSimulation {
  simulationId: string;
  createdAt: number;
  expiresAt: number;
  chainId: number;
  providerEventId: string;
  outcomeIndex: 0 | 1;
  direction: TradeDirection;
  amountRaw: string;
  /** The one verdict: every blocker is empty. */
  executable: boolean;
  blockers: string[];
  market: {
    tradability: Tradability;
    reason: string | null;
    marketId: `0x${string}` | null;
    league: string | null;
    impliedProbabilityBps: number | null;
  };
  estimate: {
    amountIn: string;
    amountOut: string;
    amountOutMinimum: string;
    effectivePriceBps: number | null;
    /** Effective price vs the market's current implied probability, in bps
     *  of probability — the trade's own impact on price. Null when either
     *  side is unknown. */
    priceImpactBps: number | null;
  } | null;
  fees: {
    feeRaw: string;
    feeUsdcRaw: string;
    feePips: number;
    playoffs: boolean;
  } | null;
  position: {
    /** YES tokens held before, raw. */
    beforeRaw: string;
    /** YES tokens held after, raw (buy adds `amountOut`, sell removes `amountIn`). */
    afterRaw: string;
    /** USDC at stake in this market after the trade, valued at the effective price. */
    exposureUsd: number | null;
  };
  walletPolicy: {
    ok: boolean;
    reason: string | null;
    usdcBalance: number;
    dailyCapUsd: number;
    spentTodayUsd: number;
    remainingTodayUsd: number;
  };
  marketPolicy: {
    ok: boolean;
    reason: string | null;
    maxStakePerTradeUsd: number | null;
    leagueAllowed: boolean;
  };
}

export const SIMULATION_TTL_MS = 10 * 60_000;
/** A move in effective price larger than this between simulation and
 *  execution is "material": the user confirmed a different trade. */
export const MATERIAL_PRICE_MOVE_BPS = 100;
/** Or the expected output shrinking by more than this fraction. */
export const MATERIAL_OUTPUT_SHRINK = 0.01;

function usd(raw: bigint): number {
  return Number(raw) / 1e6;
}

function tradabilityFromError(err: unknown): { tradability: Tradability; reason: string } {
  if (err instanceof MarketClosedError) return { tradability: "closed", reason: err.message };
  if (err instanceof MarketDataOutageError) return { tradability: "halted", reason: err.message };
  if (err instanceof NoMarketError) return { tradability: "no_market", reason: err.message };
  if (err instanceof MarketsNotDeployedError)
    return { tradability: "not_deployed", reason: err.message };
  throw err;
}

export async function simulateMarketTrade(
  deps: SimulationDeps,
  args: SimulationArgs,
  chainId: number,
): Promise<TradeSimulation> {
  const now = deps.now();
  const blockers: string[] = [];

  // 1. The market and the quote — the same builder the user's button uses.
  let quote: MarketTradeQuote | null = null;
  let tradability: Tradability = "open";
  let marketReason: string | null = null;
  try {
    quote = await deps.quote(args);
  } catch (err) {
    const t = tradabilityFromError(err);
    tradability = t.tradability;
    marketReason = t.reason;
    blockers.push(t.reason);
  }
  const marketId = quote?.marketId ?? null;
  const league = await deps.league(args.providerEventId);
  const impliedBps = marketId ? await deps.marketImpliedBps(marketId) : null;

  // 2. Wallet policy: balance and the daily cap (buys spend USDC; sells
  //    spend YES tokens and touch no cap — the trade gate's rule).
  const wallet = await deps.wallet(marketId);
  const spendUsd = args.direction === "buy" ? usd(args.amountRaw) : 0;
  const remaining = Math.max(0, wallet.dailyCapUsd - wallet.spentTodayUsd);
  let walletReason: string | null = null;
  if (args.direction === "buy" && wallet.usdcBalanceRaw < args.amountRaw) {
    walletReason = `Insufficient agent balance: needs ${usd(args.amountRaw).toFixed(2)} USDC, has ${usd(wallet.usdcBalanceRaw).toFixed(2)} USDC.`;
  } else if (args.direction === "sell" && wallet.yesBalanceRaw < args.amountRaw) {
    walletReason = `Insufficient position: selling ${usd(args.amountRaw).toFixed(2)} YES but the agent holds ${usd(wallet.yesBalanceRaw).toFixed(2)}.`;
  } else if (spendUsd > remaining) {
    walletReason = `Daily cap: $${String(wallet.dailyCapUsd)} cap, $${wallet.spentTodayUsd.toFixed(2)} spent today, $${remaining.toFixed(2)} remaining — this buy needs $${spendUsd.toFixed(2)}.`;
  }
  if (walletReason) blockers.push(walletReason);

  // 3. Market policy: the user's own limits on the agent.
  const policy = await deps.policy();
  let policyReason: string | null = null;
  let leagueAllowed = true;
  if (policy) {
    if (policy.status === "paused") {
      policyReason = "The agent's policy is paused — no trades until it is resumed.";
    } else if (spendUsd > policy.maxStakePerTradeUsd) {
      policyReason = `Per-trade limit: this buy is $${spendUsd.toFixed(2)}, the policy allows at most $${String(policy.maxStakePerTradeUsd)} per trade.`;
    } else if (
      policy.allowedLeagues.length > 0 &&
      league !== null &&
      !policy.allowedLeagues.includes(league)
    ) {
      leagueAllowed = false;
      policyReason = `League not permitted: the policy allows ${policy.allowedLeagues.join(", ")}; this game is ${league}.`;
    }
  }
  if (policyReason) blockers.push(policyReason);

  // 4. Estimate and resulting position.
  const before = wallet.yesBalanceRaw;
  const afterRaw =
    quote === null
      ? before
      : args.direction === "buy"
        ? before + BigInt(quote.quote.amountOut)
        : before - args.amountRaw;
  const eff = quote?.quote.effectivePriceBps ?? null;
  const priceImpactBps =
    eff !== null && impliedBps !== null
      ? args.direction === "buy"
        ? eff - impliedBps
        : impliedBps - eff
      : null;
  const exposureUsd = eff === null ? null : (Number(afterRaw) / 1e6) * (eff / 10_000);

  return {
    simulationId: deps.id(),
    createdAt: now,
    expiresAt: now + SIMULATION_TTL_MS,
    chainId,
    providerEventId: args.providerEventId,
    outcomeIndex: args.outcomeIndex,
    direction: args.direction,
    amountRaw: args.amountRaw.toString(),
    executable: blockers.length === 0,
    blockers,
    market: {
      tradability,
      reason: marketReason,
      marketId,
      league,
      impliedProbabilityBps: impliedBps,
    },
    estimate: quote
      ? {
          amountIn: quote.quote.amountIn,
          amountOut: quote.quote.amountOut,
          amountOutMinimum: quote.quote.amountOutMinimum,
          effectivePriceBps: eff,
          priceImpactBps,
        }
      : null,
    fees: quote
      ? {
          feeRaw: quote.fee.feeRaw,
          feeUsdcRaw: quote.fee.feeUsdcRaw,
          feePips: quote.fee.feePips,
          playoffs: quote.fee.playoffs,
        }
      : null,
    position: {
      beforeRaw: before.toString(),
      afterRaw: (afterRaw < 0n ? 0n : afterRaw).toString(),
      exposureUsd: exposureUsd === null ? null : Number(exposureUsd.toFixed(2)),
    },
    walletPolicy: {
      ok: walletReason === null,
      reason: walletReason,
      usdcBalance: Number(usd(wallet.usdcBalanceRaw).toFixed(2)),
      dailyCapUsd: wallet.dailyCapUsd,
      spentTodayUsd: Number(wallet.spentTodayUsd.toFixed(2)),
      remainingTodayUsd: Number(remaining.toFixed(2)),
    },
    marketPolicy: {
      ok: policyReason === null,
      reason: policyReason,
      maxStakePerTradeUsd: policy?.maxStakePerTradeUsd ?? null,
      leagueAllowed,
    },
  };
}

/**
 * A-030 — compare the simulation the user confirmed with a fresh one taken
 * immediately before execution. Returns the reasons the fresh one differs
 * materially (empty = execute). A trade the user confirmed must be the
 * trade that runs: same market, same side, same amount, still executable,
 * price within MATERIAL_PRICE_MOVE_BPS, output within MATERIAL_OUTPUT_SHRINK,
 * fee season unchanged, and every policy still green.
 */
export function materialDrift(confirmed: TradeSimulation, fresh: TradeSimulation): string[] {
  const reasons: string[] = [];
  if (
    confirmed.providerEventId !== fresh.providerEventId ||
    confirmed.outcomeIndex !== fresh.outcomeIndex ||
    confirmed.direction !== fresh.direction ||
    confirmed.amountRaw !== fresh.amountRaw ||
    confirmed.chainId !== fresh.chainId
  ) {
    reasons.push("the trade parameters differ from the confirmed simulation");
  }
  if (!fresh.executable) {
    reasons.push(...fresh.blockers.map((b) => `no longer executable: ${b}`));
  }
  if (confirmed.market.tradability !== fresh.market.tradability) {
    reasons.push(
      `market state changed from ${confirmed.market.tradability} to ${fresh.market.tradability}`,
    );
  }
  const a = confirmed.estimate;
  const b = fresh.estimate;
  if (a && b) {
    if (a.effectivePriceBps !== null && b.effectivePriceBps !== null) {
      const move = Math.abs(b.effectivePriceBps - a.effectivePriceBps);
      if (move > MATERIAL_PRICE_MOVE_BPS) {
        reasons.push(
          `price moved ${String(move)} bps since the confirmed simulation (limit ${String(MATERIAL_PRICE_MOVE_BPS)})`,
        );
      }
    }
    const outA = Number(a.amountOut);
    const outB = Number(b.amountOut);
    if (outA > 0 && outB < outA * (1 - MATERIAL_OUTPUT_SHRINK)) {
      reasons.push(
        `expected output fell from ${(outA / 1e6).toFixed(2)} to ${(outB / 1e6).toFixed(2)}`,
      );
    }
  }
  if (confirmed.fees && fresh.fees && confirmed.fees.playoffs !== fresh.fees.playoffs) {
    reasons.push("the fee season flag changed");
  }
  return reasons;
}
