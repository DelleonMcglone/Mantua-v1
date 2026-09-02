/**
 * B9 — automated hedging strategies: the pure core.
 *
 * Everything decidable is decided here, over plain values, with no DB and no
 * chain — the same split the resolution service uses, for the same reason:
 * a strategy is standing authority to move a user's money, so the logic that
 * pulls the trigger must be exhaustively testable, and a data bug must not
 * be able to spend anything.
 *
 * Safety precedence (B9-007 is P0): disarm conditions are evaluated BEFORE
 * trigger conditions, so a strategy on a frozen or resolved market can never
 * fire — kickoff auto-disarms it in the same tick that might otherwise have
 * triggered it. The global kill switch is checked by the engine before any
 * evaluation at all; disarming remains allowed under kill, firing does not.
 */

import { z } from "zod";
import { marketIdsFor } from "./resolution.ts";
import { isVoidStatus } from "./provider.ts";
import type { ProviderSlate } from "./provider.ts";

// ─── B9-001: strategy configs ───────────────────────────────────────────────

/** Probability in bps of the market's YES side (10000 = certain). */
const bps = z.number().int().min(1).max(9999);

/**
 * B9-002 — take-profit / stop on one market position. The user holds one
 * side; the strategy closes it when the implied probability crosses a
 * threshold in either direction.
 *
 * Thresholds speak the YES side's probability regardless of which side is
 * held: for a NO holder the UI converts before arming, so the stored config
 * has exactly one vocabulary (mirrors the resolve-outcome lesson in B4).
 */
export const takeProfitStopSchema = z
  .object({
    kind: z.literal("take-profit-stop"),
    marketId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    /** Which side the user holds — determines close direction. */
    side: z.enum(["yes", "no"]),
    /** Close when YES-implied probability rises to/above this. */
    takeProfitBps: bps.optional(),
    /** Close when YES-implied probability falls to/below this. */
    stopBps: bps.optional(),
  })
  .refine((c) => c.takeProfitBps !== undefined || c.stopBps !== undefined, {
    message: "At least one of takeProfitBps / stopBps is required",
  })
  .refine((c) => !c.takeProfitBps || !c.stopBps || c.stopBps < c.takeProfitBps, {
    message: "stopBps must be below takeProfitBps",
  });

/**
 * B9-003 — delta hedge across correlated markets: keep net USD exposure
 * inside a band around a target. Exposures are an input to evaluation, not
 * something this module computes — positions live on-chain.
 */
export const deltaHedgeSchema = z.object({
  kind: z.literal("delta-hedge"),
  marketIds: z
    .array(z.string().regex(/^0x[0-9a-fA-F]{64}$/))
    .min(2)
    .max(8),
  targetNetUsd: z.number().min(-100_000).max(100_000),
  bandUsd: z.number().positive().max(100_000),
});

export const strategyConfigSchema = z.discriminatedUnion("kind", [
  takeProfitStopSchema,
  deltaHedgeSchema,
]);
export type StrategyConfig = z.infer<typeof strategyConfigSchema>;

/** One evaluatable strategy — the DB row's decision-relevant projection. */
export interface ArmedStrategy {
  id: string;
  config: StrategyConfig;
  /** Hard USDC ceiling for this strategy, independent of the wallet cap. */
  capUsd: number;
  /** Unix seconds; null = no expiry. */
  expiresAtSeconds: number | null;
}

/** What evaluation needs to know about one market right now. */
export interface MarketTick {
  marketId: string;
  /** Implied probability of YES, in bps. Null when no price is available. */
  impliedProbBps: number | null;
  /** Market frozen on-chain, or its kickoff has passed. */
  frozen: boolean;
  resolved: boolean;
  /** Net USD exposure of the user's position in this market (delta hedge). */
  netExposureUsd?: number;
}

export type StrategyDecision =
  | { kind: "hold"; reason: string }
  | {
      kind: "trigger";
      action: "close-position" | "rebalance";
      marketId: string;
      /** For rebalance: signed USD amount to move exposure by. */
      deltaUsd?: number;
      reason: string;
    }
  | { kind: "disarm"; reason: "expired" | "market-frozen" | "market-resolved" | "kill-switch" };

// ─── Evaluation ─────────────────────────────────────────────────────────────

function tickFor(ticks: readonly MarketTick[], marketId: string): MarketTick | undefined {
  return ticks.find((t) => t.marketId.toLowerCase() === marketId.toLowerCase());
}

