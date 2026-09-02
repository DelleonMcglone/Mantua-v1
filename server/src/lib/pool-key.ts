import { type SupportedChainId } from "./chains.ts";
import { getToken, ZERO_ADDRESS, type TokenSymbol } from "./tokens.ts";
import {
  DEFAULT_CHAIN_ID,
  TICK_SPACING_BY_FEE,
  effectivePoolFee,
  type FeeTier,
  type HookName,
} from "./v4-contracts.ts";

/**
 * v4 PoolKey — addresses must be sorted ascending. Native currency
 * (ETH) is encoded as the zero address.
 */
export interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

const NO_HOOK = ZERO_ADDRESS;

/**
 * Build a v4 PoolKey from token symbols + fee tier. Sorts the two
 * tokens ascending (currency0 < currency1) per v4 invariant. Native
 * ETH (zero address) sorts before any ERC-20.
 *
 * `hookName` is optional but should be passed any time the caller
 * knows which Mantua hook is bound to the pool. Stable Protection
 * and Dynamic Fee both require the v4 dynamic-fee flag (`0x800000`)
 * in `key.fee`, regardless of which static tier the user picked —
 * `effectivePoolFee` makes the swap. The static tier still drives
 * `tickSpacing`, so the user's choice of "0.01%" still means tick
 * spacing 1 even when fee is overridden.
 */
export function buildPoolKey(
  symA: TokenSymbol,
  symB: TokenSymbol,
  fee: FeeTier,
  hook: `0x${string}` = NO_HOOK,
  hookName: HookName | null = null,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): { key: PoolKey; flipped: boolean } {
  if (symA === symB) throw new Error("Cannot create a pool with identical tokens");
  const a = getToken(symA, chainId);
  const b = getToken(symB, chainId);
  const addrA = (a.native ? ZERO_ADDRESS : a.address).toLowerCase() as `0x${string}`;
  const addrB = (b.native ? ZERO_ADDRESS : b.address).toLowerCase() as `0x${string}`;
  const flipped = addrA > addrB;
  const [currency0, currency1] = flipped ? [addrB, addrA] : [addrA, addrB];
  return {
    flipped,
    key: {
      currency0,
      currency1,
      fee: effectivePoolFee(hookName, fee),
      tickSpacing: TICK_SPACING_BY_FEE[fee],
      hooks: hook,
    },
  };
}
