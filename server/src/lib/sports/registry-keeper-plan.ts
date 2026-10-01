/**
 * K-01 — the registry keeper, pure half.
 *
 * The Dynamic Market Hook prices every pool from the MarketStateRegistry's
 * three keeper-controlled fields (spec §4.1): `modelProbability`,
 * `confidence`, `eventState`. A pool nobody has written to is stale from
 * the moment it is registered (§22: rate pinned at the ceiling, trade cap
 * at the floor, no data-driven FINAL halt). This module decides, from the
 * canonical rows and what is already on-chain, which pools get a write
 * this tick and with what values. It signs nothing.
 *
 * Rules:
 *  - the YES side's probability: outcome 0 is the home side, outcome 1 the
 *    complement; from the provider's live home-win probability when the
 *    feed carries one, else the market's opening probability;
 *  - confidence: full on a fresh provider probability, half on the opening
 *    fallback, a quarter whenever the feed is delayed;
 *  - event state from the canonical status; FINAL / VOID are terminal — a
 *    pool already terminal on-chain is never written again, and a
 *    terminal write is never downgraded;
 *  - otherwise write when the state changes, the probability moves more
 *    than PROBABILITY_DELTA_BPS, or the on-chain state is older than
 *    REFRESH_AFTER_SECONDS — comfortably inside §22's STALE_AFTER (900 s)
 *    on the five-minute tick.
 */

/** IMarketStateRegistry.EventState, in enum order. */
export const EVENT_STATE = {
  PRE_GAME: 0,
  LIVE: 1,
  CRITICAL: 2,
  FINAL: 3,
  RESOLVED: 4,
  VOID: 5,
} as const;
export type EventStateCode = (typeof EVENT_STATE)[keyof typeof EVENT_STATE];

export const MAX_BPS = 10_000;
/** Spec §22 STALE_AFTER is 900 s; refresh well inside it. */
export const REFRESH_AFTER_SECONDS = 600;
/** A probability move below this is noise, not worth a transaction. */
export const PROBABILITY_DELTA_BPS = 100;
export const CONFIDENCE = { live: 10_000, opening: 5_000, delayed: 2_500 } as const;

export interface KeeperInput {
  marketId: `0x${string}`;
  poolId: `0x${string}`;
  /** 0 = home side (YES = home wins), 1 = away side. */
  outcomeIndex: number;
  /** Canonical event status: scheduled | in_progress | final | postponed | cancelled. */
  eventStatus: string;
  /** Provider's live home-win probability, bps, when known. */
  homeWinProbabilityBps: number | null;
  /** The market's opening YES probability (0..1), the fallback. */
  openingProbability: number | null;
  /** On-chain registry state, or null when the pool is not registered. */
  onChain: {
    modelProbability: number;
    confidence: number;
    eventState: number;
    lastUpdate: number;
  } | null;
}

export interface KeeperWrite {
  marketId: `0x${string}`;
  poolId: `0x${string}`;
  modelProbability: number;
  confidence: number;
  eventState: EventStateCode;
  reason: "unregistered-state" | "state-change" | "probability-move" | "refresh";
}

const TERMINAL = new Set<number>([EVENT_STATE.FINAL, EVENT_STATE.RESOLVED, EVENT_STATE.VOID]);

export function eventStateFor(status: string): EventStateCode {
  switch (status) {
    case "in_progress":
      return EVENT_STATE.LIVE;
    case "final":
      return EVENT_STATE.FINAL;
    case "postponed":
    case "cancelled":
      return EVENT_STATE.VOID;
    default:
      return EVENT_STATE.PRE_GAME;
  }
}

/** The YES-side probability in bps, clamped, and which source it came from. */
export function yesProbabilityBps(
  input: Pick<KeeperInput, "outcomeIndex" | "homeWinProbabilityBps" | "openingProbability">,
): { bps: number; source: "live" | "opening" } | null {
  const clamp = (v: number) => Math.min(MAX_BPS, Math.max(0, Math.round(v)));
  if (input.homeWinProbabilityBps !== null && Number.isFinite(input.homeWinProbabilityBps)) {
    const home = clamp(input.homeWinProbabilityBps);
    return { bps: input.outcomeIndex === 0 ? home : MAX_BPS - home, source: "live" };
  }
  if (input.openingProbability !== null && Number.isFinite(input.openingProbability)) {
    return { bps: clamp(input.openingProbability * MAX_BPS), source: "opening" };
  }
  return null;
}

export function planKeeperWrites(
  inputs: readonly KeeperInput[],
  nowSeconds: number,
  feedDelayed: boolean,
): KeeperWrite[] {
  const out: KeeperWrite[] = [];
  for (const i of inputs) {
    if (!i.onChain) continue; // not registered — nothing to keep
    if (TERMINAL.has(i.onChain.eventState)) continue; // never rewrite a terminal pool
    const prob = yesProbabilityBps(i);
    if (!prob) continue;
    const eventState = eventStateFor(i.eventStatus);
    const confidence = feedDelayed
      ? CONFIDENCE.delayed
      : prob.source === "live"
        ? CONFIDENCE.live
        : CONFIDENCE.opening;
    const base = {
      marketId: i.marketId,
      poolId: i.poolId,
      modelProbability: prob.bps,
      confidence,
      eventState,
    };
    if (i.onChain.lastUpdate === 0) out.push({ ...base, reason: "unregistered-state" });
    else if (eventState !== i.onChain.eventState) out.push({ ...base, reason: "state-change" });
    else if (Math.abs(prob.bps - i.onChain.modelProbability) >= PROBABILITY_DELTA_BPS) {
      out.push({ ...base, reason: "probability-move" });
    } else if (nowSeconds - i.onChain.lastUpdate >= REFRESH_AFTER_SECONDS) {
      out.push({ ...base, reason: "refresh" });
    }
  }
  return out;
}
