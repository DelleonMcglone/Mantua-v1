# 2026-10-24 — Forecast ledger and calibration scoring

Owner prompt (verbatim summary of the brief): score the Mantua agent on
every forecast it makes, not just the trades it places. Build an
append-only forecast ledger (every probability the agent forms: scans it
passed on, "Fair" calls, proposals rejected or unfilled, fills), with
reference prices captured at the same time, a model version on every row,
and the inputs snapshot. Settle every record when the market settles.
Score Brier, log loss, ten calibration bins and closing-line value, with
the reference price as the baseline, sliced by all-vs-trades, proposed vs
not, league, horizon, liquidity, confidence and model version. Store the
autonomy-unlock rules as versioned config written before results exist,
and report readiness without changing trading behaviour. Log
time-to-decision and approve/reject for proposals. Expose `/calibration`
and a CSV export. Fit the existing data store, agent tool layer and
conventions; ask before changing trade execution.

Owner answers to the plan: outcomes in a separate per-market row (ok);
`/calibration` public; the one-line fill hooks are within bounds.

Delivered as Task 077 (`docs/tasks/077-forecast-ledger.md`).
