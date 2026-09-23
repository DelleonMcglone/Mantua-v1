/**
 * Test-only: swap the per-chain market registries and put them back.
 *
 * Base carries the real Dynamic Market, periphery, and settlement entries.
 * Tests that exercise the gated "not deployed" state, or route through a
 * synthetic stack, replace entries here and MUST restore the previous
 * value — deleting it instead would leave later tests in the same process
 * running against a registry that no longer matches the repo.
 */
import { BASE_CHAIN_ID, type SupportedChainId } from "../chains.ts";
import {
  MARKETS_BY_CHAIN,
  MARKETS_PERIPHERY_BY_CHAIN,
  type MarketsDeployment,
  type MarketsPeriphery,
} from "../markets-contracts.ts";
import { DYNAMIC_MARKET_BY_CHAIN, type DynamicMarketDeployment } from "../v4-contracts.ts";

/** `undefined` = the chain has no entry (the gated state). Omitted keys
 *  are left as they are. */
export interface MarketsRegistryOverride {
  markets?: MarketsDeployment | undefined;
  periphery?: MarketsPeriphery | undefined;
  dm?: DynamicMarketDeployment | undefined;
}

function put<T>(
  map: Partial<Record<SupportedChainId, T>>,
  chainId: SupportedChainId,
  v: T | undefined,
) {
  if (v === undefined) Reflect.deleteProperty(map, chainId);
  else map[chainId] = v;
}

/** Apply `override` and return a function that restores what was there. */
export function overrideMarketsRegistry(
  override: MarketsRegistryOverride,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): () => void {
  const prev = {
    markets: MARKETS_BY_CHAIN[chainId],
    periphery: MARKETS_PERIPHERY_BY_CHAIN[chainId],
    dm: DYNAMIC_MARKET_BY_CHAIN[chainId],
  };
  if ("markets" in override) put(MARKETS_BY_CHAIN, chainId, override.markets);
  if ("periphery" in override) put(MARKETS_PERIPHERY_BY_CHAIN, chainId, override.periphery);
  if ("dm" in override) put(DYNAMIC_MARKET_BY_CHAIN, chainId, override.dm);
  return () => {
    put(MARKETS_BY_CHAIN, chainId, prev.markets);
    put(MARKETS_PERIPHERY_BY_CHAIN, chainId, prev.periphery);
    put(DYNAMIC_MARKET_BY_CHAIN, chainId, prev.dm);
  };
}

/** The full gated state: no settlement layer, periphery, or DM stack. */
export const UNDEPLOYED: MarketsRegistryOverride = {
  markets: undefined,
  periphery: undefined,
  dm: undefined,
};
