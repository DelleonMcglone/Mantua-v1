/**
 * Uniswap v4 contract addresses, per chain.
 *
 * Runtime per-chain registry: addresses are keyed by chainId; callers
 * pass `chainId` explicitly. Legacy single-chain exports
 * (V4_POOL_MANAGER, etc.) point at the Arc Mainnet entry for code paths
 * not yet migrated — new code MUST use the per-chain getters.
 *
 * Arc Mainnet has NO canonical Uniswap v4 deployment (checked 2026-09-29
 * against docs.arc.io/arc/references/contract-addresses): the only v4
 * stack on Arc is Mantua's own Dynamic Market PoolManager and periphery
 * (`DYNAMIC_MARKET_BY_CHAIN`, `MARKETS_PERIPHERY_BY_CHAIN`), so the
 * canonical getters throw a typed `V4StackNotDeployedError` and every
 * base-pair (non-market) path degrades on it.
 */
import { env } from "../env.ts";
import { ARC_CHAIN_ID, DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { MARKETS_PERIPHERY_BY_CHAIN } from "./markets-contracts.ts";

export interface V4Addresses {
  poolManager: `0x${string}`;
  positionManager: `0x${string}`;
  stateView: `0x${string}`;
  quoter: `0x${string}`;
  /** v4-core's PoolSwapTest helper — null when the chain doesn't ship one. */
  poolSwapTest: `0x${string}` | null;
}

/** No canonical Uniswap v4 stack exists on Arc; the map stays empty.
 *  Exported (mutable) only for `lib/testing/canonical-v4.ts`. */
export const CANONICAL_V4_BY_CHAIN: Partial<Record<SupportedChainId, V4Addresses>> = {};

/** The chain carries no canonical Uniswap v4 stack — a gated state. */
export class V4StackNotDeployedError extends Error {
  constructor(chainId: SupportedChainId) {
    super(
      `No canonical Uniswap v4 stack on chain ${String(chainId)} — base-pair swaps are unavailable.`,
    );
    this.name = "V4StackNotDeployedError";
  }
}

export function hasCanonicalV4(chainId: SupportedChainId): boolean {
  return CANONICAL_V4_BY_CHAIN[chainId] !== undefined;
}

export function getV4Addresses(chainId: SupportedChainId): V4Addresses {
  const v4 = CANONICAL_V4_BY_CHAIN[chainId];
  if (!v4) throw new V4StackNotDeployedError(chainId);
  return v4;
}

export function getV4PoolManager(chainId: SupportedChainId): `0x${string}` {
  return getV4Addresses(chainId).poolManager;
}
export function getV4PositionManager(chainId: SupportedChainId): `0x${string}` {
  return getV4Addresses(chainId).positionManager;
}
export function getV4StateView(chainId: SupportedChainId): `0x${string}` {
  return getV4Addresses(chainId).stateView;
}
export function getV4Quoter(chainId: SupportedChainId): `0x${string}` {
  return getV4Addresses(chainId).quoter;
}
export function getPoolSwapTest(chainId: SupportedChainId): `0x${string}` | null {
  return getV4Addresses(chainId).poolSwapTest;
}

/** Uniswap's UniversalRouter — none on Arc (no canonical v4), so null. */
export const UNIVERSAL_ROUTER: `0x${string}` | null = null;

/** Canonical Permit2 — same address on every chain (deterministic deploy). */
export const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3" as const;

/**
 * Mantua hook addresses. Two hooks:
 *  - Stable Protection — USDC/EURC FX-rate-aware peg defense.
 *  - Dynamic Fee — volatile pairs (cirBTC), fee scales with volatility.
 *
 * Arc Mainnet deployment pending — see docs/tasks/v2-roadmap.md. Until
 * the hooks are deployed on 5042 the addresses are `null` (overridable
 * via `STABLE_PROTECTION_HOOK_ADDRESS` / `DYNAMIC_FEE_HOOK_ADDRESS`);
 * every consumer degrades gracefully on `null` (hook-gated pools simply
 * don't resolve).
 */
const STABLE_PROTECTION_BY_CHAIN: Record<SupportedChainId, `0x${string}` | null> = {
  [ARC_CHAIN_ID]: env.STABLE_PROTECTION_HOOK_ADDRESS ?? null,
};
const DYNAMIC_FEE_BY_CHAIN: Record<SupportedChainId, `0x${string}` | null> = {
  [ARC_CHAIN_ID]: env.DYNAMIC_FEE_HOOK_ADDRESS ?? null,
};
export const HOOK_NAMES = ["stable-protection", "dynamic-fee"] as const;
export type HookName = (typeof HOOK_NAMES)[number];

export { DEFAULT_CHAIN_ID };

export function getHookAddress(
  name: HookName,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): `0x${string}` | null {
  switch (name) {
    case "stable-protection":
      return STABLE_PROTECTION_BY_CHAIN[chainId];
    case "dynamic-fee":
      return DYNAMIC_FEE_BY_CHAIN[chainId];
  }
}

/**
 * Per-hook deployment manifest — the hook address plus the v4 helper
 * routers its pools use. Arc Mainnet deployment pending — see
 * docs/tasks/v2-roadmap.md; fields stay `null` until the hooks (and a
 * liquidity router bound to the canonical PoolManager) are deployed, and
 * consumers degrade gracefully on `null`.
 */
export interface HookDeployment {
  readonly hook: `0x${string}` | null;
  readonly poolSwapTest: `0x${string}` | null;
  readonly poolModifyLiquidityTest: `0x${string}` | null;
}

export const HOOK_DEPLOYMENTS: Record<
  SupportedChainId,
  Readonly<Record<HookName, HookDeployment>>
> = {
  [ARC_CHAIN_ID]: {
    "stable-protection": {
      hook: env.STABLE_PROTECTION_HOOK_ADDRESS ?? null,
      poolSwapTest: null,
      poolModifyLiquidityTest: null,
    },
    "dynamic-fee": {
      hook: env.DYNAMIC_FEE_HOOK_ADDRESS ?? null,
      poolSwapTest: null,
      poolModifyLiquidityTest: null,
    },
  },
};

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/**
 * Resolve the full v4 stack (PoolManager + periphery) for a pool by its
 * HOOK ADDRESS — i.e. `PoolKey.hooks`.
 *
 * On Arc Mainnet every Mantua hook targets the canonical PoolManager,
 * so hook pools and no-hook pools all resolve to the canonical stack.
 * The one exception is the Dynamic Market hook (sports markets), whose
 * pools route to the market periphery on the DM PoolManager (DM-112).
 */
export function getV4StackForHook(
  hookAddress: string,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): V4Addresses {
  const lower = hookAddress.toLowerCase();
  if (lower === ZERO_ADDR) return getV4Addresses(chainId);
  // Dynamic Market Hook — market pools route to the market periphery
  // (DM-112: market pools route directly). Registered here so the shared
  // quote/calldata builders work on market pools without special-casing.
  const dm = DYNAMIC_MARKET_BY_CHAIN[chainId];
  const dmPeriphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
  if (dm && dmPeriphery && lower === dm.hook.toLowerCase()) {
    return {
      poolManager: dm.poolManager,
      positionManager: dmPeriphery.positionManager,
      stateView: dmPeriphery.stateView,
      quoter: dmPeriphery.quoter,
      poolSwapTest: dmPeriphery.poolSwapTest,
    };
  }
  return getV4Addresses(chainId);
}

/** Legacy single-chain exports. Prefer `getHookAddress(name, chainId)`. */
export const STABLE_PROTECTION_HOOK: `0x${string}` | null =
  STABLE_PROTECTION_BY_CHAIN[ARC_CHAIN_ID];
export const DYNAMIC_FEE_HOOK: `0x${string}` | null = DYNAMIC_FEE_BY_CHAIN[ARC_CHAIN_ID];

/**
 * v4 PoolKey hook permission flags encoded in the lower 14 bits of each
 * hook's address (see Hooks.sol). Useful for sanity-checking that a
 * resolved hook address actually implements the lifecycle callbacks the
 * caller expects. Values match `npm run verify:hooks` output.
 */
export const HOOK_PERMISSIONS: Record<HookName, readonly string[]> = {
  "stable-protection": ["BEFORE_INITIALIZE", "BEFORE_SWAP", "AFTER_SWAP"],
  "dynamic-fee": ["BEFORE_SWAP", "AFTER_SWAP"],
} as const;

/**
 * v4 dynamic-fee flag. Set in the high bit of the uint24 `fee` field
 * to signal that the hook (not a fixed tier) supplies the per-swap
 * fee in `beforeSwap`. v4-core: `LPFeeLibrary.isDynamicFee`.
 */
export const DYNAMIC_FEE_FLAG = 0x800000;

/**
 * Hooks whose `beforeInitialize` callback enforces
 * `key.fee.isDynamicFee()`. Pool creation with one of these hooks must
 * set `key.fee = DYNAMIC_FEE_FLAG` regardless of which static tier the
 * user picked in the UI; the static tier still picks `tickSpacing`.
 */
export const HOOK_REQUIRES_DYNAMIC_FEE: Record<HookName, boolean> = {
  "stable-protection": true, // SP pool: tickSpacing 1, dynamic fee (repo README)
  "dynamic-fee": true, // fee scales with volatility
};

/**
 * Resolve the actual `fee` field to encode in the PoolKey. When the
 * hook requires dynamic fees, returns `DYNAMIC_FEE_FLAG`; otherwise
 * returns the user's static fee tier as-is.
 */
export function effectivePoolFee(hook: HookName | null | undefined, staticFee: number): number {
  if (hook && HOOK_REQUIRES_DYNAMIC_FEE[hook]) return DYNAMIC_FEE_FLAG;
  return staticFee;
}

/** Standard v4 fee tiers (fee in pips: 1 pip = 0.01 bps = 0.0001%). */
export const FEE_TIERS = {
  STABLE: 100, // 0.01%
  LOW: 500, // 0.05%
  MEDIUM: 3_000, // 0.30%
  HIGH: 10_000, // 1.00%
} as const;

export type FeeTier = (typeof FEE_TIERS)[keyof typeof FEE_TIERS];

export const FEE_TIER_LABELS: Record<FeeTier, string> = {
  100: "0.01%",
  500: "0.05%",
  3000: "0.30%",
  10000: "1.00%",
};

/** Canonical tickSpacing per v4 fee tier. */
export const TICK_SPACING_BY_FEE: Record<FeeTier, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

export function isFeeTier(n: number): n is FeeTier {
  return n === 100 || n === 500 || n === 3000 || n === 10000;
}

/**
 * v4-periphery `V4Quoter.quoteExactInputSingle` — returns the simulated
 * output amount for a single-pool exact-in swap. Non-view but called
 * via `eth_call`, which is fine because the contract reverts at the
 * end of its internal swap simulation; the public wrapper catches that
 * and returns the captured `(amountOut, gasEstimate)`.
 */
export const V4_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple",
        name: "params",
        components: [
          {
            type: "tuple",
            name: "poolKey",
            components: [
              { type: "address", name: "currency0" },
              { type: "address", name: "currency1" },
              { type: "uint24", name: "fee" },
              { type: "int24", name: "tickSpacing" },
              { type: "address", name: "hooks" },
            ],
          },
          { type: "bool", name: "zeroForOne" },
          { type: "uint128", name: "exactAmount" },
          { type: "bytes", name: "hookData" },
        ],
      },
    ],
    outputs: [
      { type: "uint256", name: "amountOut" },
      { type: "uint256", name: "gasEstimate" },
    ],
  },
] as const;

