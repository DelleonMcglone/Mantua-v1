/**
 * Read a wallet's open v4 LP positions straight from the chain.
 *
 * The portfolio Positions tab previously relied on a localStorage
 * "breadcrumb" written at mint time — fragile (lost on cache-clear /
 * incognito / another browser) and invisible to positions opened
 * elsewhere. This enumerates the user's PositionManager ERC-721s on the
 * canonical Base v4 stack and reconstructs each position from
 * on-chain state, so the tab always reflects reality.
 *
 * Discovery: each v4 PositionManager mints sequentially from tokenId 1,
 * so live ids are [1, nextTokenId). We scan that range, keep the ids the
 * wallet owns, then read pool key + ticks + liquidity per id and derive
 * current token amounts from the pool's live sqrtPrice (the subgraph path
 * in external-positions.ts complements this bounded on-chain scan).
 * Positions with zero liquidity (fully removed) are dropped.
 */
import { DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { getRpcClient } from "./rpc-client.ts";
import {
  HOOK_NAMES,
  POSITION_MANAGER_VIEW_ABI,
  TICK_SPACING_BY_FEE,
  getHookAddress,
  getV4PositionManager,
  type FeeTier,
  type HookName,
} from "./v4-contracts.ts";
import { decodePositionInfo } from "./v4-position-info.ts";
import { readAccruedFees } from "./v4-accrued-fees.ts";
import { getAmountsForLiquidity } from "./amounts-for-liquidity.ts";
import { getSqrtRatioAtTick } from "./tick-math.ts";
import { readSlot0 } from "./v4-state-view.ts";
import type { PoolKey } from "./pool-key.ts";
import { getTokens, type TokenSymbol } from "./tokens.ts";
import { logger } from "./logger.ts";

/** Highest tokenId we'll scan per PositionManager — a safety bound so a
 *  corrupt `nextTokenId` can't trigger an unbounded RPC sweep. */
const MAX_SCAN = 2000;

export interface OnchainPosition {
  chainId: SupportedChainId;
  /** PositionManager ERC-721 tokenId. */
  tokenId: string;
  /** Which PositionManager (per-hook stack) minted it. */
  positionManager: `0x${string}`;
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  /** Static fee tier (derived from tickSpacing — dynamic-fee pools carry
   *  the 0x800000 flag in key.fee, which isn't a UI tier). */
  fee: FeeTier;
  hook: HookName | null;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  /** Current token amounts for this liquidity at the live pool price,
   *  formatted to the token's decimals (max 6 fractional digits). */
  amountA: string;
  amountB: string;
  /** Raw on-chain currency addresses (currency0 = tokenA, currency1 =
   *  tokenB) and the pool's hook address — null for no-hook pools. Carried
   *  so the earnings/sweep routes can value + collect fees without a
   *  DB round-trip. */
  token0: `0x${string}`;
  token1: `0x${string}`;
  hookAddress: `0x${string}` | null;
  /** Uncollected swap fees in raw base units (fees0 = tokenA, fees1 =
   *  tokenB), read from live v4 feeGrowthInside state. "0" when none. */
  fees0: string;
  fees1: string;
  /** The pool's CURRENT swap fee from slot0 (v4 pips, 1_000_000 = 100%).
   *  For dynamic-fee hook pools this is the live rate the hook last set;
   *  null when slot0 couldn't be read. Used to estimate the LP-vs-hook
   *  fee split in the earnings route. */
  currentLpFeePips: number | null;
}

interface PoolKeyView {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

/** Reverse of TICK_SPACING_BY_FEE — recover the UI fee tier from a pool's
 *  tickSpacing (works for dynamic-fee pools whose key.fee is the flag). */
const FEE_BY_TICK_SPACING = new Map<number, FeeTier>(
  Object.entries(TICK_SPACING_BY_FEE).map(([fee, ts]) => [ts, Number(fee) as FeeTier]),
);

function hookNameForAddress(addr: string, chainId: SupportedChainId): HookName | null {
  const lower = addr.toLowerCase();
  if (lower === "0x0000000000000000000000000000000000000000") return null;
  for (const name of HOOK_NAMES) {
    if (getHookAddress(name, chainId)?.toLowerCase() === lower) return name;
  }
  return null;
}

/** Format a raw token amount to a human string, max 6 fractional digits. */
function fmtAmount(raw: bigint, decimals: number): string {
  const denom = 10n ** BigInt(decimals);
  const whole = raw / denom;
  const frac = raw % denom;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr.slice(0, 6)}`;
}

/** PositionManagers to scan — on Base every hook shares the canonical
 *  stack, so there is exactly one. */
function distinctPositionManagers(chainId: SupportedChainId): `0x${string}`[] {
  return [getV4PositionManager(chainId)];
}

/** Enumerate tokenIds [1, nextTokenId) that `owner` holds on one PM. */
async function ownedTokenIds(
  positionManager: `0x${string}`,
  owner: `0x${string}`,
  chainId: SupportedChainId,
): Promise<bigint[]> {
  const client = getRpcClient(chainId);
  let next: bigint;
  try {
    next = await client.readContract({
      address: positionManager,
      abi: POSITION_MANAGER_VIEW_ABI,
      functionName: "nextTokenId",
      args: [],
    });
  } catch (err) {
    logger.warn({ err, positionManager }, "onchain-positions: nextTokenId read failed");
    return [];
  }
  const last = next > BigInt(MAX_SCAN + 1) ? BigInt(MAX_SCAN + 1) : next;
  const ids: bigint[] = [];
  for (let i = 1n; i < last; i++) ids.push(i);

  const ownerLower = owner.toLowerCase();
  const owned = await Promise.all(
    ids.map(async (id) => {
      try {
        const o = (await client.readContract({
          address: positionManager,
          abi: POSITION_MANAGER_VIEW_ABI,
          functionName: "ownerOf",
          args: [id],
        })) as string;
        return o.toLowerCase() === ownerLower ? id : null;
      } catch {
        // ownerOf reverts for burned ids — not owned.
        return null;
      }
    }),
  );
  return owned.filter((x): x is bigint => x !== null);
}

async function readOnePosition(
  positionManager: `0x${string}`,
  tokenId: bigint,
  chainId: SupportedChainId,
): Promise<OnchainPosition | null> {
  const client = getRpcClient(chainId);
  try {
    const [poolAndInfo, liquidity] = await Promise.all([
      client.readContract({
        address: positionManager,
        abi: POSITION_MANAGER_VIEW_ABI,
        functionName: "getPoolAndPositionInfo",
        args: [tokenId],
      }),
      client.readContract({
        address: positionManager,
        abi: POSITION_MANAGER_VIEW_ABI,
        functionName: "getPositionLiquidity",
        args: [tokenId],
      }),
    ]);
    const liq = liquidity;
    if (liq === 0n) return null; // fully removed — not an open position

    const [poolKey, info] = poolAndInfo as readonly [PoolKeyView, bigint];
    const { tickLower, tickUpper } = decodePositionInfo(info);

    // Map currencies → symbols. Skip positions on non-registry tokens
    // (e.g. legacy mock-token pools) — they aren't user-facing.
    const tokens = getTokens(chainId);
    const byAddr = new Map<string, TokenSymbol>();
    for (const sym of Object.keys(tokens) as TokenSymbol[]) {
      byAddr.set(tokens[sym].address.toLowerCase(), sym);
    }
    const symA = byAddr.get(poolKey.currency0.toLowerCase());
    const symB = byAddr.get(poolKey.currency1.toLowerCase());
    if (!symA || !symB) return null;

    const fee = FEE_BY_TICK_SPACING.get(poolKey.tickSpacing);
    if (!fee) return null;

    // Live price → current token amounts for this liquidity.
    const key: PoolKey = {
      currency0: poolKey.currency0,
      currency1: poolKey.currency1,
      fee: poolKey.fee,
      tickSpacing: poolKey.tickSpacing,
      hooks: poolKey.hooks,
    };
    const slot0 = await readSlot0(key, chainId);
    const sqrtCurrent = slot0 ? slot0.sqrtPriceX96 : getSqrtRatioAtTick(tickLower);
    const { amount0, amount1 } = getAmountsForLiquidity({
      sqrtPriceCurrentX96: sqrtCurrent,
      sqrtPriceLowerX96: getSqrtRatioAtTick(tickLower),
      sqrtPriceUpperX96: getSqrtRatioAtTick(tickUpper),
      liquidity: liq,
    });

    // Uncollected swap fees from live feeGrowthInside state. Reuses the exact
    // on-chain poolKey (DynamicFee pools carry the fee flag, not a UI tier), so
    // the poolId matches; degrade to 0 on a read error rather than drop the
    // whole position.
    let fees = { amount0: 0n, amount1: 0n };
    try {
      fees = await readAccruedFees(key, tokenId, tickLower, tickUpper, chainId);
    } catch (err) {
      logger.warn(
        { err, positionManager, tokenId: tokenId.toString() },
        "onchain-positions: accrued-fee read failed",
      );
    }

    return {
      chainId,
      tokenId: tokenId.toString(),
      positionManager,
      tokenA: symA,
      tokenB: symB,
      fee,
      hook: hookNameForAddress(poolKey.hooks, chainId),
      tickLower,
      tickUpper,
      liquidity: liq.toString(),
      amountA: fmtAmount(amount0, tokens[symA].decimals),
      amountB: fmtAmount(amount1, tokens[symB].decimals),
      token0: poolKey.currency0,
      token1: poolKey.currency1,
      hookAddress:
        poolKey.hooks.toLowerCase() === "0x0000000000000000000000000000000000000000"
          ? null
          : poolKey.hooks,
      fees0: fees.amount0.toString(),
      fees1: fees.amount1.toString(),
      currentLpFeePips: slot0 ? slot0.lpFee : null,
    };
  } catch (err) {
    logger.warn(
      { err, positionManager, tokenId: tokenId.toString() },
      "onchain-positions: read failed",
    );
    return null;
  }
}

/**
 * All open LP positions `owner` holds across the Mantua hook stacks on
 * `chainId`. Newest-first by tokenId (PositionManager ids are monotonic,
 * so higher id = more recent mint).
 */
export async function readOnchainPositions(
  owner: `0x${string}`,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): Promise<OnchainPosition[]> {
  const pms = distinctPositionManagers(chainId);
  const perPm = await Promise.all(
    pms.map(async (pm) => {
      const ids = await ownedTokenIds(pm, owner, chainId);
      const positions = await Promise.all(ids.map((id) => readOnePosition(pm, id, chainId)));
      return positions.filter((p): p is OnchainPosition => p !== null);
    }),
  );
  return perPm.flat().sort((a, b) => Number(BigInt(b.tokenId) - BigInt(a.tokenId)));
}
