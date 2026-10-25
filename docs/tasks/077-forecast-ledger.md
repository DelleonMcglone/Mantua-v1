# Task 077 — Forecast ledger and calibration scoring

Owner request, 2026-10-24 (prompt history: `2026-10-24-forecast-ledger.md`).

Score the agent on every forecast it makes, not just the trades it places.
Every market settles whether the agent trades it or not, so every view the
agent forms is a forecast; scoring only trades is slow and biased because
the agent chooses which markets to trade.

## Delivery (four stacked PRs)

1. **Ledger** — `forecasts` table (migration 0033, append-only at the
   database with the `market_fills` trigger pattern), `lib/forecast/`
   (`forecast-record.ts` pure projection, `model-version.ts` hash of prompt
   - tools + estimator weights + model id, `forecast-sink.ts` fire-and-forget
     writer). The analyze tool takes an optional sink; the chat passes one on
     research (`mantua_analyze_market`), scans (`mantua_compare_markets`,
     `mantua_probability_gaps`), proposals (`mantua_simulate_trade`,
     `mantua_simulate_basket`) and fills (`mantua_execute_trade`,
     `mantua_execute_basket`, trade id = tx hash). A view at or after kickoff
     is stored with `after_kickoff` and excluded from scoring.
2. **Settlement** — `forecast_outcomes` (one row per market): the live tick
   captures the closing book line and pool price at the last pre-kickoff
   pass; the resolution writer records the outcome (1 / 0 / void). A
   negation reply to a pending preview appends `rejected_by_user`; the daily
   sync appends `unfilled` for proposals past the preview lifetime with no
   later fill or rejection.
3. **Scoring + API** — Brier, log loss, ten calibration bins, closing-line
   value, the reference-price baseline; slices (all vs filled, proposed vs
   not, league, horizon, liquidity, confidence, model version);
   `GET /api/calibration` (public) and `GET /api/ops/forecasts.csv`
   (cron secret). Human-in-the-loop health from proposal and decision times.
4. **Thresholds + view** — versioned autonomy config with a readiness report
   (no behaviour change) and the `/calibration` page.

## Decisions

- Outcomes live in `forecast_outcomes`, joined at scoring time, so forecast
  rows are never updated (owner, 2026-10-24).
- `/calibration` is public, like the agent's public ledger; the CSV export
  is behind the cron secret.
- The fill hooks are one call after each existing execute path; execution
  logic is untouched.
- Sells are exits, not forecasts: `mantua_sell_position` writes no row.
- The read-only analyst chat and `GET /api/markets/analysis` call the
  analyze tool without a sink; they are not the agent forming a view for a
  user's money and are left out for now.
