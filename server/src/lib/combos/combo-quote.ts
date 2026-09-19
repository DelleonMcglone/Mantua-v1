import type { DB } from "../../db/client.ts";
import type { AgentPolicyView } from "../agent/policy.ts";
import type { SupportedChainId } from "../chains.ts";
import { env } from "../../env.ts";
import { MarketsNotDeployedError, quoteMarketTrade } from "../sports/market-trade-build.ts";
import { readComboOnChain, planComboMarket, type ComboOnChain } from "./combo-market.ts";
import { comboPolicyGate, type PlatformComboLimits } from "./combo-policy.ts";
import {
  oddsMultiplier,
  priceCombo,
  separateTicketsFeeRaw,
  type PoolQuote,
} from "./combo-pricing.ts";
import type { ComboLegWire, ComboQuoteResult } from "./combo-quote-types.ts";
import {
  latestPricesBps,
  legCandidatesFrom,
  readLegRows,
  winnersByMarket,
  type LegRef,
  type LegRow,
} from "./combo-read.ts";
import { validateLegs, type LegCandidate } from "./combo-rules.ts";
import type { LegResult } from "./combo-settlement.ts";
import { openExposureUsd } from "./combo-store.ts";
import { buildComboTrade, legResults, plannedFeeWire } from "./combo-trade.ts";

/**
 * Task 072 / CB-002 … CB-004 — one quote for the builder and the agent:
 * rules, policy gate, fair price, the pool's own quote when the market
 * exists (or the planned opening estimate), the hook fee, and each leg's
 * own fee for the separate-tickets comparison. Deployment-independent
 * except for the chain reads, which degrade to `deployed: false`.
 */

export function platformLimits(): PlatformComboLimits {
  return { maxLegs: env.COMBO_MAX_LEGS, maxStakeUsd: env.COMBO_MAX_STAKE_USDC };
}

export interface ComboQuoteInput {
  userId: string;
  legs: readonly LegRef[];
  stakeRaw: bigint;
  chainId: SupportedChainId;
  policy: AgentPolicyView;
  playoffsOf: (providerEventId: string) => boolean;
  nowMs?: number;
}

function legWire(
  c: LegCandidate,
  result: LegResult,
  separateFeeUsdcRaw: string | null,
): ComboLegWire {
  return {
    marketId: c.marketId,
    providerEventId: c.providerEventId,
    outcomeIndex: c.outcomeIndex,
    teamName: c.teamName,
    opponentName: c.opponentName,
    league: c.league,
    kickoffAt: c.kickoffAt,
    priceBps: c.priceBps,
    oddsMultiplier: c.priceBps === null ? null : oddsMultiplier(c.priceBps),
    result,
    separateFeeUsdcRaw,
  };
}

async function legFee(
  row: LegRow,
  amountRaw: bigint,
  chainId: SupportedChainId,
): Promise<string | null> {
  try {
    const q = await quoteMarketTrade({
      providerEventId: row.providerEventId,
      outcomeIndex: row.outcomeIndex === 0 ? 0 : 1,
      direction: "buy",
      amountRaw,
      chainId,
    });
    return q.fee.feeUsdcRaw;
  } catch {
    return null;
  }
}

export async function quoteComboTicket(db: DB, input: ComboQuoteInput): Promise<ComboQuoteResult> {
  const nowMs = input.nowMs ?? Date.now();
  const platform = platformLimits();
  const rows = await readLegRows(db, input.legs, input.chainId);
  const prices = await latestPricesBps(
    db,
    rows.map((r) => r.marketId),
  );
  const candidates = legCandidatesFrom(rows, prices, input.playoffsOf);
  const violations = validateLegs(candidates, {
    maxLegs: Math.min(platform.maxLegs, input.policy.combo.maxLegs),
    allowedLeagues: input.policy.allowedLeagues,
    nowSeconds: Math.floor(nowMs / 1000),
  });
  if (rows.length < input.legs.length) {
    violations.push({ code: "leg_not_open", marketId: null, detail: "a leg has no market yet" });
  }
  const results = legResults(
    rows,
    await winnersByMarket(
      db,
      rows.map((r) => r.marketId),
    ),
  );
  if (violations.length > 0) {
    return {
      ok: false,
      violations,
      legs: candidates.map((c, i) => legWire(c, results[i]?.result ?? "pending", null)),
    };
  }

  const plan = planComboMarket(candidates, input.chainId);
  let deployed = true;
  let onChain: ComboOnChain | null = null;
  let pool: PoolQuote | null = null;
  let feeWire = null;
  const legFees: (string | null)[] = candidates.map(() => null);
  try {
    onChain = await readComboOnChain(plan.marketId, input.chainId);
    if (onChain?.state === "OPEN") {
      const built = await buildComboTrade({
        marketId: plan.marketId,
        onChain,
        direction: "buy",
        amountRaw: input.stakeRaw,
        chainId: input.chainId,
        legs: results,
        nowMs,
      });
      pool = {
        amountOut: BigInt(built.quote.amountOut),
        feeUsdcRaw: BigInt(built.fee.feeUsdcRaw),
        feePips: built.fee.feePips,
      };
      feeWire = built.fee;
    }
    const split = input.stakeRaw / BigInt(candidates.length);
    const fees = await Promise.all(rows.map((row) => legFee(row, split, input.chainId)));
    fees.forEach((f, i) => {
      legFees[i] = f;
    });
  } catch (err) {
    if (!(err instanceof MarketsNotDeployedError)) throw err;
    deployed = false;
  }
  const pricing = priceCombo({
    stakeRaw: input.stakeRaw,
    legs: candidates.map((c) => ({ marketId: c.marketId, priceBps: c.priceBps ?? 10_000 })),
    pool,
    playoffs: plan.playoffs,
  });
  const exposure = await openExposureUsd(db, input.userId);
  const gate = comboPolicyGate(input.policy, {
    legs: candidates.length,
    stakeUsd: Number(input.stakeRaw) / 1e6,
    payoutUsd: Number(pricing.potentialPayoutRaw) / 1e6,
    openExposureUsd: exposure,
    leagues: candidates.map((c) => c.league),
    platform,
  });
  const allLegFees = legFees.every((f): f is string => f !== null);
  return {
    ok: true,
    marketId: plan.marketId,
    label: plan.label,
    startsAt: plan.startsAt,
    source: pricing.source,
    deployed,
    exists: onChain !== null,
    marketState: onChain?.state ?? null,
    stakeRaw: input.stakeRaw.toString(),
    fairProbabilityBps: pricing.fairProbabilityBps,
    effectivePriceBps: pricing.effectivePriceBps,
    combinedOdds: pricing.combinedOdds,
    sharesRaw: pricing.sharesRaw.toString(),
    potentialPayoutRaw: pricing.potentialPayoutRaw.toString(),
    premiumBps: pricing.premiumBps,
    fee: feeWire ?? plannedFeeWire(pricing, plan.playoffs),
    separateTicketsFeeUsdcRaw: allLegFees
      ? separateTicketsFeeRaw(legFees.map((f) => BigInt(f))).toString()
      : null,
    legs: candidates.map((c, i) => legWire(c, results[i]?.result ?? "pending", legFees[i] ?? null)),
    gate,
    limits: {
      maxLegs: Math.min(platform.maxLegs, input.policy.combo.maxLegs),
      maxStakeUsd: Math.min(platform.maxStakeUsd, input.policy.combo.maxStakeUsd),
      openExposureUsd: exposure,
      maxOpenExposureUsd: input.policy.combo.maxOpenExposureUsd,
    },
  };
}
