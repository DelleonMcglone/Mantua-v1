import { MAX_PROBABILITY, MIN_PROBABILITY } from "../probability.ts";
import {
  MIN_RATE_PIPS,
  REGULAR_SEASON_FEE_PIPS,
  effectiveFeePips,
  feeOnInput,
} from "../sports/market-fee.ts";

/**
 * Task 072 / CB-003 — the combined payout and pricing engine. A combo's
 * fair probability is the product of its legs' YES prices (independence,
 * D-119); the pool's own quote is the price the user actually pays. Both
 * are reported, with the premium between them, so the ticket never hides
 * that a thin combo pool trades away from fair. Before the combo market
 * exists there is no pool to ask, so the quote is an opening estimate at
 * the fair price with the hook's own fee formula, labelled `planned`.
 * Pure: no chain, no DB.
 */

export const PROB_BPS_UNIT = 10_000n;

export interface PricedLeg {
  marketId: string;
  /** YES price in bps of probability. */
  priceBps: number;
}

export interface PoolQuote {
  /** YES shares the pool returns for the stake, raw 6dp. */
  amountOut: bigint;
  feeUsdcRaw: bigint;
  feePips: number;
}

export interface ComboPricingInput {
  /** USDC stake, raw 6dp. */
  stakeRaw: bigint;
  legs: readonly PricedLeg[];
  /** The combo pool's quote, or null when the market does not exist yet. */
  pool: PoolQuote | null;
  playoffs: boolean;
}

export interface ComboLegView extends PricedLeg {
  /** Decimal odds of this leg alone (1 / price). */
  oddsMultiplier: number;
}

export interface ComboPricing {
  source: "pool" | "planned";
  /** Π leg prices, bps, floored at the probability floor. */
  fairProbabilityBps: number;
  /** The fair probability as a 0–1 opening price for a new pool. */
  openingProbability: number;
  /** What the stake actually pays per share, bps; equals fair when planned. */
  effectivePriceBps: number;
  /** Decimal odds of the combo at the effective price. */
  combinedOdds: number;
  sharesRaw: bigint;
  /** Shares at par: what the combo pays if every leg wins. */
  potentialPayoutRaw: bigint;
  feeUsdcRaw: bigint;
  feePips: number;
  /** effective − fair, bps: positive when the pool charges more than fair. */
  premiumBps: number;
  legs: ComboLegView[];
}

const FLOOR_BPS = Math.round(MIN_PROBABILITY * 10_000);
const CEIL_BPS = Math.round(MAX_PROBABILITY * 10_000);

/** Π p_i in bps, clamped into the pool's representable probability range. */
export function fairProbabilityBps(legs: readonly { priceBps: number }[]): number {
  let product = PROB_BPS_UNIT;
  for (const leg of legs) {
    const p = BigInt(Math.min(Math.max(leg.priceBps, 0), 10_000));
    product = (product * p) / PROB_BPS_UNIT;
  }
  return Math.min(Math.max(Number(product), FLOOR_BPS), CEIL_BPS);
}

/** Decimal odds for a price in bps: 10000 / price, to 2 dp. */
export function oddsMultiplier(priceBps: number): number {
  if (priceBps <= 0) return 0;
  return Number((10_000 / priceBps).toFixed(2));
}

/** The fee the hook would charge a new combo pool at its opening price. */
export function plannedFeePips(fairBps: number, playoffs: boolean): number {
  return playoffs ? effectiveFeePips(MIN_RATE_PIPS, fairBps) : REGULAR_SEASON_FEE_PIPS;
}

export function priceCombo(input: ComboPricingInput): ComboPricing {
  const fair = fairProbabilityBps(input.legs);
  const legs = input.legs.map((l) => ({ ...l, oddsMultiplier: oddsMultiplier(l.priceBps) }));
  const shared = { fairProbabilityBps: fair, openingProbability: fair / 10_000, legs };
  if (input.pool && input.pool.amountOut > 0n) {
    const effective = Number((input.stakeRaw * PROB_BPS_UNIT) / input.pool.amountOut);
    return {
      ...shared,
      source: "pool",
      effectivePriceBps: effective,
      combinedOdds: oddsMultiplier(effective),
      sharesRaw: input.pool.amountOut,
      potentialPayoutRaw: input.pool.amountOut,
      feeUsdcRaw: input.pool.feeUsdcRaw,
      feePips: input.pool.feePips,
      premiumBps: effective - fair,
    };
  }
  const feePips = plannedFeePips(fair, input.playoffs);
  const feeUsdcRaw = feeOnInput(input.stakeRaw, feePips);
  const net = input.stakeRaw > feeUsdcRaw ? input.stakeRaw - feeUsdcRaw : 0n;
  const sharesRaw = (net * PROB_BPS_UNIT) / BigInt(fair);
  const effective = sharesRaw > 0n ? Number((input.stakeRaw * PROB_BPS_UNIT) / sharesRaw) : fair;
  return {
    ...shared,
    source: "planned",
    effectivePriceBps: effective,
    combinedOdds: oddsMultiplier(effective),
    sharesRaw,
    potentialPayoutRaw: sharesRaw,
    feeUsdcRaw,
    feePips,
    premiumBps: effective - fair,
  };
}

/** CB-004 — what the same legs cost as separate tickets: the sum of each
 *  leg's own hook fee for an equal split of the stake. */
export function separateTicketsFeeRaw(legFeesUsdcRaw: readonly bigint[]): bigint {
  return legFeesUsdcRaw.reduce((a, b) => a + b, 0n);
}
