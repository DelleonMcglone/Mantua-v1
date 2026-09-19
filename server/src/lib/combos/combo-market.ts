import { BASE_CHAIN_ID, type SupportedChainId } from "../chains.ts";
import { env } from "../../env.ts";
import { computeComboMarketId } from "../market-id.ts";
import {
  MARKETS_BY_CHAIN,
  MARKETS_PERIPHERY_BY_CHAIN,
  MARKET_ABI,
  MARKET_FACTORY_ABI,
  STATE_VIEW_ABI,
} from "../markets-contracts.ts";
import { sqrtPriceX96ToProbability } from "../probability.ts";
import { getRpcClient } from "../rpc-client.ts";
import { DYNAMIC_MARKET_BY_CHAIN } from "../v4-contracts.ts";
import type { PlannedMarket } from "../sports/ingest.ts";
import { planMarketPool } from "../sports/market-pool.ts";
import { createMarketsOnChain, marketSignerWallet } from "../sports/markets-onchain.ts";
import type { LeagueSlug } from "../sports/provider.ts";
import { MarketsNotDeployedError } from "../sports/market-trade-build.ts";
import { fairProbabilityBps } from "./combo-pricing.ts";
import { comboLabel, comboPlayoffs, comboStartsAt, type LegCandidate } from "./combo-rules.ts";

/**
 * Task 072 / CB-005 — the conjunction market on chain. Planned like any
 * game market (id, label, startsAt, opening price, season flag), created
 * through the same factory / pool bootstrap / seed sweep the sports sync
 * uses, and read back through the same factory and state view. No
 * deployment → `MarketsNotDeployedError`, exactly as a trade.
 */

const STATE_NAMES = ["OPEN", "FROZEN", "RESOLVED", "SETTLED", "INVALID"] as const;

export interface ComboMarketPlan {
  marketId: `0x${string}`;
  label: string;
  /** Unix seconds — the latest leg kickoff. */
  startsAt: number;
  openingProbability: number;
  playoffs: boolean;
  league: LeagueSlug;
  legs: LegCandidate[];
}

export function planComboMarket(
  legs: readonly LegCandidate[],
  chainId: SupportedChainId,
): ComboMarketPlan {
  const priced = legs.map((l) => ({ priceBps: l.priceBps ?? 10_000 }));
  return {
    marketId: computeComboMarketId(
      legs.map((l) => l.marketId),
      chainId,
    ),
    label: comboLabel(legs),
    startsAt: comboStartsAt(legs),
    openingProbability: fairProbabilityBps(priced) / 10_000,
    playoffs: comboPlayoffs(legs),
    league: (legs[0]?.league ?? "nfl") as LeagueSlug,
    legs: [...legs],
  };
}

/** The `PlannedMarket` the sync's creation sweep accepts for a combo. */
export function plannedMarketFor(plan: ComboMarketPlan): PlannedMarket {
  return {
    marketId: plan.marketId,
    providerEventId: plan.marketId,
    league: plan.league,
    marketType: "combo",
    outcomeIndex: 0,
    label: plan.label,
    kickoffTimestamp: plan.startsAt,
    openingProbability: plan.openingProbability,
    playoffs: plan.playoffs,
  };
}

export interface ComboOnChain {
  marketAddress: `0x${string}`;
  yesToken: `0x${string}`;
  poolId: `0x${string}`;
  state: (typeof STATE_NAMES)[number];
  /** Live YES price of the combo pool, bps; null before the pool trades. */
  markBps: number | null;
}

/** Null when the factory has no market for this id. */
export async function readComboOnChain(
  marketId: `0x${string}`,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<ComboOnChain | null> {
  const markets = MARKETS_BY_CHAIN[chainId];
  const periphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
  const dm = DYNAMIC_MARKET_BY_CHAIN[chainId];
  if (!markets || !periphery || !dm) throw new MarketsNotDeployedError(chainId);
  const client = getRpcClient(chainId);
  const marketAddress = await client.readContract({
    address: markets.factory,
    abi: MARKET_FACTORY_ABI,
    functionName: "marketOf",
    args: [marketId],
  });
  if (marketAddress === "0x0000000000000000000000000000000000000000") return null;
  const [yesToken, stateIndex] = await Promise.all([
    client.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "yesToken" }),
    client.readContract({ address: marketAddress, abi: MARKET_ABI, functionName: "state" }),
  ]);
  const plan = planMarketPool(yesToken, markets.collateral, dm.hook, 0.5);
  let markBps: number | null = null;
  try {
    const [sqrtPriceX96] = await client.readContract({
      address: periphery.stateView,
      abi: STATE_VIEW_ABI,
      functionName: "getSlot0",
      args: [plan.poolId],
    });
    if (sqrtPriceX96 > 0n) {
      markBps = Math.round(sqrtPriceX96ToProbability(sqrtPriceX96, plan.yesIsToken0) * 10_000);
    }
  } catch {
    markBps = null; // unpriced: reported as such, never guessed
  }
  return {
    marketAddress,
    yesToken,
    poolId: plan.poolId,
    state: STATE_NAMES[stateIndex] ?? "OPEN",
    markBps,
  };
}

export type EnsureResult =
  | { kind: "ready"; created: boolean; onChain: ComboOnChain }
  | { kind: "no_signer" }
  | { kind: "failed"; error: string };

/** Create the combo market, pool and seed when absent; idempotent. */
export async function ensureComboMarket(
  plan: ComboMarketPlan,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<EnsureResult> {
  const existing = await readComboOnChain(plan.marketId, chainId);
  if (!marketSignerWallet(chainId)) {
    return existing ? { kind: "ready", created: false, onChain: existing } : { kind: "no_signer" };
  }
  const summary = await createMarketsOnChain(
    [plannedMarketFor(plan)],
    chainId,
    BigInt(env.COMBO_SEED_USDC),
  );
  const failure = summary?.failures.at(0);
  if (failure) return { kind: "failed", error: failure.error };
  const onChain = await readComboOnChain(plan.marketId, chainId);
  if (!onChain) return { kind: "failed", error: "combo market absent after creation" };
  return { kind: "ready", created: (summary?.created ?? 0) > 0, onChain };
}