/**
 * v4-core `PoolSwapTest.swap` — helper-router swap path. The canonical
 * mainnet stack ships no PoolSwapTest (see `poolSwapTest: null`); this
 * ABI serves deployments that provide their own router (e.g. the market
 * periphery). `testSettings.takeClaims = false` and `settleUsingBurn =
 * false` make the swap behave like a normal user swap (input/output flow
 * through standard ERC-20 transfers, ETH via msg.value). Caller must
 * approve the input ERC-20 to the router first; native ETH is forwarded
 * as `value`.
 */
export const POOL_SWAP_TEST_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        name: "key",
        components: [
          { type: "address", name: "currency0" },
          { type: "address", name: "currency1" },
          { type: "uint24", name: "fee" },
          { type: "int24", name: "tickSpacing" },
          { type: "address", name: "hooks" },
        ],
      },
      {
        type: "tuple",
        name: "params",
        components: [
          { type: "bool", name: "zeroForOne" },
          { type: "int256", name: "amountSpecified" },
          { type: "uint160", name: "sqrtPriceLimitX96" },
        ],
      },
      {
        type: "tuple",
        name: "testSettings",
        components: [
          { type: "bool", name: "takeClaims" },
          { type: "bool", name: "settleUsingBurn" },
        ],
      },
      { type: "bytes", name: "hookData" },
    ],
    outputs: [{ type: "int256", name: "delta" }],
  },
] as const;

