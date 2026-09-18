/**
 * Phase 11 (D-003) — the analyst's research shaped for the page. The
 * probability is an agent estimate and is labelled as one (T-021); the
 * evidence keeps its direction and size; the action is a sentence, not a
 * button. Pure; rendered by `ResearchSection.tsx`.
 */
import type { AnalysisRead, EvidenceItem } from "./depth-types.ts";

export interface EvidenceLine {
  factor: string;
  detail: string;
  /** "+2.5 pts" / "−1.0 pts" / "0 pts". */
  effect: string;
  direction: "up" | "down" | "flat";
}

export interface ResearchView {
  team: string;
  /** "58%" — the model's win probability for the analysed side. */
  probability: string;
  confidence: "low" | "medium" | "high";
  /** "Model 6 pts above the 52¢ market price" or null when unpriced. */
  versusMarket: string | null;
  evidence: EvidenceLine[];
  risks: string[];
  action: string;
  rationale: string;
  disclaimers: string[];
}

const pts = (bps: number): string => `${(Math.abs(bps) / 100).toFixed(1)} pts`;

export function evidenceLine(e: EvidenceItem): EvidenceLine {
  const direction = e.effectBps > 0 ? "up" : e.effectBps < 0 ? "down" : "flat";
  const sign = direction === "up" ? "+" : direction === "down" ? "−" : "";
  return { factor: e.factor, detail: e.detail, effect: `${sign}${pts(e.effectBps)}`, direction };
}

export function actionSentence(read: AnalysisRead): string {
  switch (read.analysis.suggestedAction.kind) {
    case "consider_buy_yes":
      return `The model sees value in ${read.team} at this price.`;
    case "consider_fade":
      return `The model leans toward ${read.opponent} at this price.`;
    case "hold":
      return "The model sees no edge over the market.";
    case "no_market_price":
      return "No market price yet to compare the model against.";
  }
}

export function researchView(read: AnalysisRead | null): ResearchView | null {
  if (!read || read.status !== "ok") return null;
  const a = read.analysis;
  const market = read.market?.impliedProbabilityBps ?? null;
  const versusMarket =
    a.discrepancyBps === null || market === null
      ? null
      : Math.abs(a.discrepancyBps) < 50
        ? `Model in line with the ${String(Math.round(market / 100))}¢ market price`
        : `Model ${pts(a.discrepancyBps)} ${a.discrepancyBps > 0 ? "above" : "below"} the ${String(Math.round(market / 100))}¢ market price`;
  return {
    team: read.team,
    probability: `${String(Math.round(a.probabilityBps / 100))}%`,
    confidence: a.confidence,
    versusMarket,
    evidence: a.evidence.map(evidenceLine),
    risks: a.riskFactors,
    action: actionSentence(read),
    rationale: a.suggestedAction.rationale,
    disclaimers: a.disclaimers,
  };
}
