/**
 * Inverse of getLiquidityForAmounts — returns the amount0/amount1 that
 * back a given liquidity scalar at the supplied price/range. Mirrors
 * `LiquidityAmounts.getAmountsForLiquidity` in v4-periphery.
 *
 * Used by the remove-liquidity preview to estimate what the user will
 * receive. For a faithful real-time number, callers should fetch the
 * pool's current sqrtPrice from on-chain. The remove preview in 4d
 * uses the price-at-mint as an approximation (good enough for full-
 * range positions where amounts barely drift).
 */

const Q96 = 1n << 96n;

function getAmount0(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [a, b] = sqrtA <= sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  if (b === a) return 0n;
  // amount0 = liquidity * (sqrtB - sqrtA) * Q96 / (sqrtA * sqrtB)
  const num = liquidity * (b - a) * Q96;
  return num / (a * b);
}

function getAmount1(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [a, b] = sqrtA <= sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  if (b === a) return 0n;
  // amount1 = liquidity * (sqrtB - sqrtA) / Q96
  return (liquidity * (b - a)) / Q96;
}

export interface AmountsForLiquidityArgs {
  sqrtPriceCurrentX96: bigint;
  sqrtPriceLowerX96: bigint;
  sqrtPriceUpperX96: bigint;
  liquidity: bigint;
}

export function getAmountsForLiquidity(args: AmountsForLiquidityArgs): {
  amount0: bigint;
  amount1: bigint;
} {
  const { sqrtPriceCurrentX96: p, liquidity } = args;
  let { sqrtPriceLowerX96: a, sqrtPriceUpperX96: b } = args;
  if (a > b) [a, b] = [b, a];

  if (p <= a) return { amount0: getAmount0(a, b, liquidity), amount1: 0n };
  if (p >= b) return { amount0: 0n, amount1: getAmount1(a, b, liquidity) };
  return {
    amount0: getAmount0(p, b, liquidity),
    amount1: getAmount1(a, p, liquidity),
  };
}
