# 041 — Ingestion ⇄ tools wiring (post-Phase-3 seam closure)

**Status:** ✅ done 2026-09-06
**Branch:** `041-ingestion-tools-wiring`

Three Phase-3 branches landed in parallel — the Sportradar ingestion layer
(037), the canonical stats tables + read layer (038), and the agent tool
suite (039) — each honest about the seams it left for the others. This task
closes those seams: the 038 tables get writers, the 039 tools get their
preferred sources, and the board/agent slate reads move fully onto the
canonical DB, completing the architecture rule **provider → Mantua
ingestion → canonical DB → UI + agents; nothing reaches a provider
per-request.**

## Seam table — producer → table → consumer → status

| Producer (ingestion)                                                | Table / column                | Consumer (read path)                                                                                        | Status |
| ------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| `refreshPlayByPlay` (store.ts) ← `SportradarProvider.getPlayByPlay` | `game_plays`                  | `get_play_by_play` (plays), `get_live_game_state` (period/clock/possession off the latest play)             | ✅ wired |
| standings pass in `refreshReferenceData` ← `getStandings`           | `team_records`                | `get_standings` + `get_team_stats` (official record), `history.getStandings` (already read it since 038)    | ✅ wired |
| standings pass (same feed)                                          | `team_records.stats` jsonb    | `get_team_stats.detailedStats`, `teamSeasonStats` reader                                                     | ✅ wired |
| — none (see "honestly unwritten")                                   | `players.season_stats`        | `get_player_stats` (serving path wired; activates when rows appear), `playerSeasonStats` reader              | ⚪ reader wired, writer deliberately absent |
| slate ingestion (unchanged, 037)                                    | `events` (+ opening line join) | board `GET /api/sports/slate` (incl. `?dates=`), `get_sports_slate` in agent-chat + research-chat — all via `readCanonicalPublicSlate` | ✅ flipped off ESPN |

## What was built

### 1. Provider capability surface (provider.ts)

Two new optional capabilities, same `ProviderFeed` trust envelope as the
037 set: `getPlayByPlay(league, providerEventId)` → `ProviderPlay[]` and
`getStandings(league)` → `ProviderTeamStanding[]`. ESPN implements
neither — its behavior is byte-identical.

### 2. Sportradar adapter (sportradar.ts)

- **Play-by-play** — the already-pinned `/games/{game_id}/pbp.json`
  (nfl-play-by-play) is now consumed. Shape re-verified 2026-09-06 and
  cited in the header: `periods[] → pbp[] (drives) → events[]`; only
  entries `type: "play"` with a numeric `sequence` become rows.
  Possession at the play's start fills `teamKey`; the end-of-play
  possession and wall clock ride the `detail` jsonb (`possessionAfter` —
  what `get_live_game_state` serves).
- **Standings** — newly pinned `/seasons/{year}/{type}/standings/
  season.json` (nfl-postgame-standings, fetched 2026-09-06, field names
  quoted in the header). Season/type resolve from the current-week
  schedule (provider-cached — usually a free second step, like injuries).
  `rank{division, conference}`, `streak{type,length,desc}`, and the
  categorised `records[]` splits map onto the typed columns; `win_pct` +
  every split land flat in the `stats` jsonb. Sportradar's away category
  is `road` (documented), composed into the `away_record` string.
- New TTLs: pbp (trial 5m / prod 15s), standings (trial 6h / prod 1h).
  No new parser guesses: unrecognised season types, playless entries, and
  malformed teams are skipped, never coerced.

### 3. Writers (store.ts) + pure planners (ingest.ts)

- `refreshPlayByPlay` — the pbp pass. Target selection is the pure,
  tested `selectPbpTargets`: **live games always; `final` games only
  within a 36 h just-finished grace window; scheduled/postponed never;
  capped at `maxGames` (default 2) per tick, live first.**
  `planGamePlayRows` (pure) collapses duplicate sequences and yields
  byte-stable rows, so the `onConflictDoNothing` append against the
  (event, provider, sequence) unique makes re-ingest a true no-op.
  A delayed pbp feed is still written (stale plays are still plays that
  happened — append-only, nothing to "heal"), and recorded in the feed
  freshness registry (`pbp`).
