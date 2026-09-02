import { encodeAbiParameters, encodeFunctionData } from "viem";
import { getAmountsForLiquidity } from "./amounts-for-liquidity.ts";
import { getSqrtRatioAtTick } from "./tick-math.ts";
import { Action, encodeActions, encodeSweep, encodeUnlockData } from "./v4-actions.ts";
import type { SupportedChainId } from "./chains.ts";
import { POSITION_MANAGER_MODIFY_LIQUIDITIES_ABI, getV4StackForHook } from "./v4-contracts.ts";

const SLIPPAGE_DENOM = 10_000n;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface BuildRemoveLiquidityArgs {
  /** Target chain — picks the right PositionManager. Defaults to Base. */
  chainId?: SupportedChainId;
  tokenId: bigint;
  liquidityToRemove: bigint;
  positionLiquidity: bigint;
  tickLower: number;
  tickUpper: number;
  sqrtPriceX96: bigint;
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  /** The position's pool hook — routes to that hook's PositionManager
   *  (null / omitted → the default hero stack). */
  hookAddress?: `0x${string}` | null;
  slippageBps: number;
  recipient: `0x${string}`;
  deadlineSeconds: number;
}

export interface BuildRemoveLiquidityResult {
  to: `0x${string}`;
  data: `0x${string}`;
  amount0Min: string;
  amount1Min: string;
  amount0Estimate: string;
  amount1Estimate: string;
  isFullExit: boolean;
}

/** DECREASE_LIQUIDITY params: (tokenId, liquidity, amount0Min, amount1Min, hookData) */
function encodeDecrease(
  tokenId: bigint,
  liquidity: bigint,
  amount0Min: bigint,
  amount1Min: bigint,
): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "bytes" },
    ],
    [tokenId, liquidity, amount0Min, amount1Min, "0x"],
  );
}

/** BURN_POSITION params: (tokenId, amount0Min, amount1Min, hookData) */
function encodeBurn(tokenId: bigint, amount0Min: bigint, amount1Min: bigint): `0x${string}` {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
    [tokenId, amount0Min, amount1Min, "0x"],
  );
}

/** TAKE_PAIR params: (currency0, currency1, recipient) */
function encodeTakePair(
  c0: `0x${string}`,
  c1: `0x${string}`,
  recipient: `0x${string}`,
): `0x${string}` {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [c0, c1, recipient],
  );
}

export function buildRemoveLiquidityCalldata(
  args: BuildRemoveLiquidityArgs,
): BuildRemoveLiquidityResult {
  if (args.liquidityToRemove <= 0n || args.liquidityToRemove > args.positionLiquidity) {
    throw new Error("Invalid liquidity amount");
  }
  const isFullExit = args.liquidityToRemove === args.positionLiquidity;

  const sqrtLower = getSqrtRatioAtTick(args.tickLower);
  const sqrtUpper = getSqrtRatioAtTick(args.tickUpper);
  const { amount0, amount1 } = getAmountsForLiquidity({
    sqrtPriceCurrentX96: args.sqrtPriceX96,
    sqrtPriceLowerX96: sqrtLower,
    sqrtPriceUpperX96: sqrtUpper,
    liquidity: args.liquidityToRemove,
  });

  const slippage = BigInt(args.slippageBps);
  const amount0Min = (amount0 * (SLIPPAGE_DENOM - slippage)) / SLIPPAGE_DENOM;
  const amount1Min = (amount1 * (SLIPPAGE_DENOM - slippage)) / SLIPPAGE_DENOM;

  const decreaseOrBurn = isFullExit
    ? encodeBurn(args.tokenId, amount0Min, amount1Min)
    : encodeDecrease(args.tokenId, args.liquidityToRemove, amount0Min, amount1Min);

  const takePair = encodeTakePair(args.currency0, args.currency1, args.recipient);

  // Add SWEEP for native-ETH side so dust gets refunded.
  const nativeSide = args.currency0 === ZERO ? "0" : args.currency1 === ZERO ? "1" : null;
  const ids = nativeSide
    ? [
        isFullExit ? Action.BURN_POSITION : Action.DECREASE_LIQUIDITY,
        Action.TAKE_PAIR,
        Action.SWEEP,
      ]
    : [isFullExit ? Action.BURN_POSITION : Action.DECREASE_LIQUIDITY, Action.TAKE_PAIR];

  const params: `0x${string}`[] = [decreaseOrBurn, takePair];
  if (nativeSide) params.push(encodeSweep(ZERO, args.recipient));

  const unlockData = encodeUnlockData(encodeActions(ids), params);
  const data = encodeFunctionData({
    abi: POSITION_MANAGER_MODIFY_LIQUIDITIES_ABI,
    functionName: "modifyLiquidities",
    args: [unlockData, BigInt(args.deadlineSeconds)],
  });

  return {
    to: getV4StackForHook(args.hookAddress ?? ZERO, args.chainId).positionManager,
    data,
    amount0Min: amount0Min.toString(),
    amount1Min: amount1Min.toString(),
    amount0Estimate: amount0.toString(),
    amount1Estimate: amount1.toString(),
    isFullExit,
  };
}

/**
 * Build calldata to COLLECT a position's accrued swap fees without touching
 * its liquidity. In v4 a `DECREASE_LIQUIDITY` of zero settles the owed fees
 * into the caller's delta; `TAKE_PAIR` then transfers them to the recipient.
 * Routes to the per-hook PositionManager (null hook → hero stack).
 */
export function buildCollectFeesCalldata(args: {
  tokenId: bigint;
  /** Target chain — picks the right PositionManager. Defaults to Base. */
  chainId?: SupportedChainId;
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  hookAddress?: `0x${string}` | null;
  recipient: `0x${string}`;
  deadlineSeconds: number;
}): { to: `0x${string}`; data: `0x${string}`; value: string } {
  const decrease = encodeDecrease(args.tokenId, 0n, 0n, 0n);
  const takePair = encodeTakePair(args.currency0, args.currency1, args.recipient);

  // App pools use ERC-20 tokens, never the native sentinel, so there's
  // normally no SWEEP leg — but keep the guard in case a native-side pool exists.
  const nativeSide = args.currency0 === ZERO ? "0" : args.currency1 === ZERO ? "1" : null;
  const ids = nativeSide
    ? [Action.DECREASE_LIQUIDITY, Action.TAKE_PAIR, Action.SWEEP]
    : [Action.DECREASE_LIQUIDITY, Action.TAKE_PAIR];
  const params: `0x${string}`[] = [decrease, takePair];
  if (nativeSide) params.push(encodeSweep(ZERO, args.recipient));

  const unlockData = encodeUnlockData(encodeActions(ids), params);
  const data = encodeFunctionData({
    abi: POSITION_MANAGER_MODIFY_LIQUIDITIES_ABI,
    functionName: "modifyLiquidities",
    args: [unlockData, BigInt(args.deadlineSeconds)],
  });

  return {
    to: getV4StackForHook(args.hookAddress ?? ZERO, args.chainId).positionManager,
    data,
    value: "0",
  };
}
