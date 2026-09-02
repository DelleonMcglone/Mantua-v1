import { keccak256, toHex } from "viem";
import { baseRpcClient } from "./rpc-client.ts";
import { fetchSubgraphPositions, type SubgraphPosition } from "./subgraph.ts";
import { decodePositionInfo } from "./v4-position-info.ts";
import { POSITION_MANAGER_VIEW_ABI, V4_POSITION_MANAGER } from "./v4-contracts.ts";
import { logger } from "./logger.ts";

/**
 * Enriches subgraph-discovered positions with on-chain state. The official
 * v4 subgraph only exposes (tokenId, owner, createdAt); ticks/liquidity/
 * poolKey come from PositionManager view calls.
 *
 * Shape matches the existing /api/positions response so the UI consumes
 * Mantua-opened and external rows uniformly.
 */
export interface EnrichedPosition {
  id: string;
  tokenId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  status: "open";
  openedTx: null;
  closedTx: null;
  createdAt: string;
  poolKeyHash: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  hookAddress: string | null;
}

interface PoolKeyView {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Mantua's internal pool_key_hash — must match `pool-create.ts:96`. Kept in
 * sync deliberately so external positions key-match Mantua-tracked pools.
 */
function mantuaPoolKeyHash(key: PoolKeyView): `0x${string}` {
  return keccak256(
    toHex(
      `${key.currency0.toLowerCase()}|${key.currency1.toLowerCase()}|${String(key.fee)}|${String(key.tickSpacing)}|${key.hooks.toLowerCase()}`,
    ),
  );
}

interface OnchainEnrichment {
  poolKey: PoolKeyView;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

async function enrichOne(tokenId: string): Promise<OnchainEnrichment | null> {
  try {
    const tokenIdBig = BigInt(tokenId);
    const [poolAndInfo, liquidity] = await Promise.all([
      baseRpcClient.readContract({
        address: V4_POSITION_MANAGER,
        abi: POSITION_MANAGER_VIEW_ABI,
        functionName: "getPoolAndPositionInfo",
        args: [tokenIdBig],
      }),
      baseRpcClient.readContract({
        address: V4_POSITION_MANAGER,
        abi: POSITION_MANAGER_VIEW_ABI,
        functionName: "getPositionLiquidity",
        args: [tokenIdBig],
      }),
    ]);
    const [poolKey, info] = poolAndInfo as readonly [PoolKeyView, bigint];
    const decoded = decodePositionInfo(info);
    return {
      poolKey,
      tickLower: decoded.tickLower,
      tickUpper: decoded.tickUpper,
      liquidity,
    };
  } catch (err) {
    logger.warn({ err, tokenId }, "external-positions: enrichment failed; dropping position");
    return null;
  }
}

function toEnriched(sub: SubgraphPosition, on: OnchainEnrichment): EnrichedPosition {
  const hookAddress =
    on.poolKey.hooks.toLowerCase() === ZERO_ADDRESS ? null : on.poolKey.hooks.toLowerCase();
  return {
    id: `external-${sub.tokenId}`,
    tokenId: sub.tokenId,
    tickLower: on.tickLower,
    tickUpper: on.tickUpper,
    liquidity: on.liquidity.toString(),
    status: "open",
    openedTx: null,
    closedTx: null,
    createdAt: new Date(Number(sub.createdAtTimestamp) * 1000).toISOString(),
    poolKeyHash: mantuaPoolKeyHash(on.poolKey),
    token0: on.poolKey.currency0.toLowerCase(),
    token1: on.poolKey.currency1.toLowerCase(),
    fee: on.poolKey.fee,
    tickSpacing: on.poolKey.tickSpacing,
    hookAddress,
  };
}

/**
 * Discover + enrich a wallet's pre-Mantua v4 positions.
 *
 * Returns `[]` (not throws) on subgraph or RPC failure so the parent
 * /api/positions endpoint never breaks because of an upstream outage —
 * the user still sees Mantua-opened positions.
 */
export async function loadExternalPositions(
  walletAddress: string,
  options: { excludeTokenIds?: Set<string> } = {},
): Promise<EnrichedPosition[]> {
  let subgraphRows: SubgraphPosition[] | null;
  try {
    subgraphRows = await fetchSubgraphPositions(walletAddress);
  } catch (err) {
    logger.warn({ err, wallet: walletAddress }, "external-positions: subgraph fetch failed");
    return [];
  }
  if (!subgraphRows || subgraphRows.length === 0) return [];
  const exclude = options.excludeTokenIds ?? new Set<string>();
  const candidates = subgraphRows.filter((r) => !exclude.has(r.tokenId));

  const enriched = await Promise.all(
    candidates.map(async (sub) => {
      const on = await enrichOne(sub.tokenId);
      if (!on || on.liquidity === 0n) return null;
      return toEnriched(sub, on);
    }),
  );
  return enriched.filter((p): p is EnrichedPosition => p !== null);
}
