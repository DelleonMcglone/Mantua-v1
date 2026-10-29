# Task 001 — NFL Probability Estimator Audit and Validation

**Status:** Proposed — implementation not started  
**Suggested branch:** `001-nfl-probability-estimator-validation`  
**Primary module:** `server/src/lib/agent/sports-intelligence.ts`  
**Product:** Mantua.AI — independent sports forecasting and prediction-market edge discovery

## 1. Objective

Improve and validate Mantua's **independently calculated NFL win probabilities** so that users can assess whether Mantua has a defensible forecasting edge relative to executable prediction-market prices. **Do not substitute sportsbook or market probabilities for the agent's forecast.**

The immediate investigation is why Mantua estimated **51.2% Green Bay win probability** while contemporaneous reference prices were approximately **62–64%**. A difference alone does not establish which forecast is better.

## 2. Confirmed Current Architecture

- **Sportradar** provides schedules, scores, live game state, and weekly injury reports; Mantua does not subscribe to Sportradar Odds.
- The agent's estimator in `server/src/lib/agent/sports-intelligence.ts` calculates the forecast internally. No provider probability is displayed as the agent's forecast.
- The estimator starts each side at **50%** and applies `ESTIMATOR_WEIGHTS` for venue, season-record gap (regressed toward .500 early in the season), last-three-game form, injuries (including a quarterback-on-injured-reserve rule and a 20-point cap), head-to-head history, and in-game score margin.
- Every forecast row is stamped with the estimator model version.
- **ESPN sportsbook-implied home-win probability** is stored separately as a reference line, currently including vig; it is not used to replace the independent estimate.
- The existing calibration ledger compares agent forecasts with that sportsbook reference. This is **market comparison**, not by itself a test of predictive accuracy against actual outcomes.

**Not yet verified:** exact weight values, units, code paths, availability of historical input snapshots, data completeness, or any demonstrated historical model advantage. These require repository inspection.

## 3. Goals and Measurable Success Criteria

| Goal                                           | Success criteria                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1 — Explain the 51.2% forecast**            | Reproduce the Green Bay forecast from the recorded input snapshot, enumerate each adjustment with its units, and reconcile the output to 51.2% within the estimator's display-rounding tolerance. If inputs were not saved, document the reconstruction limitation. |
| **G2 — Audit data and methodology**            | Trace every input from provider response to final probability; verify timestamps, missing-data behavior, weight units, normalization, caps, and potential double-counting.                                                                                          |
| **G3 — Improve independent predictive inputs** | Evaluate opponent-adjusted team strength, QB performance/availability, offensive and defensive efficiency, and context features. Add only features available **before** the forecast timestamp and supported by an identified data source.                          |
| **G4 — Establish real calibration**            | Score timestamped pregame forecasts against final game outcomes using Brier score, log loss, and reliability bins; compare with a contemporaneous, de-vigged market baseline where available.                                                                       |
| **G5 — Validate improvements**                 | Run chronological, out-of-sample backtests of the current heuristic and proposed alternatives on the same eligible games; report sample sizes, uncertainty, and performance by season and probability range.                                                        |
| **G6 — Quantify actionable edge**              | Define edge as independent estimated fair probability minus executable market-implied probability, after accounting for fees, spread, slippage, and available liquidity; distinguish theoretical edge from realized returns.                                        |
| **G7 — Make confidence defensible**            | Replace unsupported “high confidence” claims with confidence labels based on documented validation and data quality; suppress or qualify confidence when evidence is insufficient.                                                                                  |

**Decision gate:** Do not deploy a replacement estimator solely because its probabilities are closer to sportsbook or prediction-market consensus. Require better out-of-sample calibration and predictive performance, with uncertainty and sample-size limitations disclosed.

## 4. Scope

### In scope

