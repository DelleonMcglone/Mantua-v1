# 039 — Agent sports-data tool suite (S-011..S-021)

**Status:** ✅ done 2026-09-06
**Branch:** `039-agent-sports-tools`

## Scope

Phase 3 of the sports pivot: give the chat agent a sports-data tool suite
that answers exclusively from the **canonical Mantua database** (the rows
the ingest workers maintain in `db/schema/markets.ts`) — never from a
provider per-request. `get_sports_slate` and `get_market_data` were the two
precedents; this wave adds thirteen read-only tools plus the S-021
composition test.

Two rules shape every tool:

1. **Honesty.** Empty-because-no-data (ingestion pending) and
   empty-because-no-match are different answers and both are structured:
   `status: "unavailable"` with a `"not yet ingested"` reason vs
   `status: "not_found"`. Fields the schema does not store are reported
   absent with the reason — never invented. Nothing is fabricated.
2. **Never guess silently.** Team/player lookups fuzzy-match canonical rows
   (name, key, abbreviation, whole-word and substring); an ambiguous query
   returns `status: "ambiguous"` with `didYouMean` candidates for the agent
   to relay. Exact row-id lookups short-circuit; exact *name* collisions
   still surface as ambiguous.

## Architecture

`server/src/lib/sports/agent-sports-tools.ts` — one typed query function
per tool over a narrow `SportsToolsDb` read seam. `makeSportsToolsDb(db)`
is the drizzle implementation (thin, dumb fetches); all windowing,
matching, aggregation, and the honesty envelope live in the tool functions
so they are unit-testable without a live database (stub-env test rule).
Input validation is zod (`.strict()` schemas) inside each function; throws
surface as tool errors through the existing executor. Every provider-
sourced string is scrubbed with `sanitizeProviderString` on the way out
(B8-008).

Registration: `server/src/lib/agent-chat.ts` — TOOLS entries + executor
cases only, plus a minimal system-prompt addition in the sports section
telling the model the tools exist, that its sports knowledge comes from
them (not web search), to relay `didYouMean` instead of guessing, and to
chain `get_game` → marketIds → market tools. All thirteen are read-only:
per 030's rule they are absent from `MUTATING_TOOL_ACTIONS`, so they write
**no audit rows** and have no caps.

## Tool table

| S-row | Function | Data source (canonical DB) | Registered name |
| --- | --- | --- | --- |
| S-011 | `getGame` | `events` (+ `teams`, `leagues`, `markets`) | `get_game` |
| S-012 | `getLiveGameState` | `events` (`in_progress` rows) | `get_live_game_state` |
| S-013 | `getTeamStats` | `teams` + record derived from finished `events` | `get_team_stats` |
| S-014 | `getPlayerStats` | `players` (identity only — see below) | `get_player_stats` |
| S-015 | `getPlayerInjuryStatus` | `injuries` (open rows, `resolved_at` null) + `players` | `get_player_injury_status` |
| S-016 | `getRecentGames` | finished `events` per team, limit N | `get_recent_games` |
| S-017 | `getHeadToHead` | finished `events` between two teams | `get_head_to_head` |
| S-018 | `getStandings` | `team_records` snapshot (041), fallback: aggregated from finished `events` | `get_standings` |
| S-019 | `getPlayByPlay` | `game_plays` (041 ingestion) | `get_play_by_play` |
| S-020 | `getMarketPrice` | `markets` + latest `market_prices` row | `get_market_price` |
| S-020 | `getMarketHistory` | `market_prices` series | `get_market_history` |
| S-020 | `getMarketVolume` | `market_fills` aggregates over a window | `get_market_volume` |
| S-020 | `getMarketLiquidity` | `markets.pool_id` + latest `market_prices.liquidity_raw` capture | `get_market_liquidity` |
| S-021 | composition test | (all of the above) | — |

## `unavailable` until the provider wave lands — mostly closed by task 041

Task 041 (`041-ingestion-tools-wiring.md`) wired the ingestion these
notes were waiting on. Current state:

- **`get_play_by_play`** — ✅ serves ingested `game_plays` rows (newest
  first, with running scores); `unavailable` only when the game genuinely
  has no stored plays (ingestion covers live + just-finished games).
