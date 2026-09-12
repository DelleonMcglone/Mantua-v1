/**
 * T-021 / T-022 — probability provenance. Every probability the consumer
 * layer renders comes through here so the user can never confuse the
 * market's own price with a provider's projection or the agent's estimate.
 * Pure: no React, no `@/` imports.
 */

export type ProbabilityKind = "market" | "projection" | "model";

export interface ProbabilitySource {
  kind: ProbabilityKind;
  /** Chip text next to the number. */
  label: string;
  /** One line for a tooltip / footnote. */
  detail: string;
}

/** Standing line under any agent or model output. */
export const PREDICTION_NOTE =
  "Agent and model figures are estimates from live data, not a guarantee of any outcome. Markets can move against any view.";

/**
 * Classify a probability by where it came from. `liveOdds` is the slate's
 * flag for "this is the pool price" (live-odds.ts); `model` marks a number
 * produced by the agent or an analysis rather than by trades.
 */
export function probabilitySource(input: {
  liveOdds?: boolean;
  model?: boolean;
}): ProbabilitySource {
  if (input.model) {
    return {
      kind: "model",
      label: "Agent estimate",
      detail:
        "The agent's own read of the matchup — an estimate, not the market and not a guarantee.",
    };
  }
  if (input.liveOdds) {
    return {
      kind: "market",
      label: "Market price",
      detail: "Set by trades in this market right now. A contract at 62¢ implies a 62% chance.",
    };
  }
  return {
    kind: "projection",
    label: "Projection",
    detail: "The data provider's pre-game line. It is not a market price and nothing trades at it.",
  };
}

export interface FormattedProbability {
  percent: string;
  cents: string;
}

/**
 * Basis points → "63%" and "63¢" for the requested side (side 1 is the
 * complement). Cents are clamped into 1–99¢, the band a contract can trade
 * in; the percent is unclamped.
 */
export function formatProbability(
  homeBps: number | undefined,
  side: 0 | 1 = 0,
): FormattedProbability {
  if (typeof homeBps !== "number" || !Number.isFinite(homeBps)) return { percent: "—", cents: "—" };
  const bps = side === 0 ? homeBps : 10_000 - homeBps;
  const rounded = Math.round(bps / 100);
  return {
    percent: `${String(rounded)}%`,
    cents: `${String(Math.max(1, Math.min(99, rounded)))}¢`,
  };
}
