import type { LegViolation } from "./combo-rules.ts";

/**
 * Task 072 / CB-002 … CB-004 — the wire shape of a combo quote. Every
 * number the ticket shows is here as a string of raw units or bps; the
 * client formats and never re-derives.
 */

export interface ComboLegWire {
  marketId: string;
  providerEventId: string;
  outcomeIndex: 0 | 1;
  teamName: string;
  opponentName: string;
  league: string | null;
  kickoffAt: number;
  priceBps: number | null;
  oddsMultiplier: number | null;
  result: "pending" | "won" | "lost" | "void";
  /** This leg's own hook fee for an equal split of the stake, raw; null when unquotable. */
  separateFeeUsdcRaw: string | null;
}

export interface FeeWire {
  feePips: number;
  ratePips: number;
  probabilityBps: number;
  playoffs: boolean;
  feeRaw: string;
  feeUsdcRaw: string;
}

export interface ComboQuoteOk {
  ok: true;
  marketId: string;
  label: string;
  startsAt: number;
  /** pool: the combo pool's own quote; planned: opening estimate, market not created yet. */
  source: "pool" | "planned";
  /** false when the market stack is not deployed on this chain. */
  deployed: boolean;
  exists: boolean;
  /** OPEN | FROZEN | … when it exists. */
  marketState: string | null;
  stakeRaw: string;
  fairProbabilityBps: number;
  effectivePriceBps: number;
  combinedOdds: number;
  sharesRaw: string;
  potentialPayoutRaw: string;
  premiumBps: number;
  fee: FeeWire;
  /** Sum of the legs' own fees as separate tickets, raw; null when any leg is unquotable. */
  separateTicketsFeeUsdcRaw: string | null;
  legs: ComboLegWire[];
  gate: { ok: boolean; reasons: string[] };
  limits: {
    maxLegs: number;
    maxStakeUsd: number;
    openExposureUsd: number;
    maxOpenExposureUsd: number;
  };
}

export interface ComboQuoteRefused {
  ok: false;
  violations: LegViolation[];
  legs: ComboLegWire[];
}

export type ComboQuoteResult = ComboQuoteOk | ComboQuoteRefused;