- **`get_live_game_state`** — ✅ `period`/`clock`/`possession` derive from
  the latest ingested play (possession = the feed's end-of-play
  possession); fields the play log can't support stay `null` with the
  reason.
- **`get_team_stats`** — ✅ prefers the official `team_records` snapshot
  (record, ranks, streak, splits + `detailedStats` from the `stats`
  jsonb); the derived-from-events record remains the fallback.
- **`get_player_stats`** — identity served; the stat line reads
  `players.season_stats` when present, but ❌ no feed writes that column
  yet (trial-quota economics — see 041), so `unavailable` stays the
  common honest answer.
- **`get_standings`** — ✅ prefers the official `team_records` snapshot
  (source: `team_records`, with an `asOf` staleness stamp); derived from
  finished events (source: `derived`) as the fallback. `unavailable` only
  when neither exists.
- **`get_player_injury_status`** — when the whole `injuries` table is
  empty, an empty answer carries a note that the feed is not yet ingested
  and absence is **not** evidence of health (vs the found-player,
  feed-populated case, which plainly means "not listed").
- **`get_market_price` / `get_market_history`** — `unavailable` while the
  market has no `market_prices` captures (pool not seeded / sweep not run).
- **`get_market_liquidity`** — graceful pre-deployment answer:
  `poolDeployed: false, liquidityUsdc: null` while `markets.pool_id` is
  null; `null` with a note when deployed but no depth capture exists yet.
- **`get_market_volume`** — zero fills is reported with an explicit note
  that it may mean no trading OR fill indexing pending (the fills index
  only sees confirmed app trades).

Any tool hitting a completely empty `teams`/`players`/`events` table
returns `unavailable` (`"not yet ingested"`) instead of `not_found`.

## S-021 composition test

`server/src/lib/sports/agent-sports-tools.test.ts` — the suite provides an
in-memory `SportsToolsDb` whose filters mirror the drizzle implementation
method-for-method, seeded with fixture rows: one league, four teams, four
players, one open + one resolved injury, a **live Falcons game**, four
finished Falcons games (two vs the same opponent, for head-to-head), a
scheduled game, both moneyline markets for the live game (one with a
deployed pool, one without), a three-point price series with one depth
capture, and four fills (one outside the volume window).

The composition test simulates "Should I buy the Falcons YES contract?"
exactly the way the agent would chain the tools, with **"Falcons" as the
only user-supplied identifier**: `get_game("Falcons")` → the opponent name
and the marketIds come from that result → `get_live_game_state` →
`get_player_injury_status` for both sides (the opponent taken from step 1)
→ `get_recent_games` → `get_head_to_head` vs the tool-derived opponent →
`get_market_price` / `get_market_liquidity` / `get_market_history` /
`get_market_volume` keyed by the tool-derived marketId. It asserts every
category resolves `ok` with the seeded values (score 14-10, price 66% /
6600 bps, 2 500 USDC depth, 3 in-window trades, 2 head-to-head meetings,
one open injury on our side and an honest empty list on theirs).

The remaining unit tests cover: fuzzy resolution incl. `didYouMean` on
ambiguous team ("New York") and player ("Cam Smith") queries and
disambiguation by team; the not_found-vs-unavailable distinction on empty
tables; date-window selection and live-game preference in `get_game`; the
absent-field honesty of `get_live_game_state`; derived records and
standings aggregation/ordering; open-vs-resolved injury filtering and the
feed-empty note; head-to-head summaries (self-match rejected); play-by-play
`unavailable`; all four market tools including boundary validation
(malformed market ids, out-of-range limits, unknown-key rejection via
`.strict()`); and — per 030 — that `auditActionForToolCall` maps every one
of the thirteen tools to `null` (no audit row).

## Files

- `server/src/lib/sports/agent-sports-tools.ts` — new module (seam +
  thirteen tool functions).
- `server/src/lib/sports/agent-sports-tools.test.ts` — unit + S-021
  composition tests (37 tests).
- `server/src/lib/agent-chat.ts` — tool registry entries, executor cases,
  system-prompt sports-section addition only.
