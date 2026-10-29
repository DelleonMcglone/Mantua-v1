# Task 079 — NFL probability estimator: Phase 1 audit (the Green Bay 51.2%)

Owner brief, 2026-10-29: `mantua-nfl-probability-estimator-goals.md` ("Task 001 —
NFL Probability Estimator Audit and Validation"; repository task number 079;
prompt history `2026-10-29-estimator-audit.md`). This document is the Phase 1
deliverable: reproduce the 51.2% Green Bay forecast, trace every input from
provider to probability, and classify what was found. **No model logic was
changed.** The decision gate in the brief stands: nothing is promoted for
being closer to consensus.

## 1. G1 — The 51.2% reproduced exactly

Packers (home) vs Panthers, providerEventId `401873023`, kickoff
2026-10-30 00:15 UTC. Pulled live from `/api/markets/analysis` at 23:05 UTC
on 2026-10-29, 70 minutes before kickoff, so every input below is pregame.
Pinned by `server/src/lib/agent/sports-intelligence-audit.test.ts`.

| Step          | Input                                                                                                                                                                        | Formula                                                       | bps                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------- |
| Baseline      |                                                                                                                                                                              |                                                               | 5000                        |
| Venue         | Green Bay at home (nfl)                                                                                                                                                      | +250                                                          | +250                        |
| Season record | GB 4-3 vs CAR 3-3                                                                                                                                                            | ((4+4)/(7+8) − (3+4)/(6+8)) × 5000 = (0.5333 − 0.5000) × 5000 | +167                        |
| Recent form   | GB LWWWL vs CAR LWWLW (last 5 finals)                                                                                                                                        | ((3+1.5)/8 − (3+1.5)/8) × 2000                                | 0                           |
| Injuries      | GB: 4 out (Parsons DE, Franklin LB, Glover OT, Rhyan G) = 600, 4 questionable = 200, Monk C on IR = 0 → 800. CAR: 3 out = 450, 1 questionable = 50, Moton OT on IR = 0 → 500 | 500 − 800                                                     | −300                        |
| Head-to-head  | none on file (the catalog holds only this season; no prior meeting)                                                                                                          | skipped                                                       | 0                           |
| Live score    | pregame                                                                                                                                                                      | skipped                                                       | 0                           |
| **Total**     |                                                                                                                                                                              |                                                               | **5117 = 51.17% → "51.2%"** |

The away side is the exact complement (4883). Confidence came out **high**.

**Reference at the same moment.** ESPN's odds block (DraftKings): home close
−180, away close +150; open was −325 / +260. Implied 0.6429 and 0.4000,
normalized proportionally → **6164 bps (61.6%)**. The agent sat 1047 bps
under the book. Note the line itself moved from ~69.7% (open, de-vigged)
to 61.6% during the week — toward the agent — most plausibly on the
Parsons and offensive-line news.

**Reconstruction limitation.** This was reproduced from a _live pregame
read_, not from a ledger row. The forecast ledger (`forecasts`) held **zero
rows** on 2026-10-29 (`/api/calibration` → `totals.records: 0`). See F-1.

## 2. G2 — Provenance, input by input

| Input                    | Source                                                                                                              | Path                                                                                  | Timestamp / history                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schedule, status, scores | Sportradar (primary) / ESPN (fallback)                                                                              | `cron-sports-sync` daily + `cron-live-sync` every 5 min around games → `upsertEvents` | Row is overwritten in place; `last_polled_at` only. **No history.**                                                                                                                                                                                                                                                                 |
| Season record            | provider standings → `team_records` (season, seasonType, W-L-T)                                                     | `sideFacts` → `recordOf` picks the latest season                                      | Overwritten in place. **No history**, but reconstructible from finals in `events`.                                                                                                                                                                                                                                                  |
| Recent form              | last 5 **final** events for the team, newest first                                                                  | `sideFacts(limit = 5)`                                                                | Derived from `events`; reconstructible by date.                                                                                                                                                                                                                                                                                     |
| Injuries                 | Sportradar weekly injuries → `injuries` (status, position, `reported_at`, `resolved_at`)                            | `listOpenInjuriesForTeam` = `resolved_at IS NULL`                                     | `reported_at` / `resolved_at` give a _coarse_ history (open interval), but status changes (questionable → out) are not versioned.                                                                                                                                                                                                   |
| Head-to-head             | last 6 final meetings in `events`                                                                                   | `analyzeMarketInner`                                                                  | Only what has been ingested (this season).                                                                                                                                                                                                                                                                                          |
| Book line                | ESPN scoreboard `odds[0].moneyline.{home,away}.close` (fallback `open`, then spread via a normal CDF with σ = 13.5) | `espn-odds.ts` → `events.home_win_probability_bps`                                    | **Vig is removed** (proportional normalization) — the brief's "currently including vig" assumption is wrong. Overwritten on every poll, including in play; the only timestamped pregame copy is `forecast_outcomes.closing_book_bps`, captured once in the 5-minute window before kickoff, and only for games with a minted market. |
| Pool price               | on-chain `market_prices`                                                                                            | `getMarketOverview`                                                                   | Captured per tick with `captured_at`.                                                                                                                                                                                                                                                                                               |
| Model version            | hash of model id + system prompt + tool descriptions + `ESTIMATOR_WEIGHTS`                                          | `forecastModelVersion()`                                                              | Stamped on every ledger row.                                                                                                                                                                                                                                                                                                        |

Weights as deployed (`ESTIMATOR_WEIGHTS`, all in bps unless noted): home
advantage 250 (WNBA 300); record gap × 5000 with an 8-game .500 prior; form
gap × 2000 with a 3-game .500 prior over the last 5 finals; QB out/doubtful
700, QB questionable 250, other out/doubtful 150, other questionable 50, QB
on IR 700, other IR 0, cap 2000 per side; head-to-head share × 800 when ≥ 2
decided meetings; live margin 250/pt capped ±3000; clamp 500–9500; edge
threshold 500; "early season" below 6 games.

