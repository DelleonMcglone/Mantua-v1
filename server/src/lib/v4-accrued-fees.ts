import { DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { computePoolId } from "./pool-id.ts";
import type { PoolKey } from "./pool-key.ts";
import { getRpcClient } from "./rpc-client.ts";
import { STATE_VIEW_ABI, getV4StackForHook } from "./v4-contracts.ts";

const Q128 = 1n << 128n;
const MAX_UINT256 = (1n << 256n) - 1n;

/** A position's uncollected swap fees, in raw token units (token0/token1). */
export interface AccruedFees {
  amount0: bigint;
  amount1: bigint;
}

/** bytes32(tokenId) — the salt v4 PositionManager keys positions by. */
function toSalt(tokenId: bigint): `0x${string}` {
  return `0x${tokenId.toString(16).padStart(64, "0")}`;
}

/**
 * Read a position's uncollected swap fees from live on-chain v4 state:
 *
 *   feesOwed_i = liquidity * (feeGrowthInside_i - feeGrowthInsideLast_i) / 2^128
 *
 * The subtraction wraps mod 2^256 exactly as v4 stores it (unchecked). Returns
 * zeros for a zero-liquidity / uninitialized position — no fabrication, just
 * what the chain reports. Routes via the position's per-hook StateView.
 */
export async function readAccruedFees(
  key: PoolKey,
  tokenId: bigint,
  tickLower: number,
  tickUpper: number,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): Promise<AccruedFees> {
  const stack = getV4StackForHook(key.hooks, chainId);
  const poolId = computePoolId(key);
  const client = getRpcClient(chainId);

  const [posInfo, feeGrowth] = await Promise.all([
    client.readContract({
      address: stack.stateView,
      abi: STATE_VIEW_ABI,
      functionName: "getPositionInfo",
      args: [poolId, stack.positionManager, tickLower, tickUpper, toSalt(tokenId)],
    }),
    client.readContract({
      address: stack.stateView,
      abi: STATE_VIEW_ABI,
      functionName: "getFeeGrowthInside",
      args: [poolId, tickLower, tickUpper],
    }),
  ]);

  const [liquidity, fg0Last, fg1Last] = posInfo;
  const [fg0, fg1] = feeGrowth;
  if (liquidity === 0n) return { amount0: 0n, amount1: 0n };

  const amount0 = (liquidity * ((fg0 - fg0Last) & MAX_UINT256)) / Q128;
  const amount1 = (liquidity * ((fg1 - fg1Last) & MAX_UINT256)) / Q128;
  return { amount0, amount1 };
}
