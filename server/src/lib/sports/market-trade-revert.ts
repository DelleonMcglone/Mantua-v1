/**
 * C-024 — releasing the spend intent of a market trade the chain reverted.
 *
 * The daily-cap intent is inked once, when `/api/markets/trade/calldata`
 * hands out executable calldata (C-019). The user then signs and submits it
 * themselves, so a trade the chain REVERTS moved no money but still holds
 * its headroom until the UTC reset — the leak this closes.
 *
 * The release has to know how much to give back, and that number cannot
 * come from the client: the fill report is caller-supplied, so a caller
 * could revert a one-dollar trade, claim a thousand, and free cap it never
 * reserved. A reverted transaction also emits no logs, so the receipt the
 * success path reads its amounts from is empty here.
 *
 * What IS trustworthy is the transaction's own input calldata: the bytes
 * the user signed. This module decodes them against the exact ABI the
 * builder encodes with (`buildPoolSwapTestCalldata`) and recovers the input
 * amount, refusing anything that is not recognisably one of our buys.
 *
 * Pure — no chain, no database, no clock.
 */

import { decodeFunctionData } from "viem";
import { POOL_SWAP_TEST_ABI } from "../v4-contracts.ts";

/**
 * The USDC the user actually committed to a reverted BUY, in raw 6dp units,
 * or null when the calldata is not one.
 *
 * Returns null — meaning "release nothing" — for every shape we cannot
 * prove is a collateral-funded exact-input swap:
 *
 *  - calldata that does not decode against the swap ABI at all;
 *  - a non-negative `amountSpecified`. v4-core encodes exact-INPUT as a
 *    negative amount, so a positive one is exact-output: the input is
 *    whatever the pool took, which a reverted transaction never reveals;
 *  - a swap whose input currency is not the collateral. That is a SELL
 *    (YES in, USDC out), and sells never reserve cap — `marketTradeSpendUsd`
 *    returns null for them — so releasing one would mint headroom.
 *
 * The caller still has to establish that the transaction went to our own
 * router before trusting this; decoding proves the shape, not the target.
 */
export function decodeRevertedBuyAmountIn(
  input: `0x${string}`,
  collateral: `0x${string}`,
): bigint | null {
  let decoded: ReturnType<typeof decodeFunctionData<typeof POOL_SWAP_TEST_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: POOL_SWAP_TEST_ABI, data: input });
  } catch {
    // Not our calldata (wrong selector, truncated args, a different router).
    return null;
  }
  // `POOL_SWAP_TEST_ABI` declares exactly one function, so a successful
  // decode IS proof this is `swap` — and if that ABI ever grows a second,
  // `decoded.args` becomes a union and this destructure stops compiling.
  const [key, params] = decoded.args;
  // Exact-input is a NEGATIVE amountSpecified (the v4-core convention the
  // builder encodes); anything else is not an amount we reserved against.
  if (params.amountSpecified >= 0n) return null;
  const inputCurrency = params.zeroForOne ? key.currency0 : key.currency1;
  if (inputCurrency.toLowerCase() !== collateral.toLowerCase()) return null;
  return -params.amountSpecified;
}
