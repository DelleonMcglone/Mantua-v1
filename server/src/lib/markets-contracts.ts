import { parseAbi } from "viem";
import { type SupportedChainId } from "./chains.ts";

/**
 * Sports-market settlement layer (MarketFactory + Resolver) and the
 * market-pool v4 periphery, per chain.
 *
 * Base Mainnet deployment pending — see docs/tasks/v2-roadmap.md. Until
 * the contracts are deployed on 8453 the per-chain maps below are empty
 * and every consumer degrades gracefully (market creation/resolution and
 * on-chain market reads are skipped when the deployment is absent).
 */

export interface MarketsDeployment {
  factory: `0x${string}`;
  resolver: `0x${string}`;
  collateral: `0x${string}`;
}

export interface MarketsPeriphery {
  poolSwapTest: `0x${string}` | null;
  poolModifyLiquidityTest: `0x${string}` | null;
  stateView: `0x${string}`;
  quoter: `0x${string}`;
  positionDescriptor: `0x${string}` | null;
  positionManager: `0x${string}`;
}

/** Per-chain markets settlement layer. Base Mainnet deployment pending. */
export const MARKETS_BY_CHAIN: Partial<Record<SupportedChainId, MarketsDeployment>> = {};

/**
 * Per-chain market-pool periphery (the Dynamic Market PoolManager's
 * routers/lens). Base Mainnet deployment pending.
 */
export const MARKETS_PERIPHERY_BY_CHAIN: Partial<Record<SupportedChainId, MarketsPeriphery>> = {};

export const MARKET_FACTORY_ABI = parseAbi([
  "function createMarketIfAbsent(bytes32 marketId, uint64 startsAt, string label) returns (address market, bool created)",
  "function marketOf(bytes32 marketId) view returns (address)",
]);

export const RESOLVER_CONTRACT_ABI = parseAbi([
  "function freeze(bytes32 marketId)",
  "function resolve(bytes32 marketId, uint8 outcome)",
  "function voidMarket(bytes32 marketId)",
]);

export const MARKET_ABI = parseAbi([
  "function yesToken() view returns (address)",
  "function noToken() view returns (address)",
  "function state() view returns (uint8)",
  "function redeem()",
  "function redeemInvalid()",
]);

export const POOL_MANAGER_INIT_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function initialize(PoolKey key, uint160 sqrtPriceX96) returns (int24 tick)",
]);

export const REGISTRY_ABI = parseAbi([
  "function registerPool(bytes32 poolId, uint64 kickoffTimestamp, uint64 resolutionTimestamp, bool yesIsToken0, uint8 outcomeDecimals)",
  "function isRegistered(bytes32 poolId) view returns (bool)",
]);

export const STATE_VIEW_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  "function getPositionLiquidity(bytes32 poolId, bytes32 positionId) view returns (uint128 liquidity)",
]);

export const MARKET_SPLIT_ABI = parseAbi([
  "function split(uint256 amount)",
  "function merge(uint256 amount)",
]);

export const ERC20_APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const LP_ROUTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct ModifyLiquidityParams { int24 tickLower; int24 tickUpper; int256 liquidityDelta; bytes32 salt; }",
  "function modifyLiquidity(PoolKey key, ModifyLiquidityParams params, bytes hookData) payable returns (int256)",
]);
