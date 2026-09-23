import { parseAbi } from "viem";
import { BASE_CHAIN_ID, type SupportedChainId } from "./chains.ts";

/**
 * Sports-market settlement layer (MarketFactory + Resolver) and the
 * market-pool v4 periphery, per chain.
 *
 * Base Mainnet: the market-pool periphery is deployed (2026-09-23, H-009);
 * the settlement layer (MarketFactory + Resolver) is not yet, so
 * MARKETS_BY_CHAIN stays empty and every consumer degrades gracefully
 * (market creation/resolution and on-chain market reads are skipped while
 * the settlement deployment is absent).
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

/** Per-chain markets settlement layer. Base Mainnet deployment pending
 *  (contracts/script/DeployMarkets.s.sol). */
export const MARKETS_BY_CHAIN: Partial<Record<SupportedChainId, MarketsDeployment>> = {};

/**
 * Per-chain market-pool periphery (the Dynamic Market PoolManager's
 * routers/lens). Base Mainnet: DeployMarketPeriphery.s.sol against the DM
 * PoolManager, 2026-09-23 — each contract's poolManager()/manager() was
 * checked on-chain to return it.
 */
export const MARKETS_PERIPHERY_BY_CHAIN: Partial<Record<SupportedChainId, MarketsPeriphery>> = {
  [BASE_CHAIN_ID]: {
    poolSwapTest: "0x76578c4EA626bEe114e5B72939e7927eF5f1CAbF",
    poolModifyLiquidityTest: "0x0cd79B383c3f10F786bF9B942F791283dFB4d6e6",
    stateView: "0x8F76Bba1695798E9ddDb0Da6c67c2900fe0f5deF",
    quoter: "0x1791972C76a8Bcb9da83E50B9435612590a0102f",
    positionDescriptor: "0x6A8Ce701aB14a2909F22a18063426fEE016A36da",
    positionManager: "0x17a69A23F3c0F7F0dCA6391f967C020BaC0906da",
  },
};

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
  "function registerPool(bytes32 poolId, uint64 kickoffTimestamp, uint64 resolutionTimestamp, bool yesIsToken0, uint8 outcomeDecimals, bool playoffs)",
  "function isRegistered(bytes32 poolId) view returns (bool)",
]);

/**
 * The Dynamic Market Hook's read surface for the D-105 fee model: `quoteFee`
 * runs the same pricing path as `beforeSwap` (H-012), and every swap emits
 * `MarketFeeUpdated` with the same decomposition (H-011).
 */
export const DYNAMIC_MARKET_HOOK_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "struct Breakdown { uint24 minRate; uint24 liquidityPremium; uint24 volatilityPremium; uint24 activityPremium; uint24 uncertaintyPremium; uint24 rate; uint16 probabilityBps; bool playoffs; bool stale; }",
  "function quoteFee(PoolKey key, SwapParams params) view returns (uint24 fee, Breakdown breakdown, uint256 notional, uint256 cap)",
  "event MarketFeeUpdated(bytes32 indexed poolId, Breakdown breakdown, uint24 effectiveFee)",
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