- Standings pass in `refreshReferenceData` — `planTeamRecordRows` (pure)
  maps the feed onto `(team, season, seasonType)`-keyed upserts,
  **plans nothing from a delayed feed** (a stale snapshot must not
  overwrite a fresher one — the injuries-planner asymmetry), and skips
  teams the canonical `teams` table doesn't know yet (healed by the next
  hierarchy pass). `upsertTeamRecords` overwrites in place; `updatedAt`
  is the staleness signal readers surface. Feed name: `standings`.
- `cron-sports-sync` runs the pbp pass after the reference pass, failure-
  isolated exactly like it (a pbp error never undoes slate work).

### 4. Migration 0015 (the escape hatch, used)

`0015_game_plays_sequence_bigint.sql`: 038 modelled `game_plays.sequence`
as int4; the pinned pbp reference documents it as an epoch-milliseconds-
scale number (13 digits — the doc's own example is `1698611137531`), which
overflows int4. Widened to bigint (drizzle `bigint(..., {mode: "number"})`
— values are far below 2^53). Idempotent per the house convention
(re-applying bigint→bigint is a clean no-op), journal idx 15 appended, and
the **full 0000→0015 chain was applied to a scratch Postgres 16 via psql,
with 0015 re-applied as a no-op** — plus a real-SQL smoke exercising every
new writer and reader end-to-end (pbp re-ingest no-op, standings
overwrite-in-place, canonical range reads, and the four tool preferred
paths over the real drizzle seam).

### 5. Tools read the new tables (agent-sports-tools.ts)

Seam additions (drizzle + in-memory test fake, method-for-method):
`listPlaysForEvent`, `listTeamRecordsForTeam`, `listTeamRecordsForLeague`,
`getPlayerSeasonStats`.

- `get_play_by_play` — serves stored plays newest-first (default 40, cap
  100) with running scores; `unavailable` only when the game genuinely
  has no stored plays. A team query prefers the live game, then the most
  recent started game.
- `get_live_game_state` — period/clock/possession derived from the latest
  play (`possessionAfter` beats the start-of-play team); anything the
  play log can't support stays `null` with the reason.
- `get_team_stats` — prefers the `team_records` snapshot (latest season,
  regular preferred): official record + ranks + streak + splits, and
  `detailedStats` from the `stats` jsonb; falls back to the 039
  derived-from-events record.
- `get_standings` — per league: official snapshot (source
  `team_records`, with `asOf`) preferred, derived (source `derived`) as
  fallback; the note explains whichever mix was served.
- `get_player_stats` — serves `season_stats` seasons (optional `season`
  filter) when present; honest `unavailable` otherwise (see below).

### 6. Board + agent slate reads go canonical (037's follow-through)

- `GET /api/sports/slate` (incl. `?dates=` browsing) reads
  `readCanonicalPublicSlate` — no provider call on any page load.
  `readCanonicalSlateRange` takes the validated date window, left-joins
  the home moneyline `openingProbability` (the pre-pool line;
  `withLiveOdds` still overlays the live pool price), and reports the
  league-level `dataAsOf` even for empty windows so "off-day" and "never
  ingested" stay distinguishable (only the latter serves the error
  envelope).
- `canonicalToPublicSlate` now computes `delayed` from ingest freshness
  (`CANONICAL_FRESH_MS` = 5 min) instead of hard-coding `true`, and
  `fetchedAt` is the ingest time (stable across DB reads — keeps the
  `withLiveOdds` cache effective). Without opts the original
  always-delayed outage semantics are preserved.
- `agent-chat.ts` and `research-chat.ts` no longer instantiate
  `EspnProvider`; `get_sports_slate` in both serves the same canonical
  read (+ live pool odds), with prompts/descriptions updated to relay
  `delayed`/`dataAsOf`. ESPN remains only inside ingestion surfaces
  (cron-sports-sync via `providerFor`, cron-resolution, strategies).

### 7. History layer (038) — already aligned

`history.getStandings` has read `team_records` (with `updatedAt`
staleness) since 038 shipped; nothing to change. The trends/splits
readers stay events-derived by design — favorite/underdog comes from
Mantua's own lines, which no standings feed carries.

## Quota impact of pbp ingestion (trial key)