/**
 * v4 PoolManager.initialize ABI fragment. The full PoolManager has many
 * functions; we only need this one for pool creation.
 */
export const POOL_MANAGER_INITIALIZE_ABI = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple",
        name: "key",
        components: [
          { type: "address", name: "currency0" },
          { type: "address", name: "currency1" },
          { type: "uint24", name: "fee" },
          { type: "int24", name: "tickSpacing" },
          { type: "address", name: "hooks" },
        ],
      },
      { type: "uint160", name: "sqrtPriceX96" },
    ],
    outputs: [{ type: "int24", name: "tick" }],
  },
] as const;

/**
 * v4 PositionManager ABI fragments — modifyLiquidities is the unlocked
 * action entrypoint; permitBatch wraps Permit2.permit so the batch can
 * be applied atomically with modifyLiquidities via multicall (which uses
 * delegatecall, so msg.sender stays the user).
 */
export const POSITION_MANAGER_MODIFY_LIQUIDITIES_ABI = [
  {
    type: "function",
    name: "modifyLiquidities",
    stateMutability: "payable",
    inputs: [
      { type: "bytes", name: "unlockData" },
      { type: "uint256", name: "deadline" },
    ],
    outputs: [],
  },
] as const;

const PERMIT_BATCH_TUPLE = {
  type: "tuple",
  name: "_permitBatch",
  components: [
    {
      type: "tuple[]",
      name: "details",
      components: [
        { type: "address", name: "token" },
        { type: "uint160", name: "amount" },
        { type: "uint48", name: "expiration" },
        { type: "uint48", name: "nonce" },
      ],
    },
    { type: "address", name: "spender" },
    { type: "uint256", name: "sigDeadline" },
  ],
} as const;

