/**
 * One builder for every outcome-token trade — the user route, the strategy
 * executor, and the agent all call THIS, so there is exactly one place that
 * knows how to quote and encode a market swap. Divergence between "what the
 * user's button does" and "what the automation does" is the bug class this
 * file exists to prevent.
 */

import { parseAbi } from "viem";

const MARKET_STARTS_AT_ABI = parseAbi(["function startsAt() view returns (uint64)"]);
import { BASE_CHAIN_ID, type SupportedChainId } from "../chains.ts";
import { getRpcClient } from "../rpc-client.ts";
import { computeMarketId } from "../market-id.ts";
import {
  MAX_SQRT_PRICE_LIMIT,
  MIN_SQRT_PRICE_LIMIT,
  buildPoolSwapTestCalldata,
} from "../v4-onchain-swap.ts";
import { readSlot0 } from "../v4-state-view.ts";
import { DYNAMIC_MARKET_BY_CHAIN } from "../v4-contracts.ts";
import {
  MARKETS_BY_CHAIN,
  MARKETS_PERIPHERY_BY_CHAIN,
  MARKET_ABI,
  MARKET_FACTORY_ABI,
} from "../markets-contracts.ts";
import { planMarketPool } from "./market-pool.ts";
import { getToken } from "../tokens.ts";
import { DEFAULT_SLIPPAGE_BPS } from "../constants.ts";
import { assertSlippageBounds } from "../slippage.ts";
import { sqrtBigInt } from "../sqrt-price.ts";
import { assertSwapRoute } from "../swap-route.ts";

/**
 * C-004 — the platform currency is the chain's canonical USDC (on Base
 * Mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913). Every market's
 * collateral, quote, fee accrual, and redemption is denominated in it, so a
 * markets deployment wired to any other token is a config error that would
 * silently misdenominate balances, spending-cap accounting (which treats
 * the exact USDC input as the USD value), and settlement. Fail loudly at
 * the trade/seed choke points instead.
 */
export function assertUsdcCollateral(
  chainId: SupportedChainId,
  collateral: `0x${string}`,
): void {
  const usdc = getToken("USDC", chainId).address;
  if (collateral.toLowerCase() !== usdc.toLowerCase()) {
    throw new Error(
      `Markets deployment on chain ${String(chainId)} declares collateral ${collateral}, ` +
        `not the canonical USDC ${usdc} — refusing to build the trade`,
    );
  }
}

const V4_QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

export class NoMarketError extends Error {
  constructor(providerEventId: string) {
    super(`No market for game ${providerEventId}`);
    this.name = "NoMarketError";
  }
}

/**
 * The sports-market stack (factory / periphery / Dynamic Market hook) has
 * no deployment on the target chain — the gated state, not a bug. Routes
 * map this to a clean "markets aren't live here yet" response instead of
 * an opaque 502 (B7 edge case: MARKETS_BY_CHAIN empty ⇒ gated errors,
 * never opaque throws).
 */
export class MarketsNotDeployedError extends Error {
  constructor(chainId: SupportedChainId) {
    super(
      `Sports markets are not deployed on chain ${String(chainId)} yet — ` +
        `outcome-token trading opens when the market contracts land.`,
    );
    this.name = "MarketsNotDeployedError";
  }
}

/** Betting window is over: the game has kicked off (or finished). The
 *  hook enforces this on-chain with its timestamp freeze — this check
 *  turns that guaranteed revert into a clean, quotable-in-advance error. */
export class MarketClosedError extends Error {
  constructor(providerEventId: string) {
    super(
      `Betting is closed for game ${providerEventId} — it has already started. ` +
        `Positions can still be redeemed after the market resolves.`,
    );
    this.name = "MarketClosedError";
  }
}

/**
 * C-019 — the USD magnitude a market trade consumes from the daily spending
 * cap: buys spend USDC, and USDC is the cap's unit of account, so the exact
 * input amount IS the USD value (no price feed involved — the same convention
 * the chat tool's `trade_market` uses). Sells are exits — they return USDC —
 * so they consume nothing and the route must not check or record them.
 * Returns null for a sell (no cap touch), the USD value for a buy.
 */
export function marketTradeSpendUsd(direction: "buy" | "sell", amountRaw: bigint): number | null {
  return direction === "buy" ? Number(amountRaw) / 1e6 : null;
}