/**
 * Evaluate one armed strategy against current market ticks.
 *
 * Order is the safety property: kill switch, then expiry, then market
 * state, and only then triggers. A strategy whose game just kicked off
 * disarms — it never fires on the freeze tick.
 */
export function evaluateStrategy(
  strategy: ArmedStrategy,
  ticks: readonly MarketTick[],
  nowSeconds: number,
  globallyKilled = false,
): StrategyDecision {
  if (globallyKilled) return { kind: "disarm", reason: "kill-switch" };
  if (strategy.expiresAtSeconds !== null && nowSeconds >= strategy.expiresAtSeconds) {
    return { kind: "disarm", reason: "expired" };
  }

  const config = strategy.config;
  const referenced = config.kind === "take-profit-stop" ? [config.marketId] : config.marketIds;

  for (const marketId of referenced) {
    const tick = tickFor(ticks, marketId);
    if (!tick) return { kind: "hold", reason: `no data for ${marketId}` };
    if (tick.resolved) return { kind: "disarm", reason: "market-resolved" };
    if (tick.frozen) return { kind: "disarm", reason: "market-frozen" };
  }

  if (config.kind === "take-profit-stop") {
    const tick = tickFor(ticks, config.marketId);
    if (!tick || tick.impliedProbBps === null) {
      return { kind: "hold", reason: "no price available" };
    }
    const p = tick.impliedProbBps;
    if (config.takeProfitBps !== undefined && p >= config.takeProfitBps) {
      return {
        kind: "trigger",
        action: "close-position",
        marketId: config.marketId,
        reason: `take-profit: implied ${String(p)}bps >= ${String(config.takeProfitBps)}bps`,
      };
    }
    if (config.stopBps !== undefined && p <= config.stopBps) {
      return {
        kind: "trigger",
        action: "close-position",
        marketId: config.marketId,
        reason: `stop: implied ${String(p)}bps <= ${String(config.stopBps)}bps`,
      };
    }
    return { kind: "hold", reason: "inside thresholds" };
  }

  // Delta hedge: sum known exposures; any missing exposure holds — hedging
  // against a partial picture can double real exposure instead of reducing it.
  let net = 0;
  for (const marketId of config.marketIds) {
    const tick = tickFor(ticks, marketId);
    if (tick?.netExposureUsd === undefined) {
      return { kind: "hold", reason: "exposure unknown for at least one market" };
    }
    net += tick.netExposureUsd;
  }
  const deviation = net - config.targetNetUsd;
  if (Math.abs(deviation) > config.bandUsd) {
    // Rebalance toward target through the most liquid deviating market —
    // engine picks the venue; the decision only sizes the move.
    const deltaUsd = -deviation;
    const capped = Math.max(Math.min(deltaUsd, strategy.capUsd), -strategy.capUsd);
    return {
      kind: "trigger",
      action: "rebalance",
      marketId: config.marketIds[0],
      deltaUsd: capped,
      reason: `net ${net.toFixed(2)} outside band ±${String(config.bandUsd)} of target ${String(config.targetNetUsd)}`,
    };
  }
  return { kind: "hold", reason: "inside band" };
}

// ─── Ticks from slates ──────────────────────────────────────────────────────

/**
 * Build market ticks from provider slates (B9-005: "price and game-state
 * ticks"). Until the periphery deploy lets us read pool prices on-chain, the
 * provider's implied win probability is the price reference; the two markets
 * of one game get complementary probabilities. `frozen` is timestamp-driven
 * exactly like the contract's own freeze, so strategies disarm on the same
 * clock the market does. A delayed slate yields NO ticks — strategies must
 * not fire on stale data (same doctrine as settlement: delay is acceptable,
 * acting on delayed data is not).
 */
export function ticksFromSlates(
  slates: readonly ProviderSlate[],
  nowSeconds: number = Math.floor(Date.now() / 1000),
): MarketTick[] {
  const ticks: MarketTick[] = [];
  for (const slate of slates) {
    if (slate.delayed) continue;
    for (const event of slate.events) {
      const [homeMarket, awayMarket] = marketIdsFor(event.providerEventId);
      const frozen =
        event.startsAt <= nowSeconds || event.status === "in_progress" || event.status === "final";
      const resolved = event.status === "final" || isVoidStatus(event.status);
      const p = event.homeWinProbabilityBps;
      ticks.push(
        {
          marketId: homeMarket,
          impliedProbBps: typeof p === "number" ? p : null,
          frozen,
          resolved,
        },
        {
          marketId: awayMarket,
          impliedProbBps: typeof p === "number" ? 10_000 - p : null,
          frozen,
          resolved,
        },
      );
    }
  }
  return ticks;
}
