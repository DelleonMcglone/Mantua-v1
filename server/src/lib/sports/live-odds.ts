/**
 * Live on-chain odds for the board: read each market pool's current price
 * via StateView and express it back as implied probability. Once a pool
 * trades, ITS price is the market's opinion — the provider's number is
 * only the opening seed. Fail-open per event: any chain hiccup leaves the
 * event with provider odds rather than blanking the board.
 */

import { computeMarketId } from "../market-id.ts";
import { sqrtPriceX96ToRawProbability } from "../probability.ts";
import { getRpcClient } from "../rpc-client.ts";
import { sharedCache } from "../shared-cache.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "../chains.ts";
import {
  MARKETS_BY_CHAIN,
  MARKETS_PERIPHERY_BY_CHAIN,
  MARKET_ABI,
  MARKET_FACTORY_ABI,
  STATE_VIEW_ABI,
} from "../markets-contracts.ts";
import { DYNAMIC_MARKET_BY_CHAIN } from "../v4-contracts.ts";
import { planMarketPool } from "./market-pool.ts";
import type { PublicSlate } from "./public-slate.ts";

/** Phase 7 / R-007 — the overlay is the board's RPC amplifier (3 reads per
 *  event); it lives in the SHARED cache so every instance serves one
 *  computation per league per window. Keyed on the ingest time so a fresh
 *  ingest invalidates it, like the old per-instance Map did. */
const CACHE_TTL_MS = 15_000;

/** Chains probed for a live pool price, in order — single chain today. */
export const LIVE_ODDS_CHAINS: readonly SupportedChainId[] = [BASE_CHAIN_ID];

/**
 * The home market's pool price on one chain, as YES-implied bps. Null when
 * the market or pool does not exist there (the provider seed remains the
 * price of record); THROWS on a chain read failure so callers that must not
 * act on stale data (the strategy engine) can tell "no pool" from "read
 * failed". Also consumed by `withLiveOdds`, which fails open per chain.
 */
export async function chainHomeProbabilityBps(
  providerEventId: string,
  chainId: SupportedChainId,
): Promise<number | null> {
  const markets = MARKETS_BY_CHAIN[chainId];
  const periphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
  const dm = DYNAMIC_MARKET_BY_CHAIN[chainId];
  if (!markets || !periphery || !dm) return null;
  const client = getRpcClient(chainId);

  const marketId = computeMarketId({
    providerEventId,
    marketType: "moneyline",
    outcomeIndex: 0,
    chainId,
  });
  const market = await client.readContract({
    address: markets.factory,
    abi: MARKET_FACTORY_ABI,
    functionName: "marketOf",
    args: [marketId],
  });
  if (market === "0x0000000000000000000000000000000000000000") return null;

  const yesToken = await client.readContract({
    address: market,
    abi: MARKET_ABI,
    functionName: "yesToken",
  });
  const plan = planMarketPool(yesToken, markets.collateral, dm.hook, 0.5);
  const [sqrtPriceX96] = await client.readContract({
    address: periphery.stateView,
    abi: STATE_VIEW_ABI,
    functionName: "getSlot0",
    args: [plan.poolId],
  });
  if (sqrtPriceX96 === 0n) return null; // pool not initialized
  // A thin book can be pushed outside [0,1] (a YES trading above
  // 1 USDC — economically absurd but nothing forces the split/merge arb
  // here). sqrtPriceX96ToProbability throws on that, which blanked the
  // board's odds for the whole game; clamp to the display band instead.
  const raw = sqrtPriceX96ToRawProbability(sqrtPriceX96, plan.yesIsToken0);
  return Math.round(Math.min(0.99, Math.max(0.01, raw)) * 10_000);
}

async function liveHomeProbabilityBps(providerEventId: string): Promise<number | null> {
  for (const chainId of LIVE_ODDS_CHAINS) {
    try {
      const p = await chainHomeProbabilityBps(providerEventId, chainId);
      if (p !== null) return p;
    } catch {
      // fail-open per chain — a hiccup on one chain must not hide the
      // other chain's price (or blank the board).
    }
  }
  return null;
}

/**
 * Overlay live pool odds onto a public slate. The home market's pool price
 * replaces `homeWinProbabilityBps` (the away card cell is its complement,
 * exactly like the provider number) and `liveOdds` marks the event so the
 * UI can label market prices as the market's own.
 */
export async function withLiveOdds(slate: PublicSlate): Promise<PublicSlate> {
  return sharedCache.getOrCompute(
    `live-odds:${slate.league}:${String(slate.fetchedAt)}:${String(slate.events.length)}`,
    CACHE_TTL_MS,
    () => overlayLiveOdds(slate),
  );
}

async function overlayLiveOdds(slate: PublicSlate): Promise<PublicSlate> {
  const events = await Promise.all(
    slate.events.map(async (event) => {
      try {
        const live = await liveHomeProbabilityBps(event.providerEventId);
        if (live === null) return event;
        return { ...event, homeWinProbabilityBps: live, liveOdds: true };
      } catch {
        return event; // fail-open to provider odds
      }
    }),
  );

  return { ...slate, events };
}
