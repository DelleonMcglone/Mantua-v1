# 2026-10-29 — NFL probability estimator audit (Phase 1)

Owner prompts, in order:

1. "When Mantua receives the Sports Trader data, does the AI agent
   calculate the win probability itself, or does Sports Trader return a
   win probability that Mantua simply displays?" — Answered: the agent
   computes it in `sports-intelligence.ts`; Sportradar sends no
   probability; ESPN's sportsbook line is a reference only.
2. The owner's brief `mantua-nfl-probability-estimator-goals.md` ("Task
   001 — NFL Probability Estimator Audit and Validation"): explain the
   51.2% Green Bay forecast against a 62–64% reference, audit every input,
   establish real calibration against outcomes, validate any improvement
   out of sample, and never substitute a market probability for the
   agent's. Immediate next action: the audit, before any model change.

Delivered as Task 079 (`docs/tasks/079-nfl-probability-estimator-audit.md`):
the 51.2% reproduced exactly (5117 bps) from a live pregame read 70
minutes before kickoff and pinned by a regression test; provenance traced
for every input; eight findings classified, the two high ones being that
the forecast ledger is empty because the surfaces the owner reads record
nothing, and that no timestamp-safe history exists yet for a backtest. No
model logic changed.

Owner: "ok, continue" → slice 1 (provenance, F-1): sources `page` and
`analyst`, coalesced to one row per side per model version per hour, wired
into the analysis route and the analyst's two tools. No model change.

Slice 2 (F-2, history): `lib/forecast/reconstruct.ts` + `npm run
estimator:reconstruct` — record-and-form views rebuilt from prior finals
only, scored on weeks 1–7 (106 games): Brier 0.2450 vs 0.2500 coin flip.
A lower bound and the baseline any strength term must beat.

Owner: "ok, continue" (second) → slice 3: point-differential term built
behind `marginBpsPerPoint`, grid-evaluated on train weeks 1–4 / test 5–7.
No candidate beat the deployed weights out of sample, so the weight ships
at 0 (D-126). Full grid, 2026 season, Brier train / test / all:

| prior | margin | record | train  | test   | all    |
| ----- | ------ | ------ | ------ | ------ | ------ |
| 8     | 0      | 5000   | 0.2394 | 0.2535 | 0.2450 |
| 8     | 100    | 5000   | 0.2400 | 0.2584 | 0.2473 |
| 8     | 150    | 5000   | 0.2408 | 0.2617 | 0.2491 |
| 8     | 200    | 5000   | 0.2419 | 0.2655 | 0.2513 |
| 8     | 250    | 5000   | 0.2434 | 0.2696 | 0.2538 |
| 8     | 300    | 5000   | 0.2456 | 0.2733 | 0.2566 |
| 8     | 400    | 5000   | 0.2493 | 0.2797 | 0.2614 |
| 8     | 500    | 5000   | 0.2528 | 0.2813 | 0.2641 |
| 8     | 0      | 2500   | 0.2403 | 0.2509 | 0.2445 |
| 8     | 100    | 2500   | 0.2399 | 0.2537 | 0.2454 |
| 8     | 200    | 2500   | 0.2408 | 0.2587 | 0.2479 |
| 8     | 300    | 2500   | 0.2437 | 0.2649 | 0.2521 |
| 8     | 500    | 2500   | 0.2502 | 0.2716 | 0.2586 |
| 8     | 0      | 0      | 0.2423 | 0.2511 | 0.2458 |
| 8     | 100    | 0      | 0.2409 | 0.2518 | 0.2452 |
| 8     | 200    | 0      | 0.2408 | 0.2547 | 0.2463 |
| 8     | 300    | 0      | 0.2429 | 0.2594 | 0.2494 |
| 16    | 100    | 5000   | 0.2395 | 0.2563 | 0.2462 |
| 16    | 200    | 5000   | 0.2400 | 0.2599 | 0.2479 |
| 16    | 100    | 2500   | 0.2398 | 0.2524 | 0.2448 |
| 16    | 200    | 2500   | 0.2398 | 0.2547 | 0.2457 |
| 16    | 300    | 2500   | 0.2401 | 0.2579 | 0.2471 |
| 32    | 100    | 5000   | 0.2394 | 0.2550 | 0.2456 |
| 32    | 300    | 5000   | 0.2397 | 0.2588 | 0.2472 |
| 32    | 100    | 2500   | 0.2400 | 0.2516 | 0.2446 |
| 32    | 200    | 2500   | 0.2397 | 0.2527 | 0.2449 |
| 32    | 300    | 2500   | 0.2396 | 0.2540 | 0.2453 |
| 32    | 500    | 2500   | 0.2398 | 0.2574 | 0.2467 |
