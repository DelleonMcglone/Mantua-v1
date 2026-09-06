# 038 — Canonical sports data + Mantua market-data layer (S-005/S-006/S-007/S-008/S-010)

**Status:** 🟢 schema + read layer complete — ingestion wiring landed in task 041 (`041-ingestion-tools-wiring.md`)
**Branch:** `038-canonical-market-data`

Phase 3 rows S-005..S-008 and S-010: complete the canonical sports-data
model so the agent's sports and market questions are answered from
Mantua's own database — never a live provider call, never a web search —
and build Mantua's own market-data layer from what the platform already
records. This task owns **schema + READ layer only**; nothing here writes
the new tables — ingestion wiring belongs to the sibling ingest task.

## S-row coverage map (gap analysis)

| S-row | Data item                          | Where it lives                                                                     | Status before 038 | 038 delta                                             |
| ----- | ---------------------------------- | ---------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------- |
| S-005 | Schedule / live scores / finals    | `events` (status, scores, startsAt, lastPolledAt)                                   | ✅ existed (0009)  | —                                                     |
| S-005 | Live game state on the event       | `events.status/homeScore/awayScore` (Polymarket convention: live state on event)    | ✅ existed         | —                                                     |
| S-005 | **Play-by-play**                   | **`game_plays`** (new)                                                              | ❌ hole            | New table, append-only, unique (event, provider, seq) |
| S-006 | Team catalog                       | `teams` (key, names, logo, provider link)                                           | ✅ existed (0009)  | —                                                     |
| S-006 | **Standings / records**            | **`team_records`** (new): W-L-T, ranks, PF/PA, streak, home/away record strings     | ❌ hole (only the provider's display `record` string passed through the slate) | New table, unique (team, season, seasonType) |
| S-007 | Player catalog + injuries          | `players`, `injuries`                                                               | ✅ existed (0009)  | —                                                     |
| S-007 | **Team season stat aggregates**    | **`team_records.stats` jsonb** — same (team, season) dimension, no extra table      | ❌ hole            | jsonb + typed reader `teamSeasonStats`                |
| S-007 | **Player season stats**            | **`players.season_stats` jsonb**, keyed by season label                             | ❌ hole            | New column + typed reader `playerSeasonStats`         |
| S-008 | Recent games for a team            | finished `events` rows                                                              | data existed, no read path | `getRecentGames` (history.ts)                 |
| S-008 | Head-to-head                       | finished `events` rows                                                              | no read path      | `getHeadToHead`                                       |
| S-008 | Home/away splits                   | finished `events` rows                                                              | no read path      | `getHomeAwaySplits`                                   |
| S-008 | Situational trends                 | finished `events` + `markets.openingProbability` (favorite/underdog off OUR lines)  | no read path      | `getSituationalTrends`                                |
| S-008 | Historical Mantua market prices    | `market_prices` joined markets → events/teams                                       | data existed, no read path | `getMarketPriceHistory`, `getTeamMarketPriceHistory` |
| S-010 | Current price + history            | `market_prices` (fallback `markets.openingProbability`)                             | recorded, unserved | market-metrics.ts `price` block                      |
| S-010 | Volume (24h/total)                 | `market_fills` USDC aggregates                                                      | recorded, unserved | `volume` block                                        |
| S-010 | Open interest                      | unredeemed `market_positions` + YES-token totalSupply (RPC, null pre-deployment)    | recorded, unserved | `openInterest` block                                  |
| S-010 | Trading activity                   | `market_fills` counts/recency/unique traders                                        | recorded, unserved | `activity` block                                      |
| S-010 | Position concentration             | BaseScan token-holders read (the market-detail holders pattern)                     | pattern existed    | `concentration` block (null best-effort)              |
| S-010 | Liquidity                          | `market_prices.liquidityRaw` capture + live v4 StateView `getLiquidity`             | recorded, unserved | `liquidity` block — **null pre-deployment** (MARKETS_PERIPHERY_BY_CHAIN empty) |
| S-010 | Time-to-kickoff / resolution       | `events.startsAt`, `markets.frozenAt/resolvedAt`                                    | data existed       | `timing` block                                        |
| S-010 | Market status                      | `markets.state` + event status                                                      | existed            | surfaced on the snapshot                              |

## Schema delta — migration `0013_canonical_sports_stats.sql`

Hand-written idempotent SQL (IF NOT EXISTS) per the 0009/0012 convention;
journal entry appended (idx 13). Verified: full 0000→0013 chain applies to
a scratch Postgres via psql, and 0013 re-applies as a clean no-op.

- **`game_plays`** — append-only play-by-play. `(event_id, provider,
  sequence)` unique makes re-ingest idempotent; `(event_id, sequence)`
  index serves the "plays for this game in order" read. Provider extras
  ride a `detail` jsonb.
- **`team_records`** — standings/record snapshot per (team, season,
  seasonType): W-L-T, division/conference rank, PF/PA, streak, provider
  home/away record strings, and a `stats` jsonb carrying team season stat
  aggregates (S-007) — same key dimension, so no second table.
- **`players.season_stats`** — jsonb keyed by season label for player
  season aggregates. Jsonb-over-table on purpose: stat categories differ
  per sport/provider; typed readers live in the read layer.

Schema files: `server/src/db/schema/sports-stats.ts` (new, exported from
`schema/index.ts`) + the `seasonStats` column added to `players` in
`schema/markets.ts`.

## S-008 — historical read layer (`server/src/lib/sports/history.ts`)

Pure `compute*` functions over plain row shapes with thin drizzle fetch
wrappers (the strategy-engine testing pattern — the tests never touch a
DB). Every entry point returns `HistoryResult<T>`: `{ok: true, data}` or
`{ok: false, reason: "insufficient_data", detail}` — **an empty canonical
table is an explicit refusal to answer, never zeros and never a guess.**

- `getRecentGames` / `getHeadToHead` / `getHomeAwaySplits` — off finished
  `events` (status `final`, both scores present).
- `getSituationalTrends` — recent form, streak, average margin, and
  favorite/underdog splits derived from Mantua's own opening lines
  (`markets.openingProbability`, home moneyline). Games without a minted
  market count for form but not for the favorite/underdog split; with no
  lines at all those fields are `null`.
- `getStandings` — `team_records` joined to teams/leagues, with
  `updatedAt` surfaced as the staleness signal.
- `getMarketPriceHistory` / `getTeamMarketPriceHistory` — the
  `market_prices` series per market, and joined through markets → events
  on the team key (with a `teamIsYes` flag per point).
- Typed jsonb readers `playerSeasonStats` / `teamSeasonStats` — return
  `null`, not `{}`, when a season is absent, so "no data" can't be read
  as zeros.

## S-010 — market-data layer (`server/src/lib/sports/market-metrics.ts`)

One typed `getMarketMetrics(marketId)` snapshot + `getMarketMetricsBatch`
(cap 50, unknown ids omitted), cached in a 15s `TtlCache` so the authless
route can't stampede the DB. Pure aggregation functions
(`aggregateFills`, `derivePriceMetrics`, `deriveOpenInterest`) are
unit-tested; best-effort inputs (BaseScan holders, RPC totalSupply,
StateView getLiquidity) fail to `null` — a metric we can't compute is
reported as null, never fabricated. With `MARKETS_PERIPHERY_BY_CHAIN`
empty (Base deployment pending), on-chain reads are skipped and the
snapshot degrades gracefully — verified in the scratch-DB smoke.

Route: `GET /api/markets/:marketId/metrics` — authless public read like
`/api/markets/pools`, global ipRateLimiter, `Cache-Control: public,
max-age=15, stale-while-revalidate=30`; 400 on a malformed id, 404 for a
market Mantua doesn't know. Mounted in `app.ts` next to the pools router.

## Tests + gates

- `history.test.ts` (fixture rows through the pure computations,
  including tie handling, favorite/underdog derivation, and every
  insufficient-data path) and `market-metrics.test.ts` (volume windows,
  24h price-change baseline selection, opening-line fallback, open-
  interest filtering, no-data honesty) — 27 tests, node:test style.
- Full server suite green (521 pass), typecheck + lint clean.
- Migration chain 0000→0013 applied to scratch Postgres via psql;
  0013 re-applied idempotently; smoke script seeded the scratch DB and
  exercised every read path end-to-end (real SQL, not mocks).

## Ingestion wiring — closed by task 041

- ✅ **`game_plays`** — written by `refreshPlayByPlay` (store.ts) from
  Sportradar's pinned pbp feed, live/just-finished games only, on a
  quota-bounded rotation. One 038 correction rode along: the pinned doc
  shows `sequence` is an epoch-ms-scale number, so migration **0015**
  widened the column int4 → bigint (the (event, provider, sequence)
  idempotency design is unchanged).
- ✅ **`team_records` (+ `stats` jsonb)** — written by the standings pass in
  `refreshReferenceData` from the 041-pinned
  `/seasons/{year}/{type}/standings/season.json` feed; `stats` carries
  `win_pct` plus every categorised split (home/road/division/…).
- ❌ **`players.season_stats`** — still unwritten, deliberately: the only
  pinned source (nfl-seasonal-statistics) costs one call per team per
  refresh, which a trial key's ~33 calls/day cannot carry on top of the
  existing rotation. The typed reader and the `get_player_stats` serving
  path are wired and activate the moment rows appear (production key or a
  cheaper feed). Honest `unavailable` until then.
- On-chain metric inputs (YES supply, pool liquidity, holders) activate
  on their own once the Base markets deployment lands and
  `MARKETS_BY_CHAIN` / `MARKETS_PERIPHERY_BY_CHAIN` are populated.
