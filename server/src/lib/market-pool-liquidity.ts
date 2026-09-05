/**
 * B7-004 — market-pool addressing for the liquidity add/remove routes.
 *
 * A market pool is the YES/USDC pool a sports market trades on. It lives
 * on the Dynamic Market v4 stack (its own PoolManager + periphery), NOT
 * the canonical Base stack — so a liquidity action against one must
 * resolve contracts via `getV4StackForHook(dm.hook)` (DM-112), never the
 * default stack.
 *
 * The named B7 failure condition this module exists to prevent: a
 * liquidity action against a market pool that is not deployed must
 * surface the GATED state — a typed error the routes turn into a
 * structured `gated: true` response — never succeed and never fall
 * through to an opaque revert on the wrong stack.
 */

import { type SupportedChainId } from "./chains.ts";
import { computeMarketId } from "./market-id.ts";
import {
  MARKETS_BY_CHAIN,
  MARKETS_PERIPHERY_BY_CHAIN,
  MARKET_ABI,
  MARKET_FACTORY_ABI,
  type MarketsDeployment,
  type MarketsPeriphery,
} from "./markets-contracts.ts";
import { getRpcClient } from "./rpc-client.ts";
import { assertUsdcCollateral } from "./sports/market-trade-build.ts";
import { planMarketPool, type MarketPoolKey } from "./sports/market-pool.ts";
import {
  DYNAMIC_MARKET_BY_CHAIN,
  getV4StackForHook,
  type DynamicMarketDeployment,
} from "./v4-contracts.ts";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/**
 * The market-pool stack (settlement + DM v4 stack) is not configured on
 * this chain — the gated state. Routes map this to HTTP 409 with
 * `code: "MARKET_POOLS_NOT_DEPLOYED"` and `gated: true` so the client
 * renders the gate instead of a raw failure.
 */
export class MarketLiquidityGatedError extends Error {
  readonly code = "MARKET_POOLS_NOT_DEPLOYED";
  constructor(chainId: SupportedChainId) {
    super(
      `Market pools are not live on chain ${String(chainId)} yet — ` +
        `liquidity on market pools opens once the Dynamic Market stack is deployed.`,
    );
    this.name = "MarketLiquidityGatedError";
  }
}

/** The stack is configured but no market exists for this game/outcome. */
export class MarketLiquidityNotFoundError extends Error {
  readonly code = "NO_MARKET";
  constructor(providerEventId: string) {
    super(`No market for game ${providerEventId}`);
    this.name = "MarketLiquidityNotFoundError";
  }
}

interface MarketPoolDeployments {
  markets: MarketsDeployment;
  periphery: MarketsPeriphery;
  dm: DynamicMarketDeployment;
}

/**
 * The gate itself, separated so both routes (and tests) hit the exact
 * same check: returns the three deployment records or throws the typed
 * gated error when any of them is absent on `chainId`.
 */
export function assertMarketPoolsDeployed(chainId: SupportedChainId): MarketPoolDeployments {
  const markets = MARKETS_BY_CHAIN[chainId];
  const periphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
  const dm = DYNAMIC_MARKET_BY_CHAIN[chainId];
  if (!markets || !periphery || !dm) {
    throw new MarketLiquidityGatedError(chainId);
  }
  return { markets, periphery, dm };
}

export interface MarketPoolLiquidityContext {
  marketId: `0x${string}`;
  marketAddress: `0x${string}`;
  yesToken: `0x${string}`;
  /** Canonical USDC (asserted) — the market's collateral/quote side. */
  collateral: `0x${string}`;
  /** The on-chain PoolKey of the YES/USDC pool (DM hook, dynamic fee). */
  key: MarketPoolKey;
  yesIsToken0: boolean;
  /** The DM stack's PositionManager — resolved per getV4StackForHook. */
  positionManager: `0x${string}`;
}

/**
 * Resolve everything a liquidity action needs to address one market's
 * YES/USDC pool. Throws:
 *  - `MarketLiquidityGatedError` when the DM stack isn't deployed (the
 *    gated state — checked FIRST, before any RPC);
 *  - `MarketLiquidityNotFoundError` when the factory has no market for
 *    the game/outcome.
 */
export async function resolveMarketPoolLiquidity(args: {
  providerEventId: string;
  outcomeIndex: 0 | 1;
  chainId: SupportedChainId;
}): Promise<MarketPoolLiquidityContext> {
  const { markets, dm } = assertMarketPoolsDeployed(args.chainId);
  assertUsdcCollateral(args.chainId, markets.collateral);

  const client = getRpcClient(args.chainId);
  const marketId = computeMarketId({
    providerEventId: args.providerEventId,
    marketType: "moneyline",
    outcomeIndex: args.outcomeIndex,
    chainId: args.chainId,
  });
  const marketAddress = await client.readContract({
    address: markets.factory,
    abi: MARKET_FACTORY_ABI,
    functionName: "marketOf",
    args: [marketId],
  });
  if (marketAddress === ZERO_ADDR) {
    throw new MarketLiquidityNotFoundError(args.providerEventId);
  }
  const yesToken = await client.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "yesToken",
  });
  // Opening probability only matters for seeding; liquidity flows read the
  // live price from slot0, so the plan is used purely for key construction.
  const plan = planMarketPool(yesToken, markets.collateral, dm.hook, 0.5);

  return {
    marketId,
    marketAddress,
    yesToken,
    collateral: markets.collateral,
    key: plan.key,
    yesIsToken0: plan.yesIsToken0,
    positionManager: getV4StackForHook(dm.hook, args.chainId).positionManager,
  };
}