export const POSITION_MANAGER_PERMIT_BATCH_ABI = [
  {
    type: "function",
    name: "permitBatch",
    stateMutability: "payable",
    inputs: [
      { type: "address", name: "owner" },
      PERMIT_BATCH_TUPLE,
      { type: "bytes", name: "signature" },
    ],
    outputs: [{ type: "bytes", name: "err" }],
  },
] as const;

export const POSITION_MANAGER_MULTICALL_ABI = [
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ type: "bytes[]", name: "data" }],
    outputs: [{ type: "bytes[]", name: "results" }],
  },
] as const;

/**
 * v4 PositionManager view ABI for enriching subgraph-discovered positions.
 * `info` is a packed uint256 — see decodePositionInfo in v4-position-info.ts.
 */
export const POSITION_MANAGER_VIEW_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "tokenId" }],
    outputs: [{ type: "address" }],
  },
  {
    // v4 PositionManager mints sequentially from tokenId 1; `nextTokenId`
    // is the id the next mint will use, so live ids are [1, nextTokenId).
    type: "function",
    name: "nextTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getPoolAndPositionInfo",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "tokenId" }],
    outputs: [
      {
        type: "tuple",
        name: "poolKey",
        components: [
          { type: "address", name: "currency0" },
          { type: "address", name: "currency1" },
          { type: "uint24", name: "fee" },
          { type: "int24", name: "tickSpacing" },
          { type: "address", name: "hooks" },
        ],
      },
      { type: "uint256", name: "info" },
    ],
  },
  {
    type: "function",
    name: "getPositionLiquidity",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "tokenId" }],
    outputs: [{ type: "uint128", name: "liquidity" }],
  },
] as const;

