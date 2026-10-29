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
