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
import { buildPoolSwapTestCalldata } from "../v4-onchain-swap.ts";
import { DYNAMIC_MARKET_BY_CHAIN } from "../v4-contracts.ts";
import {
  MARKETS_BY_CHAIN,
  MARKETS_PERIPHERY_BY_CHAIN,
  MARKET_ABI,
  MARKET_FACTORY_ABI,
} from "../markets-contracts.ts";
import { planMarketPool } from "./market-pool.ts";

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

export interface BuiltMarketTrade {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  approvalTarget: `0x${string}` | null;
  inputToken: `0x${string}`;
  marketId: `0x${string}`;
  marketAddress: `0x${string}`;
  yesToken: `0x${string}`;
  quote: { amountIn: string; amountOut: string; effectivePriceBps: number | null };
}

/**
 * Quote + encode one trade. `direction` "buy" spends USDC for YES;
 * "sell" spends YES for USDC. `amountRaw` is the exact input (6dp).
 */
export async function buildMarketTrade(args: {
  providerEventId: string;
  outcomeIndex: 0 | 1;
  direction: "buy" | "sell";
  amountRaw: bigint;
  chainId?: SupportedChainId;
}): Promise<BuiltMarketTrade> {
  const chainId = args.chainId ?? BASE_CHAIN_ID;
  const markets = MARKETS_BY_CHAIN[chainId];
  const periphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
  const dm = DYNAMIC_MARKET_BY_CHAIN[chainId];
  if (!markets || !periphery || !dm) {
    throw new Error(`Sports markets are not deployed on chain ${String(chainId)}`);
  }
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

  const { result } = await client.simulateContract({
    address: periphery.quoter,
    abi: V4_QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: plan.key, zeroForOne, exactAmount: args.amountRaw, hookData: "0x" }],
  });
  const [amountOut] = result;

  const calldata = buildPoolSwapTestCalldata({
    poolKey: plan.key,
    zeroForOne,
    amountInRaw: args.amountRaw,
    chainId,
  });

  const usdc = args.direction === "buy" ? args.amountRaw : amountOut;
  const yes = args.direction === "buy" ? amountOut : args.amountRaw;
  const effectivePriceBps = yes > 0n ? Number((usdc * 10_000n) / yes) : null;

  return {
    ...calldata,
    inputToken: inputIsYes ? yesToken : markets.collateral,
    marketId,
    marketAddress,
    yesToken,
    quote: {
      amountIn: args.amountRaw.toString(),
      amountOut: amountOut.toString(),
      effectivePriceBps,
    },
  };
}
