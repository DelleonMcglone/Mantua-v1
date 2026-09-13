/**
 * Task 067 — the trade path's wire shapes for the browser suite (`TradeQuote`
 * / `TradeCalldata`, mirroring routes/market-trade.ts). Split from
 * fixtures.ts to keep each fixture module short.
 */
/** A 50¢ market in the playoffs at the 0.70% ceiling: fee = 0.35% of the input. */
export function quote(amountRaw: string, direction: "buy" | "sell") {
  const amountIn = BigInt(amountRaw);
  const amountOut = direction === "buy" ? amountIn * 2n : amountIn / 2n;
  const feeRaw = (amountIn * 35n) / 10_000n;
  return {
    marketAddress: "0x00000000000000000000000000000000000000ee",
    marketId: `0x${"12".repeat(32)}`,
    yesToken: "0x00000000000000000000000000000000000000dd",
    quote: {
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutMinimum: ((amountOut * 995n) / 1000n).toString(),
      effectivePriceBps: 5000,
    },
    fee: {
      feePips: 3500,
      ratePips: 7000,
      probabilityBps: 5000,
      playoffs: true,
      stale: false,
      feeRaw: feeRaw.toString(),
      feeUsdcRaw: feeRaw.toString(),
      breakdown: {},
    },
  };
}

export function calldata(amountRaw: string, direction: "buy" | "sell") {
  return {
    ...quote(amountRaw, direction),
    to: "0x00000000000000000000000000000000000000ee",
    data: "0x1234",
    value: "0",
    approvalTarget: null,
    inputToken: "0x00000000000000000000000000000000000000cc",
    sqrtPriceLimitX96: "0",
  };
}
