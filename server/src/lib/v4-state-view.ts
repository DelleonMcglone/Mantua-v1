import { DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { computePoolId } from "./pool-id.ts";
import type { PoolKey } from "./pool-key.ts";
import { getRpcClient } from "./rpc-client.ts";
import { TtlCache } from "./ttl-cache.ts";
import { STATE_VIEW_ABI, getV4StackForHook } from "./v4-contracts.ts";

export interface Slot0 {
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
}

/**
 * Short TTL + in-flight dedup: quote flows, fee-tier resolution, and the
 * max-input probe all re-read the same pool's slot0 in bursts, which was
 * tripping the public RPC's request limit. 5s is fresh enough for
 * pricing while collapsing per-keystroke
 * storms; an uninitialized (null) result is cached briefly too so probing
 * absent pools doesn't hammer the RPC, but a just-created pool shows up
 * within seconds.
 */
const slot0Cache = new TtlCache<Slot0 | null>();
const SLOT0_TTL_MS = 5_000;
const SLOT0_NULL_TTL_MS = 3_000;

/**
 * Read a v4 pool's slot0 (live sqrtPriceX96 + tick) via the StateView
 * lens contract on the given chain. Returns null if the pool is
 * uninitialized (sqrtPriceX96 === 0n) — callers decide whether that's
 * an error.
 */
export async function readSlot0(
  key: PoolKey,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): Promise<Slot0 | null> {
  const poolId = computePoolId(key);
  return slot0Cache.get(
    `${String(chainId)}:${poolId}`,
    async () => {
      // Each hook lives on its own PoolManager + StateView; resolve by the
      // pool's hook (no-hook → hero stack).
      const [sqrtPriceX96, tick, protocolFee, lpFee] = await getRpcClient(chainId).readContract({
        address: getV4StackForHook(key.hooks, chainId).stateView,
        abi: STATE_VIEW_ABI,
        functionName: "getSlot0",
        args: [poolId],
      });
      if (sqrtPriceX96 === 0n) return null;
      return { sqrtPriceX96, tick, protocolFee, lpFee };
    },
    (v) => (v === null ? SLOT0_NULL_TTL_MS : SLOT0_TTL_MS),
  );
}