The budget rule is structural, not aspirational: `selectPbpTargets` is
the only source of pbp fetch targets. Per sync tick: **at most 2 pbp
calls** (live games first, then finals inside the 36 h grace window), plus
**≤1 standings call per ~6 h** (TTL-served otherwise; its season pointer
reuses the schedule cache). Worst-case added spend on a trial key
(1,000 calls/rolling 30 days, ~33/day): 2 pbp + ~2 standings ≈ **4
calls/day (~12% of budget)** on top of 037's schedule/hierarchy/roster/
injuries rotation — and only on days with live or just-finished games;
idle days add just the standings refresh. Page loads and agent tool calls
add zero: they never reach a provider.

## Honestly unwritten: `players.season_stats`

The only pinned source is the seasonal-statistics feed
(`nfl-seasonal-statistics`), which costs **one call per team** per
refresh — a full league pass is 32 calls, i.e. an entire trial day's
budget, every refresh, for data that changes weekly at most. That does
not fit the trial quota next to the existing roster rotation, so no
writer ships; forcing one would have meant either blowing the budget or
a rotation so slow the data would masquerade as fresher than it is. The
column, the typed reader (`playerSeasonStats`), and the
`get_player_stats` serving path are all wired and activate the moment
rows appear (production key, or a future cheaper feed). Until then the
tool keeps returning the structured `unavailable` — honest > forced.

## Tests + gates

- `sportradar.test.ts` +9: pbp parser (drive walking, non-play/broken
  entries skipped, epoch-ms sequence kept verbatim, possession keys,
  scoring plays), standings parser (ranks, streak composition,
  home/road → record strings, stats map, tie-carrying records), adapter
  routes for both feeds (incl. season-pointer reuse).
- `ingest.test.ts` +7: `selectPbpTargets` (live yes, scheduled never,
  grace window, cap + live-first ordering), `planGamePlayRows`
  (idempotent re-plan, duplicate collapse), `planTeamRecordRows`
  (mapping, unknown-team skip, delayed → nothing).
- `agent-sports-tools.test.ts` +8 (and updated expectations): each new
  preferred-source path AND its fallback — pbp ok/unavailable/not_found,
  live-state derived vs playless, team stats official (season pick,
  aggregate-less snapshot) vs derived, standings official vs derived,
  player season stats served/filtered/absent-season.
- `public-slate.test.ts` +6: freshness → `delayed`, `dataAsOf`
  surfacing, ingest-time `fetchedAt`, opening-line bps, no-opts
  back-compat, abbreviation recovery. New `sports-slate.test.ts`:
  `parseDates` bounds + `datesToRangeMs` inclusive-end window.
- Scratch-DB verification (real SQL, not mocks): migration chain
  0000→0015 + 0015 idempotency, then the writer/reader smoke described
  in §4.
- Gates: `npm run typecheck`, `npm run lint`, stub-env
  `npm test -w @mantua/server` — **667 pass / 0 fail**.

## Files

- `server/src/lib/sports/provider.ts` — `ProviderPlay`,
  `ProviderTeamStanding`, two optional capabilities.
- `server/src/lib/sports/sportradar.ts` — pbp + standings parsers,
  adapter methods, TTLs, header citations.
- `server/src/lib/sports/ingest.ts` — `selectPbpTargets`,
  `planGamePlayRows`, `planTeamRecordRows`, feed names `pbp`/`standings`.
- `server/src/lib/sports/store.ts` — `refreshPlayByPlay`,
  `upsertTeamRecords`, standings pass in `refreshReferenceData`,
  `readCanonicalSlateRange`, `readCanonicalPublicSlate`.
- `server/src/lib/sports/public-slate.ts` — freshness-aware
  `canonicalToPublicSlate`, opening-line probability, `CANONICAL_FRESH_MS`.
- `server/src/lib/sports/agent-sports-tools.ts` — seam + five tool
  upgrades.
- `server/src/routes/sports-slate.ts` — canonical-first board read
  (`datesToRangeMs`); `server/src/routes/cron-sports-sync.ts` — pbp pass.
- `server/src/lib/agent-chat.ts`, `server/src/lib/research-chat.ts` —
  ESPN substitution + prompt/description updates only.
- `server/src/db/schema/sports-stats.ts` +
  `server/drizzle/migrations/0015_game_plays_sequence_bigint.sql` (+
  journal) — the sequence bigint fix.
- Task docs 037/038/039 — seam notes closed/pointed here.
