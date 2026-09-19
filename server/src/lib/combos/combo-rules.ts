import { MAX_EVENT_DURATION_SECONDS } from "../sports/provider.ts";

/**
 * Task 072 / CB-001, CB-010 — which legs may be bundled, and what the
 * bundle is called. Pure: the correlated-leg controls are code, never a
 * price adjustment. Independence between legs is the pricing assumption
 * (D-119); anything that plainly breaks it — two legs from one game, one
 * team twice — is refused here before a quote exists.
 */

export const MIN_COMBO_LEGS = 2;
/** The ceiling the platform env may not exceed (`COMBO_MAX_LEGS`). */
export const HARD_MAX_COMBO_LEGS = 8;

export interface LegCandidate {
  marketId: `0x${string}`;
  providerEventId: string;
  outcomeIndex: 0 | 1;
  /** The team whose win this leg's YES pays on. */
  teamName: string;
  opponentName: string;
  league: string | null;
  /** Unix seconds. */
  kickoffAt: number;
  /** OPEN | FROZEN | RESOLVED | SETTLED | INVALID, or null when no market row exists. */
  marketState: string | null;
  /** scheduled | in_progress | final | postponed | cancelled */
  eventStatus: string;
  /** Live YES price in bps of probability, null when unpriced. */
  priceBps: number | null;
  playoffs: boolean;
}

export type LegViolationCode =
  | "too_few"
  | "too_many"
  | "duplicate_market"
  | "same_event"
  | "same_team"
  | "leg_not_open"
  | "leg_final"
  | "league_not_allowed"
  | "leg_unpriced";

export interface LegViolation {
  code: LegViolationCode;
  marketId: string | null;
  detail: string;
}

export interface LegRuleOptions {
  maxLegs: number;
  /** Empty = every league. */
  allowedLeagues?: readonly string[];
  nowSeconds: number;
}

const CLOSED_EVENT = new Set(["final", "postponed", "cancelled"]);

/** Every rule a leg set breaks, each naming the leg — never just the first. */
export function validateLegs(legs: readonly LegCandidate[], opts: LegRuleOptions): LegViolation[] {
  const out: LegViolation[] = [];
  if (legs.length < MIN_COMBO_LEGS) {
    out.push({ code: "too_few", marketId: null, detail: "a combo needs at least two legs" });
  }
  if (legs.length > opts.maxLegs) {
    out.push({ code: "too_many", marketId: null, detail: `at most ${String(opts.maxLegs)} legs` });
  }
  const seenMarket = new Set<string>();
  const seenEvent = new Set<string>();
  const seenTeam = new Set<string>();
  for (const leg of legs) {
    const id = leg.marketId.toLowerCase();
    if (seenMarket.has(id)) {
      out.push({
        code: "duplicate_market",
        marketId: id,
        detail: `${leg.teamName} is already a leg`,
      });
    }
    seenMarket.add(id);
    if (seenEvent.has(leg.providerEventId)) {
      out.push({
        code: "same_event",
        marketId: id,
        detail: `${leg.teamName} and ${leg.opponentName} play each other — one game, one leg`,
      });
    }
    seenEvent.add(leg.providerEventId);
    const team = leg.teamName.trim().toLowerCase();
    if (seenTeam.has(team)) {
      out.push({ code: "same_team", marketId: id, detail: `${leg.teamName} appears twice` });
    }
    seenTeam.add(team);
    if (leg.marketState !== "OPEN") {
      out.push({
        code: "leg_not_open",
        marketId: id,
        detail: `${leg.teamName}: market is ${leg.marketState ?? "not created"}`,
      });
    }
    const pastBackstop = leg.kickoffAt + MAX_EVENT_DURATION_SECONDS <= opts.nowSeconds;
    if (CLOSED_EVENT.has(leg.eventStatus) || pastBackstop) {
      out.push({ code: "leg_final", marketId: id, detail: `${leg.teamName}: game is over` });
    }
    if (
      opts.allowedLeagues &&
      opts.allowedLeagues.length > 0 &&
      (leg.league === null || !opts.allowedLeagues.includes(leg.league))
    ) {
      out.push({
        code: "league_not_allowed",
        marketId: id,
        detail: `${leg.league ?? "unknown league"} is not in the allowed leagues`,
      });
    }
    if (leg.priceBps === null) {
      out.push({ code: "leg_unpriced", marketId: id, detail: `${leg.teamName} has no live price` });
    }
  }
  return out;
}

/** "Cowboys + Chiefs + Raiders" — the combo market's on-chain label. */
export function comboLabel(legs: readonly Pick<LegCandidate, "teamName">[]): string {
  return legs.map((l) => l.teamName).join(" + ");
}

/** The combo market's `startsAt`: the latest kickoff, so the freeze
 *  backstop (`startsAt + MAX_EVENT_DURATION`) outlives every leg. */
export function comboStartsAt(legs: readonly Pick<LegCandidate, "kickoffAt">[]): number {
  return Math.max(...legs.map((l) => l.kickoffAt));
}

/** D-105 season flag for the combo pool: dynamic fee if any leg is a playoff game. */
export function comboPlayoffs(legs: readonly Pick<LegCandidate, "playoffs">[]): boolean {
  return legs.some((l) => l.playoffs);
}
