/**
 * Uniswap LiquidityAmounts ported to BigInt. Computes the liquidity
 * scalar for a position given current price + range bounds + the two
 * raw token amounts. Mirrors `LiquidityAmounts.getLiquidityForAmounts`
 * from v4-periphery.
 */

const Q96 = 1n << 96n;

function getLiquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  const [a, b] = sqrtA <= sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  if (b === a) return 0n;
  const intermediate = (a * b) / Q96;
  return (amount0 * intermediate) / (b - a);
}

function getLiquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  const [a, b] = sqrtA <= sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  if (b === a) return 0n;
  return (amount1 * Q96) / (b - a);
}

export interface LiquidityForAmountsArgs {
  sqrtPriceCurrentX96: bigint;
  sqrtPriceLowerX96: bigint;
  sqrtPriceUpperX96: bigint;
  amount0: bigint;
  amount1: bigint;
}

/**
 * Returns the maximum liquidity that can be supported by the given
 * amounts at the supplied price/range. Below the range only token0
 * applies; above only token1; in-range, the lesser of the two bounds.
 */
export function getLiquidityForAmounts(args: LiquidityForAmountsArgs): bigint {
  const { sqrtPriceCurrentX96: p, amount0, amount1 } = args;
  let { sqrtPriceLowerX96: a, sqrtPriceUpperX96: b } = args;
  if (a > b) [a, b] = [b, a];

  if (p <= a) return getLiquidityForAmount0(a, b, amount0);
  if (p >= b) return getLiquidityForAmount1(a, b, amount1);
  const l0 = getLiquidityForAmount0(p, b, amount0);
  const l1 = getLiquidityForAmount1(a, p, amount1);
  return l0 < l1 ? l0 : l1;
}