## 3. Findings, by severity

**F-1 (high) — The forecast ledger is empty; the numbers the owner sees are not in it.**
Five days after Task 077 deployed, `forecasts` has no rows. The surfaces the
owner actually reads — the market page's analysis panel
(`/api/markets/analysis`), the read-only analyst chat, and the X summary —
call `analyzeMarket` **without a sink** by design; only the Sports Agent
chat writes rows. So the 47% Eagles and 51.2% Packers forecasts have no
provenance record, and G4/G5 cannot start until rows exist. Fix is small and
within the brief's scope ("forecast provenance"): give the analysis route
and the summary path a sink with a distinct `source` (e.g. `page`, `post`),
coalesced per market per model version so the 60-second cache does not
spam rows.

**F-2 (high) — No historical dataset exists for a timestamp-safe backtest.**
Records and book lines are overwritten in place; injuries keep only an open
interval. A chronological evaluation (Phase 2) needs either (a) the ledger
to accumulate rows from now, or (b) a reconstruction that uses only
`events` (records and form by date, no injuries, no book line). Backfilling
past predictions with today's rows would violate the brief's leakage rule.
Recommendation: start accumulating now (F-1) and run the first honest
evaluation after ~60 scored games; in the meantime, reconstruct a
record-and-form-only variant from `events` as a lower bound.

**F-3 (medium) — Team strength is measured by record only, shrunk hard.**
A 4-3 team gets 53.3% strength after the 8-game prior, a 3-3 team 50.0%.
There is no point differential, no opponent adjustment, no efficiency
metric, no quarterback quality term. This is the main reason the estimate
sits near 50% for most games while books spread 35–70%. It is also why
Green Bay (a better team than its record) reads flat. G3 candidates in
order of data availability: point differential from `events` (already
ingested), then opponent-adjusted margin (also from `events`), then a QB
term (needs a source).

**F-4 (medium) — Injuries are flat per position class.**
Micah Parsons out costs Green Bay 150 bps, the same as a backup guard
(pinned in the audit test). The 20-point cap was raised on 2026-10-27
(D-124) but the per-player weights are uniform. There is no player-value
input in the catalog today.

**F-5 (medium) — Partial double counting between record and form.**
The last 5 finals are a subset of the 7-game record, so a win counts in
both terms. Bounded (form is × 2000 with a 3-game prior) and symmetric, but
it should be stated in the methodology and tested.

**F-6 (low) — Book line overwritten in play.**
`upsertEvents` writes ESPN's `close` on every poll. Whether ESPN's `close`
holds still once a game starts was not verified; if it tracks in-game
odds, the `events` copy after kickoff is contaminated. The ledger's
`closing_book_bps` is captured pre-kickoff and is the one to score against;
treat `events.home_win_probability_bps` as "latest", never "closing".

**F-7 (low) — "High confidence" is a breadth label.**
Confidence is high when three non-venue factors are present, both teams
have ≥ 6 games, the slate is fresh and the pool price is < 15 min old. It
says nothing about accuracy. G7 asks for calibration-backed labels; until
the ledger has ≥ 30 settled rows per band (the autonomy rule), the honest
label is "medium" at best. Pinned, not changed.

**F-8 (low) — Head-to-head window is "last 6 meetings on file".**
Harmless today (one season ingested) but will span seasons once more are,
and then old results could outweigh current strength. Add a season bound.

**No leakage found in the pregame path.** `recentForm` and head-to-head use
only finals; a scheduled game has no live block; the market summary and
chat pass `now`. The ledger's `after_kickoff` flag excludes in-play views
from scoring. Reconstructing a _past_ game from today's tables is where
leakage would enter (F-2), not the live path.

## 4. What this audit did not do

- Did not change any weight, rule or route (decision gate).
- Did not score accuracy: there are no settled ledger rows to score.
- Did not verify ESPN's in-play `close` semantics (F-6).
- Did not buy or evaluate paid data (out of scope).

## 5. Recommended next slices (each its own PR, owner call)

1. **Provenance (F-1):** record page, post and analyst views with their own
   `source`; one row per market per model version per hour. Unblocks G4.
2. **Reconstruction baseline (F-2):** a script that rebuilds record-and-form
   views by date from `events` for the season so far, labels them with
   finals, and reports Brier against the current book — clearly marked as a
   partial-input lower bound.
3. **Strength term (F-3):** point differential from `events`, behind a new
   weight so the model version changes; evaluate on slice 2 before enabling.
4. **Confidence (F-7):** gate "high" on ledger sample size and calibration.

## 6. Slice 1 delivered — provenance for the surfaces the owner reads (2026-10-29)

Owner: "ok, continue". Resolves F-1 without touching model logic.

- New forecast sources `page` (the market page's analysis panel,
  `/api/markets/analysis`) and `analyst` (the logged-out analyst's
  `mantua_analyze_market` and `mantua_probability_gaps`). Both record with
  `action: no_trade`, no user, no session. No migration: `source` is a
  varchar with no check constraint.
- `coalescedInsert` in `forecast-sink.ts`: one row per market, side, source
  and model version per hour (`COALESCE_WINDOW_MS`). The page sits behind a
  60-second cache and the analyst can be asked the same thing ten times;
  the view does not change until an input or the model does, so a second
  row inside the hour would only pad counts.
- The X post is agent-written text from chat research, which already
  records under `research`; nothing to add there.
- `uniqueViews` already counts every `no_trade` row as a view, so page and
  analyst reads enter the all-views slice and never the trades-only slice.