/** Quote-derived minimum acceptable output: `amountOut × (1 − slippage)`.
 *  Surfaced to the client alongside the quote; the on-chain enforcement of
 *  the same tolerance travels as the sqrtPriceLimitX96 in the calldata. */
export function marketMinOut(amountOut: bigint, slippageBps: number): bigint {
  assertSlippageBounds(slippageBps);
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/**
 * B7-003 — the in-calldata slippage bound for a market swap.
 *
 * The market periphery's swap router is v4-core's stock PoolSwapTest,
 * which carries no `amountOutMinimum` field — the one protection lever
 * that rides in the signed transaction is `SwapParams.sqrtPriceLimitX96`:
 * the PoolManager will not execute past that price, and with exact-input
 * semantics any input it can't fill within the bound stays with the
 * sender. So the min-out contract becomes: *execution price is bounded;
 * if the pool moved beyond tolerance you get a bounded partial fill (or
 * nothing) and keep the rest of your input* — protection in the calldata,
 * not display-only (031 principle).
 *
 * The bound is anchored on the trade's own projected landing price, not
 * the spot price, so a healthy fill's own price impact doesn't trip it:
 *
 *   p_spot = (sqrtPriceX96 / 2^96)²         (token1 per token0)
 *   p_eff  = quoted average execution price (out/in, direction-adjusted)
 *   p_land ≈ 2·p_eff − p_spot               (final marginal price for
 *                                            ~uniform liquidity: the
 *                                            average sits midway between
 *                                            start and end price)
 *   limit  = p_land shifted by ±slippageBps, converted back to sqrt form.
 *
 * All integer math (Q192 fixed point + integer sqrt); clamped inside v4's
 * legal sqrt bounds and kept strictly on the correct side of spot so the
 * PoolManager never rejects the direction.
 */
export function marketSwapSqrtPriceLimit(args: {
  spotSqrtPriceX96: bigint;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOut: bigint;
  slippageBps: number;
}): bigint {
  const { spotSqrtPriceX96, zeroForOne, amountIn, amountOut, slippageBps } = args;
  assertSlippageBounds(slippageBps);
  if (spotSqrtPriceX96 <= 0n) throw new Error("spotSqrtPriceX96 must be positive");
  if (amountIn <= 0n || amountOut <= 0n) throw new Error("quote amounts must be positive");

  const pSpot = spotSqrtPriceX96 * spotSqrtPriceX96; // price in X192
  // Effective price is token1-per-token0 whichever way the swap runs.
  const pEff = zeroForOne ? (amountOut << 192n) / amountIn : (amountIn << 192n) / amountOut;
  // Projected post-fill marginal price; a degenerate (>50% impact) quote
  // projects ≤ 0 — fall back to the direction's extreme (the trade is
  // already consuming most of the pool; the slippage band is meaningless).
  const pLand = 2n * pEff - pSpot;
  if (pLand <= 0n) return zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT;

  const pLimit = zeroForOne
    ? (pLand * BigInt(10_000 - slippageBps)) / 10_000n
    : (pLand * BigInt(10_000 + slippageBps)) / 10_000n;
  let limit = sqrtBigInt(pLimit);

  // Keep the limit strictly on the correct side of spot (v4 rejects a
  // zeroForOne swap whose limit is ≥ current price, and vice versa), and
  // inside the legal sqrt-price range.
  if (zeroForOne) {
    if (limit >= spotSqrtPriceX96) limit = spotSqrtPriceX96 - 1n;
    if (limit < MIN_SQRT_PRICE_LIMIT) limit = MIN_SQRT_PRICE_LIMIT;
  } else {
    if (limit <= spotSqrtPriceX96) limit = spotSqrtPriceX96 + 1n;
    if (limit > MAX_SQRT_PRICE_LIMIT) limit = MAX_SQRT_PRICE_LIMIT;
  }
  return limit;
}

export interface BuiltMarketTrade {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  approvalTarget: `0x${string}` | null;
  inputToken: `0x${string}`;
  marketId: `0x${string}`;
  marketAddress: `0x${string}`;
  yesToken: `0x${string}`;
  /** The price bound encoded in `data` — on-chain slippage protection. */
  sqrtPriceLimitX96: string;
  quote: {
    amountIn: string;
    amountOut: string;
    /** Quote − slippage tolerance; the calldata's price bound enforces
     *  the same tolerance on-chain. */
    amountOutMinimum: string;
    effectivePriceBps: number | null;
  };
}

/**
 * Quote + encode one trade. `direction` "buy" spends USDC for YES;
 * "sell" spends YES for USDC. `amountRaw` is the exact input (6dp).
 * `slippageBps` (default `DEFAULT_SLIPPAGE_BPS`, hard-capped at
 * `MAX_SLIPPAGE_BPS` via `assertSlippageBounds`) becomes the on-chain
 * `sqrtPriceLimitX96` bound in the returned calldata — both directions,
 * same protection.
 */
export async function buildMarketTrade(args: {
  providerEventId: string;
  outcomeIndex: 0 | 1;
  direction: "buy" | "sell";
  amountRaw: bigint;
  chainId?: SupportedChainId;
  slippageBps?: number;
}): Promise<BuiltMarketTrade> {
  const chainId = args.chainId ?? BASE_CHAIN_ID;
  const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  assertSlippageBounds(slippageBps);
  const markets = MARKETS_BY_CHAIN[chainId];
  const periphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
  const dm = DYNAMIC_MARKET_BY_CHAIN[chainId];
  if (!markets || !periphery || !dm) {
    throw new MarketsNotDeployedError(chainId);
  }
  assertUsdcCollateral(chainId, markets.collateral);
  const client = getRpcClient(chainId);
  const marketId = computeMarketId({
    providerEventId: args.providerEventId,
    marketType: "moneyline",
    outcomeIndex: args.outcomeIndex,
    chainId,
  });
  const marketAddress = await client.readContract({
    address: markets.factory,
    abi: MARKET_FACTORY_ABI,
    functionName: "marketOf",
    args: [marketId],
  });
  if (marketAddress === "0x0000000000000000000000000000000000000000") {
    throw new NoMarketError(args.providerEventId);
  }
  const yesToken = await client.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "yesToken",
  });
  const startsAt = await client.readContract({
    address: marketAddress,
    abi: MARKET_STARTS_AT_ABI,
    functionName: "startsAt",
  });
  if (Number(startsAt) <= Math.floor(Date.now() / 1000)) {
    throw new MarketClosedError(args.providerEventId);
  }
  const plan = planMarketPool(yesToken, markets.collateral, dm.hook, 0.5);

  const inputIsYes = args.direction === "sell";
  const zeroForOne = inputIsYes ? plan.yesIsToken0 : !plan.yesIsToken0;
  const inputToken = inputIsYes ? yesToken : markets.collateral;
  const outputToken = inputIsYes ? markets.collateral : yesToken;

  // B7-005 / DM-112 — this pair (YES token on one side) must classify
  // "market-pool"; a cross-over would mean the routing split broke.
  assertSwapRoute("market-pool", inputToken, outputToken, chainId);

  const { result } = await client.simulateContract({
    address: periphery.quoter,
    abi: V4_QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: plan.key, zeroForOne, exactAmount: args.amountRaw, hookData: "0x" }],
  });
  const [amountOut] = result;

  // B7-003 — slippage protection IN the calldata for both directions:
  // derive the sqrt-price bound from the live pool price + this quote,
  // encode it in the swap. A quote without a readable pool price would
  // mean an unbounded swap — fail closed instead.
  const slot0 = await readSlot0(plan.key, chainId);
  if (!slot0) {
    throw new Error(
      `Market pool for game ${args.providerEventId} has no readable price — cannot bound slippage`,
    );
  }
  const sqrtPriceLimitX96 = marketSwapSqrtPriceLimit({
    spotSqrtPriceX96: slot0.sqrtPriceX96,
    zeroForOne,
    amountIn: args.amountRaw,
    amountOut,
    slippageBps,
  });

  const calldata = buildPoolSwapTestCalldata({
    poolKey: plan.key,
    zeroForOne,
    amountInRaw: args.amountRaw,
    chainId,
    sqrtPriceLimitX96,
  });

  const usdc = args.direction === "buy" ? args.amountRaw : amountOut;
  const yes = args.direction === "buy" ? amountOut : args.amountRaw;
  const effectivePriceBps = yes > 0n ? Number((usdc * 10_000n) / yes) : null;

  return {
    ...calldata,
    inputToken,
    marketId,
    marketAddress,
    yesToken,
    sqrtPriceLimitX96: sqrtPriceLimitX96.toString(),
    quote: {
      amountIn: args.amountRaw.toString(),
      amountOut: amountOut.toString(),
      amountOutMinimum: marketMinOut(amountOut, slippageBps).toString(),
      effectivePriceBps,
    },
  };
}
