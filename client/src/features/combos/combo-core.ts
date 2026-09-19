import { feeLines, feeExceedsCeiling, type FeeLine } from "../markets/fee-lines.ts";
import { feeSummary, usdcCeil2, type FeeQuoteWire } from "../markets/market-trade-core.ts";

/**
 * Task 072 / CB-002 … CB-004, CB-008 — the pure half of combos: the wire
 * shapes of `/api/combos*`, the builder's leg list, and every line the
 * ticket and the positions section render. Every number comes from the
 * server's quote; nothing is re-derived here. No React, so it runs under
 * node:test.
 */

export interface ComboLegRef {
  providerEventId: string;
  outcomeIndex: 0 | 1;
}

/** A leg as the builder holds it — the game row's own facts, frozen at the tap. */
export interface BuilderLeg extends ComboLegRef {
  teamName: string;
  opponentName: string;
  league: string;
  kickoffAt: number;
}

export type LegResult = "pending" | "won" | "lost" | "void";

export interface ComboLegWire extends ComboLegRef {
  marketId: string;
  teamName: string;
  opponentName: string;
  league: string | null;
  kickoffAt: number;
  priceBps: number | null;
  oddsMultiplier: number | null;
  result: LegResult;
  separateFeeUsdcRaw: string | null;
}

export interface ComboQuoteOk {
  ok: true;
  marketId: string;
  label: string;
  source: "pool" | "planned";
  deployed: boolean;
  exists: boolean;
  stakeRaw: string;
  fairProbabilityBps: number;
  effectivePriceBps: number;
  combinedOdds: number;
  sharesRaw: string;
  potentialPayoutRaw: string;
  premiumBps: number;
  fee: FeeQuoteWire;
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
  violations: { code: string; marketId: string | null; detail: string }[];
  legs: ComboLegWire[];
}

export type ComboQuoteResult = ComboQuoteOk | ComboQuoteRefused;

/** Toggle a leg: the same team again removes it; a different side of the same game replaces it. */
export function toggleLeg(legs: readonly BuilderLeg[], leg: BuilderLeg): BuilderLeg[] {
  const same = legs.find(
    (l) => l.providerEventId === leg.providerEventId && l.outcomeIndex === leg.outcomeIndex,
  );
  if (same) return legs.filter((l) => l !== same);
  return [...legs.filter((l) => l.providerEventId !== leg.providerEventId), leg];
}

export function removeLeg(legs: readonly BuilderLeg[], ref: ComboLegRef): BuilderLeg[] {
  return legs.filter(
    (l) => !(l.providerEventId === ref.providerEventId && l.outcomeIndex === ref.outcomeIndex),
  );
}

export function legRefs(legs: readonly BuilderLeg[]): ComboLegRef[] {
  return legs.map((l) => ({ providerEventId: l.providerEventId, outcomeIndex: l.outcomeIndex }));
}

/** "2.50x" for a price in bps; "—" when unknown. */
export function oddsLabel(bps: number | null): string {
  return bps === null || bps <= 0 ? "—" : `${(10_000 / bps).toFixed(2)}x`;
}

export function pctLabel(bps: number | null): string {
  return bps === null ? "—" : `${(bps / 100).toFixed(0)}%`;
}

/** "Pays $38.00 if all 3 legs win · 3.85x" */
export function payoutLine(
  q: Pick<ComboQuoteOk, "potentialPayoutRaw" | "combinedOdds" | "legs">,
): string {
  const pays = (Number(q.potentialPayoutRaw) / 1e6).toFixed(2);
  return `Pays $${pays} if all ${String(q.legs.length)} legs win · ${String(q.combinedOdds)}x`;
}

/**
 * CB-004 — the same Position / Fee / Fee rate / Total lines a single
 * trade shows, from the hook's quote, plus what the legs would cost as
 * separate tickets when every leg could be quoted. A quote above the fee
 * ceiling renders nothing, as on the trade ticket.
 */
export function comboFeeLines(q: ComboQuoteOk): FeeLine[] {
  if (feeExceedsCeiling(q.fee)) return [];
  const lines = feeLines(feeSummary(q.stakeRaw, q.fee), "buy");
  if (q.separateTicketsFeeUsdcRaw !== null) {
    lines.push({
      label: "Same legs as separate tickets",
      value: `$${usdcCeil2(BigInt(q.separateTicketsFeeUsdcRaw))} fee`,
    });
  }
  return lines;
}

/** One line on the price the pool charges over fair — honest about a thin pool. */
export function premiumLine(
  q: Pick<ComboQuoteOk, "premiumBps" | "source" | "fairProbabilityBps">,
): string {
  const fair = `${(q.fairProbabilityBps / 100).toFixed(1)}% fair`;
  if (q.source === "planned") return `${fair} · opening price, the market opens on confirm`;
  if (q.premiumBps <= 0) return `${fair} · at or below fair`;
  return `${fair} · pool ${(q.premiumBps / 100).toFixed(1)} pts above fair`;
}