/**
 * Permit2 ABI fragments. The `allowance(owner, token, spender)` mapping
 * is a struct view (uint160 amount, uint48 expiration, uint48 nonce).
 * Returned as a tuple by viem's readContract.
 */
export const PERMIT2_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "token" },
      { type: "address", name: "spender" },
    ],
    outputs: [
      { type: "uint160", name: "amount" },
      { type: "uint48", name: "expiration" },
      { type: "uint48", name: "nonce" },
    ],
  },
] as const;

/**
 * v4 StateView ABI fragments. StateView is a stateless lens contract that
 * reads PoolManager extsload slots without unlocking. We only need
 * getSlot0 for the live sqrtPriceX96/tick.
 *
 * Note: getSlot0 takes the canonical v4 PoolId (`bytes32` =
 * keccak256(abi.encode(PoolKey))), NOT Mantua's internal pool_key_hash
 * (which is a string-concatenated hash). See pool-id.ts for the encoder.
 */
export const STATE_VIEW_ABI = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ type: "bytes32", name: "poolId" }],
    outputs: [
      { type: "uint160", name: "sqrtPriceX96" },
      { type: "int24", name: "tick" },
      { type: "uint24", name: "protocolFee" },
      { type: "uint24", name: "lpFee" },
    ],
  },
  {
    // Current cumulative fee growth inside a tick range, scaled by 2^128.
    type: "function",
    name: "getFeeGrowthInside",
    stateMutability: "view",
    inputs: [
      { type: "bytes32", name: "poolId" },
      { type: "int24", name: "tickLower" },
      { type: "int24", name: "tickUpper" },
    ],
    outputs: [
      { type: "uint256", name: "feeGrowthInside0X128" },
      { type: "uint256", name: "feeGrowthInside1X128" },
    ],
  },
  {
    // A position's liquidity + the fee growth snapshot taken at its last
    // update. PositionManager positions are keyed by owner=PositionManager,
    // salt=bytes32(tokenId).
    type: "function",
    name: "getPositionInfo",
    stateMutability: "view",
    inputs: [
      { type: "bytes32", name: "poolId" },
      { type: "address", name: "owner" },
      { type: "int24", name: "tickLower" },
      { type: "int24", name: "tickUpper" },
      { type: "bytes32", name: "salt" },
    ],
    outputs: [
      { type: "uint128", name: "liquidity" },
      { type: "uint256", name: "feeGrowthInside0LastX128" },
      { type: "uint256", name: "feeGrowthInside1LastX128" },
    ],
  },
] as const;

/** ERC-20 ABI fragments we need for the approval flow. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "spender" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// ─── Dynamic Market Hook stack (B2-005) ─────────────────────────────────────

/**
 * The sports-market v4 stack. Each Market mints its own YES/NO pair and
 * initializes its own pool on the Dynamic Market PoolManager; market
 * pools route directly rather than through the venue picker (DM-112).
 */
export interface DynamicMarketDeployment {
  readonly poolManager: `0x${string}`;
  readonly registry: `0x${string}`;
  readonly hook: `0x${string}`;
  /** Registry operator — registers pools, pauses, rotates roles. */
  readonly operator: `0x${string}`;
  /** Keeper = the market resolver key (spec §0.1). */
  readonly keeper: `0x${string}`;
}

/**
 * Per-chain Dynamic Market deployments. Arc Mainnet: deployment pending
 * (H-009 — `deploy/dynamic-market/README.md`); the 2026-09-23 Base
 * deployment is superseded and not registered. Consumers degrade
 * gracefully on a chain with no entry.
 */
export const DYNAMIC_MARKET_BY_CHAIN: Partial<Record<SupportedChainId, DynamicMarketDeployment>> =
  {};
