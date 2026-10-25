import { AUTONOMY_RULES, type AutonomyRules } from "./autonomy-config.ts";
import type { Metrics } from "./scoring.ts";

/**
 * Current status against each autonomy rule, pure. Reported, never acted
 * on: a pass here is information for the owner, not a change to the cap.
 */
export interface RuleStatus {
  rule: string;
  passing: boolean;
  detail: string;
}

export interface ReadinessReport {
  rulesVersion: string;
  passing: boolean;
  rules: RuleStatus[];
  /** The cap step the rules would unlock next, when every rule passes. */
  nextCapUsdc: number | null;
}

export function autonomyReadiness(
  all: Metrics,
  byLeague: Record<string, Metrics>,
  rules: AutonomyRules = AUTONOMY_RULES,
  currentCapUsdc: number | null = null,
): ReadinessReport {
  const bands = all.bins.filter((b) => b.count > 0);
  const thinBands = bands.filter((b) => b.count < rules.minSettledPerBand);
  const leagues = Object.entries(byLeague);
  const thinLeagues = leagues.filter(([, m]) => m.n < rules.minSettledPerLeague);
  const fullBands = bands.filter((b) => b.count >= rules.minSettledPerBand);
  const worstBand = fullBands.reduce(
    (w, b) => Math.max(w, Math.abs((b.meanPredictedBps ?? 0) - (b.hitRateBps ?? 0))),
    0,
  );
  const beats =
    all.agent.brier !== null &&
    all.reference.brier !== null &&
    all.agent.brier < all.reference.brier;

  const statuses: RuleStatus[] = [
    {
      rule: `at least ${String(rules.minSettledPerBand)} settled forecasts in every probability band used`,
      passing: bands.length > 0 && thinBands.length === 0,
      detail:
        bands.length === 0
          ? "no settled forecasts yet"
          : thinBands.length === 0
            ? `${String(bands.length)} bands, all full`
            : `${String(thinBands.length)} of ${String(bands.length)} bands short: ${thinBands.map((b) => `${String(b.fromBps / 100)}–${String(b.fromBps / 100 + 10)}% (${String(b.count)})`).join(", ")}`,
    },
    {
      rule: `at least ${String(rules.minSettledPerLeague)} settled forecasts per league`,
      passing: leagues.length > 0 && thinLeagues.length === 0,
      detail:
        leagues.length === 0
          ? "no league settled yet"
          : thinLeagues.map(([l, m]) => `${l}: ${String(m.n)}`).join(", ") || "all leagues full",
    },
    {
      rule: `calibration error at most ${String(rules.maxCalibrationErrorBps / 100)} points in every full band`,
      passing: fullBands.length > 0 && worstBand <= rules.maxCalibrationErrorBps,
      detail:
        fullBands.length === 0
          ? "no band has enough data"
          : `worst full band off by ${String(worstBand / 100)} points`,
    },
    {
      rule: "agent Brier score beats the reference price on the same records",
      passing: beats,
      detail:
        all.agent.brier === null || all.reference.brier === null
          ? "not enough scored records with a reference"
          : `agent ${all.agent.brier.toFixed(4)} vs reference ${all.reference.brier.toFixed(4)} over ${String(all.reference.n)}`,
    },
  ];
  const passing = statuses.every((s) => s.passing);
  const next =
    rules.capStepsUsdc.find((c) => currentCapUsdc === null || c > currentCapUsdc) ?? null;
  return {
    rulesVersion: rules.version,
    passing,
    rules: statuses,
    nextCapUsdc: passing ? next : null,
  };
}
