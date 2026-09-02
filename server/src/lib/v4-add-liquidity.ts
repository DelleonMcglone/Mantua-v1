import { encodeFunctionData, keccak256, toHex } from "viem";
import { DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { getLiquidityForAmounts } from "./liquidity-math.ts";
import { buildPoolKey } from "./pool-key.ts";
import { getMaxUsableTick, getMinUsableTick, getSqrtRatioAtTick } from "./tick-math.ts";
import { type TokenSymbol } from "./tokens.ts";
import {
  Action,
  encodeActions,
  encodeMintPosition,
  encodeSettlePair,
  encodeSweep,
  encodeUnlockData,
} from "./v4-actions.ts";
import {
  POSITION_MANAGER_MODIFY_LIQUIDITIES_ABI,
  getV4StackForHook,
  type FeeTier,
  type HookName,
} from "./v4-contracts.ts";

const SLIPPAGE_DENOM = 10_000n;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface BuildAddLiquidityArgs {
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  /** Hook bound to the pool. Required for hook-managed pools so the
   *  reconstructed PoolKey matches on-chain (the `hooks` field is the
   *  resolved address; `hookName` drives the dynamic-fee override). */
  hookAddress?: `0x${string}`;
  hookName?: HookName | null;
  amountARaw: bigint;
  amountBRaw: bigint;
  sqrtPriceX96: bigint;
  slippageBps: number;
  owner: `0x${string}`;
  /** ABSOLUTE unix deadline (seconds since epoch), passed verbatim to
   *  modifyLiquidities — NOT a duration. Callers compute `now + N`. */
  deadlineSeconds: number;
  /** Target chain. Routes the calldata to the per-chain PositionManager. */
  chainId?: SupportedChainId;
}

export interface BuildAddLiquidityResult {
  to: `0x${string}`;
  data: `0x${string}`;
  /** ETH value to attach if currency0 or currency1 is native ETH (zero address). */
  value: string;
  liquidity: string;
  amount0Max: string;
  amount1Max: string;
  tickLower: number;
  tickUpper: number;
  poolKeyHash: `0x${string}`;
  /** Sorted tokens — used by the route to compute Permit2 needs. The
   *  zero address (native ETH) is filtered out by the caller. */
  currency0: `0x${string}`;
  currency1: `0x${string}`;
}

/**
 * Build a full-range MINT_POSITION + SETTLE_PAIR (+ SWEEP for native-ETH
 * sides) unlockData for the v4 PositionManager. Liquidity is computed
 * from the user's max amounts at the current sqrtPrice; on-chain the
 * contract pulls at most amount0Max + amount1Max and reverts otherwise.
 */
export function buildAddLiquidityCalldata(args: BuildAddLiquidityArgs): BuildAddLiquidityResult {
  const chainId = args.chainId ?? DEFAULT_CHAIN_ID;
  const { key, flipped } = buildPoolKey(
    args.tokenA,
    args.tokenB,
    args.fee,
    args.hookAddress ?? "0x0000000000000000000000000000000000000000",
    args.hookName ?? null,
    chainId,
  );
  const tickLower = getMinUsableTick(key.tickSpacing);
  const tickUpper = getMaxUsableTick(key.tickSpacing);
  const sqrtLower = getSqrtRatioAtTick(tickLower);
  const sqrtUpper = getSqrtRatioAtTick(tickUpper);

  const amount0Raw = flipped ? args.amountBRaw : args.amountARaw;
  const amount1Raw = flipped ? args.amountARaw : args.amountBRaw;
  const liquidity = getLiquidityForAmounts({
    sqrtPriceCurrentX96: args.sqrtPriceX96,
    sqrtPriceLowerX96: sqrtLower,
    sqrtPriceUpperX96: sqrtUpper,
    amount0: amount0Raw,
    amount1: amount1Raw,
  });
  if (liquidity === 0n) {
    // Two reasons this can fire: (1) one of the amounts is genuinely
    // tiny relative to the other, or (2) the pool was initialized at
    // an extreme sqrtPrice (e.g. MIN_SQRT_PRICE+1) so the math
    // saturates to 0 no matter how much the user supplies. Detect
    // case (2) and surface an actionable message — the only fix is
    // to pick a fee tier whose pool hasn't been initialized yet, so
    // the next create-call seeds it at the user's chosen price.
    const MIN_SQRT = 4_295_128_739n;
    const MAX_SQRT = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
    const nearExtreme =
      args.sqrtPriceX96 - MIN_SQRT < 1_000_000n || MAX_SQRT - args.sqrtPriceX96 < 1_000_000n;
    if (nearExtreme) {
      throw new Error(
        "This pool was initialized at an unusable price. Pick a different fee tier (e.g. 0.05%, 0.30%, or 1.00%) — those pools haven't been initialized yet and will seed at your supplied price.",
      );
    }
    throw new Error("Computed liquidity is zero — increase amounts");
  }

  const slippage = BigInt(args.slippageBps);
  const amount0Max = (amount0Raw * (SLIPPAGE_DENOM + slippage)) / SLIPPAGE_DENOM;
  const amount1Max = (amount1Raw * (SLIPPAGE_DENOM + slippage)) / SLIPPAGE_DENOM;

  const mintParams = encodeMintPosition({
    poolKey: key,
    tickLower,
    tickUpper,
    liquidity,
    amount0Max,
    amount1Max,
    owner: args.owner,
    hookData: "0x",
  });
  const settleParams = encodeSettlePair(key.currency0, key.currency1);

  const nativeSide = key.currency0 === ZERO ? "0" : key.currency1 === ZERO ? "1" : null;
  const ids = nativeSide
    ? [Action.MINT_POSITION, Action.SETTLE_PAIR, Action.SWEEP]
    : [Action.MINT_POSITION, Action.SETTLE_PAIR];
  const params: `0x${string}`[] = [mintParams, settleParams];
  if (nativeSide) params.push(encodeSweep(ZERO, args.owner));

  const unlockData = encodeUnlockData(encodeActions(ids), params);
  const data = encodeFunctionData({
    abi: POSITION_MANAGER_MODIFY_LIQUIDITIES_ABI,
    functionName: "modifyLiquidities",
    args: [unlockData, BigInt(args.deadlineSeconds)],
  });

  const value =
    nativeSide === "0" ? amount0Max.toString() : nativeSide === "1" ? amount1Max.toString() : "0";

  const poolKeyHash = keccak256(
    toHex(
      `${key.currency0}|${key.currency1}|${String(key.fee)}|${String(key.tickSpacing)}|${key.hooks}`,
    ),
  );

  return {
    // Route to the PositionManager for this pool's hook stack.
    to: getV4StackForHook(key.hooks, chainId).positionManager,
    data,
    value,
    liquidity: liquidity.toString(),
    amount0Max: amount0Max.toString(),
    amount1Max: amount1Max.toString(),
    tickLower,
    tickUpper,
    poolKeyHash,
    currency0: key.currency0,
    currency1: key.currency1,
  };
}
