/**
 * B3-005 / B3-006 — the ingest worker and the market generator.
 *
 * Three passes, deliberately separate because they have different failure
 * consequences:
 *
 *  - **slate refresh** — new games appear. Getting this wrong delays a market.
 *  - **live polling** — scores move. Getting this wrong shows stale numbers.
 *  - **final capture** — a game ends. Getting this wrong settles a market
 *    incorrectly, which is unrecoverable on-chain.
 *
 * Only the third is dangerous, so it is the one that refuses to act on
 * anything less than certainty: a `delayed` slate never produces a final, and
 * an unrecognised status never counts as one (spec §3.5).
 *
 * The generator is pure planning: it decides which markets *should* exist and
 * returns them. It does not sign anything. Deployment of the market contracts
 * is a separate, explicitly-authorised step, and keeping the two apart means a
 * bug in slate parsing cannot mint markets.
 */

import { logger } from "../logger.ts";
import { computeMarketId, type MarketType } from "../market-id.ts";
import { probabilityToPrice } from "../probability.ts";
import {
  type LeagueSlug,
  type ProviderEvent,
  type SportsDataProvider,
  isSettleable,
  isVoidStatus,
} from "./provider.ts";

/** A market the generator says should exist for a game. */
export interface PlannedMarket {
  marketId: `0x${string}`;
  providerEventId: string;
  league: LeagueSlug;
  marketType: MarketType;
  /** 0 = home, 1 = away. Fixed by the canonical event row (B0-004). */
  outcomeIndex: number;
  /** Label for the YES token of this outcome. */
  label: string;
  kickoffTimestamp: number;
  /** Opening implied probability, 0–1, for seeding the pool (B1-009). */
  openingProbability: number;
}

/**
 * Plan the market set for one event.
 *
 * DM-106 is moneyline only, which for a binary pair means **two** markets per
 * game — one where YES is "home wins", one where YES is "away wins". They are
 * distinct markets with distinct ids and distinct pools, not two views of one.
 *
 * Games already started, finished, or called off produce nothing: `MarketFactory`
 * rejects a kickoff at or before now (a market born frozen could never trade),
 * so planning one would only generate a guaranteed revert.
 */
export function planMarkets(
  event: ProviderEvent,
  nowSeconds: number,
  chainId?: number,
): PlannedMarket[] {
  if (event.status !== "scheduled") return [];
  if (event.startsAt <= nowSeconds) return [];

  const homeProb =
    event.homeWinProbabilityBps !== undefined
      ? probabilityToPrice(event.homeWinProbabilityBps / 10_000)
      : 0.5;

  const sides: { outcomeIndex: number; label: string; probability: number }[] = [
    { outcomeIndex: 0, label: `${event.home.abbreviation} to win`, probability: homeProb },
    // The complement, so the two markets price consistently at open rather than
    // both starting at whatever the provider said about the home side.
    { outcomeIndex: 1, label: `${event.away.abbreviation} to win`, probability: 1 - homeProb },
  ];

  return sides.map((side) => ({
    marketId: computeMarketId({
      providerEventId: event.providerEventId,
      marketType: "moneyline",
      outcomeIndex: side.outcomeIndex,
      ...(chainId !== undefined ? { chainId } : {}),
    }),
    providerEventId: event.providerEventId,
    league: event.league,
    marketType: "moneyline" as const,
    outcomeIndex: side.outcomeIndex,
    label: side.label,
    kickoffTimestamp: event.startsAt,
    openingProbability: probabilityToPrice(side.probability),
  }));
}

/** Plan every market for a slate. Deterministic, so re-running is a no-op. */
export function planSlate(
  events: readonly ProviderEvent[],
  nowSeconds: number,
  chainId?: number,
): PlannedMarket[] {
  return events.flatMap((e) => planMarkets(e, nowSeconds, chainId));
}

/** What the resolution service should do about one event. */
export type SettlementAction =
  | { kind: "wait"; reason: string }
  | { kind: "void"; providerEventId: string }
  | { kind: "resolve"; providerEventId: string; winningOutcomeIndex: number };

/**
 * Decide the settlement action for an event.
 *
 * Every branch that is not a certain outcome returns `wait`. That asymmetry is
 * the point: waiting costs a delay, while resolving wrongly is permanent
 * (spec §3.5, §4).
 *
 * @param delayed True when the data came from a degraded path. A delayed
 *        response can be arbitrarily old, so it can report a game as still in
 *        progress that has in fact finished — or, worse, carry a stale score.
 *        Never settle on it.
 */
export function decideSettlement(event: ProviderEvent, delayed: boolean): SettlementAction {
  if (isVoidStatus(event.status)) {
    return { kind: "void", providerEventId: event.providerEventId };
  }

  if (delayed) {
    return { kind: "wait", reason: "provider data is delayed; refusing to settle" };
  }

  if (!isSettleable(event.status)) {
    return { kind: "wait", reason: `status is ${event.status}, not final` };
  }

  if (event.homeScore === undefined || event.awayScore === undefined) {
    return { kind: "wait", reason: "final without both scores" };
  }

  if (event.homeScore === event.awayScore) {
    // A tie satisfies neither "home wins" nor "away wins", so both binary
    // markets void rather than one of them paying out arbitrarily. NFL ties are
    // rare but real; WNBA cannot tie.
    return { kind: "void", providerEventId: event.providerEventId };
  }

  return {
    kind: "resolve",
    providerEventId: event.providerEventId,
    winningOutcomeIndex: event.homeScore > event.awayScore ? 0 : 1,
  };
}

export interface SlateRefreshResult {
  league: LeagueSlug;
  provider: string;
  delayed: boolean;
  /** The normalized events, for persistence — one fetch serves both passes. */
  events: ProviderEvent[];
  marketsPlanned: PlannedMarket[];
}

/**
 * B3-005 slate refresh: read a league's slate and plan its markets.
 *
 * A `delayed` slate still plans markets — creating a market late is harmless
 * and idempotent, and the alternative is a market never existing because the
 * provider wobbled once. The flag is propagated so callers know.
 */
export async function refreshSlate(
  provider: SportsDataProvider,
  league: LeagueSlug,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  chainId?: number,
): Promise<SlateRefreshResult> {
  const slate = await provider.getSlate(league);
  const marketsPlanned = planSlate(slate.events, nowSeconds, chainId);

  if (slate.delayed) {
    logger.warn({ league, provider: slate.provider }, "sports: slate is delayed");
  }

  return {
    league,
    provider: slate.provider,
    delayed: slate.delayed,
    events: slate.events,
    marketsPlanned,
  };
}
