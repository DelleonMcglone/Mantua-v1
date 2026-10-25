/**
 * The rules that unlock autonomy, as versioned config written before any
 * results exist, so the line cannot move on a good or a bad week. A change
 * here is a new `version`; the old one stays in git history. Nothing in
 * this module changes trading behaviour — readiness is reported, the
 * auto-execute cap is still the policy the user set.
 */
export interface AutonomyRules {
  version: string;
  writtenOn: string;
  /** Settled, scoreable forecasts needed in every probability band that has any. */
  minSettledPerBand: number;
  /** Settled, scoreable forecasts needed per league. */
  minSettledPerLeague: number;
  /** Largest |mean predicted − hit rate| allowed in any band with enough data, bps. */
  maxCalibrationErrorBps: number;
  /** The agent's Brier must beat the reference price's on the same records. */
  mustBeatReferenceBrier: true;
  /** Each pass raises the auto-execute cap by one step (USDC); outside the cap stays preview-and-confirm. */
  capStepsUsdc: readonly number[];
}

export const AUTONOMY_RULES: AutonomyRules = {
  version: "2026-10-24.1",
  writtenOn: "2026-10-24",
  minSettledPerBand: 30,
  minSettledPerLeague: 100,
  maxCalibrationErrorBps: 700,
  mustBeatReferenceBrier: true,
  capStepsUsdc: [25, 50, 100, 250, 500],
};