- Audit `ESTIMATOR_WEIGHTS`, calculation paths, feature transformations, and probability bounds.
- Separate **pregame** forecasting from **live/in-play** forecasting; evaluate them independently.
- Check injury severity, QB-on-IR treatment, injury caps, and whether existing team statistics already reflect absences.
- Review ESPN odds parsing, vig handling, event matching, and timestamp alignment.
- Specify independent model candidates and data prerequisites.
- Build reproducible historical evaluation and regression tests.
- Document forecast provenance, model versions, and monitoring metrics.

### Out of scope for this task

- Purchasing Sportradar Odds or other paid feeds without approval.
- Replacing the agent's forecast with an ESPN, Polymarket, or Kalshi probability.
- Claiming proven betting profitability from retrospective probability differences.
- Production-scale model infrastructure without explicit approval.

## 5. Implementation Plan

### Phase 1 — Reproduce and audit the current estimator

- [ ] Locate the estimator and record the exact `ESTIMATOR_WEIGHTS`, feature units, and normalization formulas.
- [ ] Identify the Green Bay–Carolina forecast row, model version, input timestamps, and available raw-data snapshot.
- [ ] Recompute every contribution to the **51.2%** result and explain discrepancies.
- [ ] Inspect how early-season record regression and recent-form adjustments interact.
- [ ] Test missing or stale injuries, QB-on-IR rules, injury caps, and double-counting.
- [ ] Confirm head-to-head treatment and ensure future results cannot leak into pregame predictions.
- [ ] Trace live-score adjustments separately; ensure live information never contaminates a pregame forecast.
- [ ] Document findings and classify issues by severity.

**Deliverable:** Reproducible estimator audit, with an adjustment-by-adjustment forecast breakdown or a documented explanation of why exact reconstruction is unavailable.

### Phase 2 — Establish a reliable evaluation dataset

- [ ] Define a historical game dataset with kickoff time, forecast timestamp, final outcome, model version, and input availability.
- [ ] Determine whether historical input snapshots exist; do **not** backfill past predictions using postgame knowledge.
- [ ] Match sportsbook reference odds to the correct game, side, and timestamp.
- [ ] Convert both sides of sportsbook odds to implied probabilities and remove vig using a documented method.
- [ ] Record missing data, excluded games, and exclusion reasons.
- [ ] Establish a fixed pregame forecast cutoff and separate live forecast evaluation by game state.

**Deliverable:** Versioned evaluation specification and reproducible dataset-building procedure.

### Phase 3 — Benchmark and improve the estimator

- [ ] Write failing tests for expected estimator invariants and known edge cases before modifying production logic.
- [ ] Benchmark the existing heuristic on chronologically held-out seasons or weeks.
- [ ] Evaluate opponent-adjusted team strength and efficiency metrics where legally and technically available.
- [ ] Evaluate QB-specific strength/availability and player-specific injury impact.
- [ ] Compare a refined heuristic with a calibrated statistical model; retain a transparent feature-contribution explanation.
- [ ] Tune on training data only; keep test periods untouched until final evaluation.
- [ ] Use a principled probability transformation/calibration method instead of assuming additive heuristic points equal calibrated probability points.
- [ ] Preserve independent forecasts and stable model-version identifiers.

**Deliverable:** Model comparison with measured benefits, costs, failure modes, and a deployment recommendation.

### Phase 4 — Edge, confidence, and observability

- [ ] Separate the agent forecast, sportsbook reference, and prediction-market executable quote in the data model and UI.
- [ ] Compute net-of-cost theoretical edge with consistent side/outcome definitions and timestamps.
- [ ] Track Brier score, log loss, calibration bins, and sample counts against final outcomes.
- [ ] Report market comparison separately from outcome-based accuracy.
- [ ] Define confidence rules based on empirical calibration, sample size, and data quality.
- [ ] Add alerts or diagnostics for missing inputs, stale odds, extreme probabilities, and major forecast/market divergences.
- [ ] Update architecture and operator documentation.

**Deliverable:** Auditable edge and confidence specifications with validation tests.

