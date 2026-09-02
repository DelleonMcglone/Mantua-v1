/**
 * Price ↔ probability — B1-010.
 *
 * One module owns this conversion. The UI, the agent, the market generator,
 * and the pool bootstrap all import from here; nobody re-derives it, because
 * two slightly different derivations produce two slightly different odds for
 * the same pool and there is no way to tell which is right from the outside.
 *
 * The relationship is direct: a YES token pays 1 USDC if the outcome happens
 * and 0 otherwise, so its price in USDC *is* the market's implied
 * probability. A YES trading at 0.62 USDC is a 62% implied chance.
 *
 * Uniswap v4 stores price as `sqrtPriceX96` — the square root of the price
 * ratio, in Q64.96 fixed point. The conversions below go between that, a
 * decimal price, and a probability, and they are the only place that
 * arithmetic is allowed to live.
 */

/** 2^96, the Q64.96 scaling factor. */
const Q96 = 2n ** 96n;

/** Probabilities are clamped away from the endpoints: a market at exactly
 *  0 or 1 has no tradeable range left, and `sqrt` of zero has no valid tick. */
export const MIN_PROBABILITY = 0.0001;
export const MAX_PROBABILITY = 0.9999;

export class InvalidProbabilityError extends Error {}

/** Reject NaN, infinities, and out-of-range inputs at the boundary. */
function assertProbability(p: number): void {
  if (!Number.isFinite(p)) {
    throw new InvalidProbabilityError(`probability must be finite, got ${String(p)}`);
  }
  if (p < 0 || p > 1) {
    throw new InvalidProbabilityError(`probability must be within [0, 1], got ${String(p)}`);
  }
}

/** Pull a probability inside the tradeable range. */
export function clampProbability(p: number): number {
  assertProbability(p);
  if (p < MIN_PROBABILITY) return MIN_PROBABILITY;
  if (p > MAX_PROBABILITY) return MAX_PROBABILITY;
  return p;
}

/**
 * Probability → YES price in USDC. The identity conversion, wrapped so call
 * sites read as intent rather than as a bare assignment.
 */
export function probabilityToPrice(probability: number): number {
  return clampProbability(probability);
}

/** YES price in USDC → implied probability. */
export function priceToProbability(price: number): number {
  return clampProbability(price);
}

/**
 * Probability → `sqrtPriceX96` for a YES/USDC pool.
 *
 * @param probability     Implied probability, 0–1.
 * @param yesIsToken0     Whether YES sorts as token0 in the pool key. v4
 *                        orders tokens by address, so this is a property of
 *                        the deployed pair, not a choice — pass what the
 *                        pool key says.
 * @param yesDecimals     Decimals of the YES token (6, matching USDC).
 * @param usdcDecimals    Decimals of USDC (6 on the ERC-20 interface).
 *
 * @remarks v4's price is always token1 per token0, so the ratio has to be
 * inverted when YES is token1. Getting this backwards seeds a market at
 * 1 − p instead of p, which is silent and expensive: the pool simply opens
 * at the wrong odds.
 */
export function probabilityToSqrtPriceX96(
  probability: number,
  yesIsToken0: boolean,
  yesDecimals = 6,
  usdcDecimals = 6,
): bigint {
  const p = clampProbability(probability);

  // Price of YES in USDC, adjusted for any decimals mismatch between the
  // two tokens.
  const decimalAdjustment = 10 ** (usdcDecimals - yesDecimals);
  const priceYesInUsdc = p * decimalAdjustment;

  // token1-per-token0, per the v4 convention.
  const ratio = yesIsToken0 ? priceYesInUsdc : 1 / priceYesInUsdc;

  // sqrt in floating point, then scale to Q64.96. Precision here is ample:
  // a double carries ~15 significant digits and a tick is ~1 basis point.
  return BigInt(Math.floor(Math.sqrt(ratio) * Number(Q96)));
}

/** `sqrtPriceX96` → raw YES price in USDC, UNVALIDATED: a thin pool pushed
 *  past the [0, 1] redemption band reports its actual (absurd) price, e.g.
 *  3.1. Callers that render a probability clamp for display; callers that
 *  need the invariant use `sqrtPriceX96ToProbability`, which throws. */
export function sqrtPriceX96ToRawProbability(
  sqrtPriceX96: bigint,
  yesIsToken0: boolean,
  yesDecimals = 6,
  usdcDecimals = 6,
): number {
  if (sqrtPriceX96 <= 0n) {
    throw new InvalidProbabilityError("sqrtPriceX96 must be positive");
  }
  const sqrtRatio = Number(sqrtPriceX96) / Number(Q96);
  const ratio = sqrtRatio * sqrtRatio;
  const priceYesInUsdc = yesIsToken0 ? ratio : 1 / ratio;
  return priceYesInUsdc / 10 ** (usdcDecimals - yesDecimals);
}

/** `sqrtPriceX96` → implied probability. Inverse of the above. */
export function sqrtPriceX96ToProbability(
  sqrtPriceX96: bigint,
  yesIsToken0: boolean,
  yesDecimals = 6,
  usdcDecimals = 6,
): number {
  if (sqrtPriceX96 <= 0n) {
    throw new InvalidProbabilityError("sqrtPriceX96 must be positive");
  }

  const sqrtRatio = Number(sqrtPriceX96) / Number(Q96);
  const ratio = sqrtRatio * sqrtRatio;
  const priceYesInUsdc = yesIsToken0 ? ratio : 1 / ratio;

  const decimalAdjustment = 10 ** (usdcDecimals - yesDecimals);
  return clampProbability(priceYesInUsdc / decimalAdjustment);
}

/**
 * Format a probability for display: "62%" rather than "0.6200000000001".
 * One implementation so the board, the market page, and the portfolio all
 * round the same way.
 */
export function formatProbability(probability: number, fractionDigits = 0): string {
  const p = clampProbability(probability);
  return `${(p * 100).toFixed(fractionDigits)}%`;
}

/**
 * American odds from a probability — "+150" / "−200". Display only; never
 * feed this back into pricing, since the round trip is lossy.
 */
export function probabilityToAmericanOdds(probability: number): string {
  const p = clampProbability(probability);
  if (p >= 0.5) {
    return `−${String(Math.round((p / (1 - p)) * 100))}`;
  }
  return `+${String(Math.round(((1 - p) / p) * 100))}`;
}
