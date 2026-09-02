/**
 * sqrtPriceX96 = sqrt(price1/price0) << 96, where price = (amount1 / 10^d1) /
 * (amount0 / 10^d0). Uniswap convention.
 *
 * Pure BigInt arithmetic — no JS-float precision loss. Used to encode the
 * initial price for `PoolManager.initialize`.
 */

const Q96 = 1n << 96n;
const Q192 = 1n << 192n;

/**
 * sqrtPriceX96 for a 1:1 price (price === 1.0): sqrt(1) << 96 === 2^96.
 * Used to initialize peg-anchored pools (e.g. Stable Protection, which
 * models its pair as a 1:1 peg) at parity so they open in the HEALTHY
 * zone regardless of the amounts the user happened to enter.
 */
export const SQRT_PRICE_X96_1_1 = Q96;

const MIN_SQRT_PRICE_X96 = 4_295_128_739n; // v4 TickMath.MIN_SQRT_PRICE
const MAX_SQRT_PRICE_X96 = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n; // MAX_SQRT_PRICE

/**
 * Integer square root via Newton's method. Returns floor(sqrt(n)).
 * Throws on negative input.
 */
export function sqrtBigInt(n: bigint): bigint {
  if (n < 0n) throw new Error("sqrtBigInt: negative input");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export interface EncodeArgs {
  /** Raw amount of token0 (base units, e.g. ETH wei). */
  amount0Raw: bigint;
  /** Raw amount of token1 (base units). */
  amount1Raw: bigint;
}

/**
 * Encode sqrtPriceX96 from a pair of raw amounts representing the desired
 * initial price. price = amount1Raw / amount0Raw at base-unit scale, which
 * already accounts for both tokens' decimals.
 *
 * Throws if the result falls outside v4's SQRT_PRICE bounds.
 */
export function encodeSqrtPriceX96({ amount0Raw, amount1Raw }: EncodeArgs): bigint {
  if (amount0Raw <= 0n || amount1Raw <= 0n) {
    throw new Error("encodeSqrtPriceX96: amounts must be positive");
  }
  const numerator = amount1Raw * Q192;
  const denom = amount0Raw;
  const ratioX192 = numerator / denom;
  const sqrtPriceX96 = sqrtBigInt(ratioX192);
  void Q96; // referenced for documentation; sqrtPriceX96 = sqrt(ratioX192) since 2^192 = (2^96)^2
  if (sqrtPriceX96 < MIN_SQRT_PRICE_X96 || sqrtPriceX96 > MAX_SQRT_PRICE_X96) {
    throw new Error(
      `sqrtPriceX96 ${sqrtPriceX96.toString()} outside v4 bounds — choose a different initial price`,
    );
  }
  return sqrtPriceX96;
}