## 6. Test-Driven Development and Required Test Cases

Write a failing test for each new behavior, implement the smallest correct change, then refactor with all tests passing.

- **Probability invariants:** Outputs are finite, bounded between 0 and 1, and stable for identical versioned inputs.
- **Team/side consistency:** Home/away mappings and win/loss outcomes cannot be silently reversed.
- **Neutral inputs:** Equal teams with neutral adjustments produce the documented neutral baseline.
- **Early season:** No games played, ties, and small samples do not create misleading record advantages.
- **Injury cases:** QB on IR, duplicate injury entries, stale reports, multiple injuries, and cap boundaries behave as specified.
- **Double counting:** Injury changes are not counted twice when underlying team-strength features already incorporate absences.
- **Head-to-head:** Old or irrelevant matchups cannot dominate current team-strength evidence.
- **Time leakage:** No post-kickoff or postgame features enter a pregame forecast; live forecasts use only information available at their timestamp.
- **Odds comparison:** Decimal/American odds conversion, vig removal, stale quotes, missing sides, and event mismatches are handled explicitly.
- **Calibration:** Brier/log-loss calculations match known test fixtures and use actual outcomes, not sportsbook probabilities, as labels.
- **Data quality:** Missing or contradictory provider fields produce documented behavior and appropriate confidence qualifications.
- **Versioning:** A change in estimator behavior creates a new identifiable model version.

## 7. Failure Conditions

The task fails acceptance if any of the following occur:

- A sportsbook or market probability silently replaces the agent-generated probability.
- Historical evaluation uses information unavailable at the forecast timestamp.
- Market agreement is reported as predictive accuracy, or a single game is presented as proof of edge.
- A model is promoted without reproducible out-of-sample evaluation.
- Confidence labels claim statistical certainty without supporting validation.
- Missing or stale inputs are silently treated as reliable observations.
- Tests fail, required documentation is outdated, or forecast provenance is lost.

## 8. Engineering Controls

- **Before coding:** Confirm task scope and acceptance criteria; create the matching task branch and review the task plan.
- **Dependency policy:** Prefer existing dependencies. If new packages are needed, pin exact versions and verify maintenance, adoption, and security advisories before installation.
- **Security:** No secrets in source, logs, test fixtures, or documentation. Validate provider payloads and market quotes.
- **Code quality:** Follow existing repository conventions, avoid duplicate estimator implementations, keep modules focused, and document function inputs/outputs.
- **Documentation:** Update `docs/architecture.md`, model methodology, data-source contracts, and relevant run/test instructions when code changes.
- **Verification:** Run unit tests, integration/regression tests, lint, and type checking; independently review changes before merge.
- **Review:** Obtain the required task-plan and code reviews when the designated reviewers/tools are available; do not claim reviews occurred unless performed.

## 9. Definition of Done

- [ ] The current 51.2% example is reproduced or its reconstruction limitations are documented.
- [ ] All estimator features, weights, units, and data sources are documented.
- [ ] Historical evaluation uses timestamp-safe data and actual final outcomes.
- [ ] Existing heuristic and proposed models are compared on the same held-out samples.
- [ ] Model selection is supported by measured calibration and predictive performance.
- [ ] Market comparisons use aligned, de-vigged reference prices where appropriate.
- [ ] Edge calculations account for executable costs and do not imply guaranteed profit.
- [ ] Confidence labels have explicit empirical criteria.
- [ ] Tests, lint, and type checks pass; documentation and model versioning are updated.
- [ ] Required reviews are completed and feedback is addressed before merge.

## 10. Immediate Next Action

Inspect `server/src/lib/agent/sports-intelligence.ts`, its tests, the forecast-row schema, and the calibration ledger. Produce a precise audit of the **51.2% Green Bay forecast** before selecting or implementing a replacement model.

> **Guiding principle:** Mantua's advantage should come from independently validated forecasting performance and executable market opportunities—not from adjusting its forecasts to match consensus.
