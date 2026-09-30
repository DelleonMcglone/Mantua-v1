/**
 * Test-only: give a chain a synthetic canonical Uniswap v4 stack and put
 * it back. Arc has none (v4-contracts.ts), so the base-pair swap and
 * liquidity encoders — pure calldata builders — are exercised against
 * synthetic addresses here rather than deleted.
 */
import { DEFAULT_CHAIN_ID, type SupportedChainId } from "../chains.ts";
import { CANONICAL_V4_BY_CHAIN, type V4Addresses } from "../v4-contracts.ts";
import { UNIVERSAL_ROUTER_BY_CHAIN } from "../v4-universal-router.ts";

/** Synthetic stack (the retired canonical Base addresses — any addresses do). */
export const SYNTHETIC_CANONICAL_V4: V4Addresses = {
  poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
  positionManager: "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
  stateView: "0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71",
  quoter: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",
  poolSwapTest: null,
};
export const SYNTHETIC_UNIVERSAL_ROUTER = "0x6fF5693b99212Da76ad316178A184AB56D299b43" as const;

/** Install the synthetic stack; returns the restore function. */
export function overrideCanonicalV4(
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
  v4: V4Addresses = SYNTHETIC_CANONICAL_V4,
  router: `0x${string}` | null = SYNTHETIC_UNIVERSAL_ROUTER,
): () => void {
  const prevV4 = CANONICAL_V4_BY_CHAIN[chainId];
  const prevRouter = UNIVERSAL_ROUTER_BY_CHAIN[chainId];
  CANONICAL_V4_BY_CHAIN[chainId] = v4;
  UNIVERSAL_ROUTER_BY_CHAIN[chainId] = router;
  return () => {
    if (prevV4 === undefined) Reflect.deleteProperty(CANONICAL_V4_BY_CHAIN, chainId);
    else CANONICAL_V4_BY_CHAIN[chainId] = prevV4;
    UNIVERSAL_ROUTER_BY_CHAIN[chainId] = prevRouter;
  };
}
