# 037 — Sportradar licensed provider (S-001/S-002/S-003/S-004)

**Status:** 🟢 code-complete — awaiting the operator's Sportradar contract + key
**Branch:** `037-sportradar-provider`

Phase 3 sports-data rows: make Sportradar the licensed primary provider
behind the EXISTING `SportsDataProvider` abstraction (B3-001), and wire
ingestion into the canonical tables the schema has carried since 0009
(`teams`, `players`, `injuries` — previously written by nothing). The
architecture rule holds throughout: **provider → Mantua ingestion →
canonical DB → UI + agents; agents never hit the provider per-request.**

## Per-row status

| Row   | Scope                                           | Status                                                                                                                                                                                                                                                        |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-001 | Sportradar commercial contract + production key | 🟡 **operator-contract** — strictly operator-side (sign agreement, set `SPORTRADAR_API_KEY` + `SPORTRADAR_ENV=production`); nothing further to build                                                                                                          |
| S-002 | Provider decision record (D-102)                | ✅ **doc** — `docs/decisions/v2-open-decisions.md` §D-102 + summary row: Sportradar primary, SportsDataIO priced alternative, sourced comparison table, licensing reality (Genius Sports holds the official NFL feed)                                         |
| S-003 | Sportradar adapter + canonical-table ingestion  | ✅ **code-complete** — what flips it to done: a real trial/production key exercised against the live API (the mappings marked TODO-verify in `sportradar.ts` get confirmed against real payloads), then one observed cron tick writing teams/players/injuries |
| S-004 | Sportradar MCP evaluation                       | ✅ **eval** — below; recommendation: adopt for operator/dev workflows, never as the production agent data path                                                                                                                                                |

## What's built (S-003)

### The adapter — `server/src/lib/sports/sportradar.ts`

- Implements `SportsDataProvider` against **NFL API v7** (WNBA stays on the
  ESPN adapter until a WNBA package is licensed). Every endpoint is pinned
  to its official reference page (URLs in the module header, fetched
  2026-09-06):
  - slate → `/games/current_week/schedule.json`
  - event/final capture → `/games/{game_id}/boxscore.json`
  - teams → `/league/hierarchy.json`
  - rosters → `/teams/{team_id}/full_roster.json`
  - injuries → `/seasons/{year}/{type}/{week}/injuries.json` (week resolved
    from the current-week schedule payload)
  - play-by-play (`/games/{game_id}/pbp.json`) — pinned here for future
    markets; **consumed since task 041** (`game_plays` ingestion for live
    and just-finished games, on a quota-bounded rotation), alongside the
    041-pinned standings feed
    (`/seasons/{year}/{type}/standings/season.json` → `team_records`).
- **No guessed fields.** Parsers read `unknown` and validate (espn.ts
  posture); mappings that could not be verified from docs are marked
  TODO-verify (roster status codes without prose definitions; whether the
  injuries feed ever emits IR/day-to-day; injury-array ordering).
- **Settlement safety:** Sportradar's `complete` (game over, score
  unconfirmed) maps to `in_progress`, only `closed` (score confirmed) maps
  to `final` — spec §3.5's "absence of data never settles" applied to the
  confirmation gap.
- **Auth/env:** `x-api-key` header; `SPORTRADAR_API_KEY` (optional →
  adapter unavailable gracefully, ESPN fallback) + `SPORTRADAR_ENV`
  (`trial`|`production` — the URL path segment AND the politeness profile).
- **Polite client:** requests serialized with a min interval (1.1s trial —
  the documented trial cap is 1 QPS / 1,000 calls per rolling 30 days),
  429 opens a cooldown honoring `Retry-After`; composed under the existing
  `ResilientJson` (retry/backoff, TTL cache, stale-grace, breaker). Trial
  TTLs are long (schedule 30m, hierarchy/rosters 24h, injuries 6h);
  production TTLs match ESPN-era freshness.

### Provider selection — `server/src/lib/sports/active-provider.ts`

`providerFor(league)`: Sportradar when configured AND covering the league,
ESPN otherwise. ESPN is explicitly **prototyping-only** (undocumented,
no-SLA backend — B3 Risk 1). Selection is per league: NFL on Sportradar,
WNBA on ESPN, no code change either way.

### Ingestion wiring — the canonical-table gap closed

- `provider.ts` gains **optional capabilities**: `getTeams` / `getRoster` /
  `getInjuries` returning a `ProviderFeed<T>` envelope (same
  `delayed`/`fetchedAt` trust flags as slates). ESPN implements none —
  existing behavior byte-identical.
- `store.ts` gains the writers: `upsertTeams` (keyed `(league, key)`),
  `linkEventTeams` (backfills `events.home_team_id`/`away_team_id` from the
  provider-agnostic keys; never re-points a populated link),
  `upsertPlayers` (keyed `(provider, provider_player_id)`),
  `applyInjuryPlan` + `listOpenInjuries` (open/resolve per the schema's
  `resolvedAt` convention), and `refreshReferenceData` — the orchestrator
  the cron tick calls. **No migration needed**: the 0009 tables and the
  events FK columns already existed; the 0015 escape hatch went unused.
- `ingest.ts` gains the **pure planners** (unit-tested without a DB):
  `planInjuryTransitions` — report vs open rows → open/resolve/touch, a
  status change resolves the old row and opens a new one, a player
  dropping off the report resolves (returned), and a `delayed` feed plans
  NOTHING (a stale list must not "heal" players); plus the per-feed
  freshness registry (`recordFeedPoll`/`feedFreshnessSnapshot` —
  `lastPolledAt` vs `lastGoodAt`, extending the `last_polled_at` pattern in
  process state, not the schema).
- Rosters refresh on a **quota-aware rotation**: `stalestRosterTeams` picks
  the N teams with the oldest player rows per tick (default 4), so a trial
  key's ~33 calls/day covers 32 rosters on a rolling cycle.
- `cron-sports-sync.ts` uses `providerFor(league)`, runs the
  reference-data pass after the events upsert (its failure never undoes
  slate work), and reports `feeds` freshness + per-provider breakers.

### Caching / staleness / outage

- Per-feed TTLs via `ResilientJson` (above); stale-grace + breaker
  unchanged from B3-003.
- **Outage path:** `readCanonicalSlate` (store.ts) serves last-good
  canonical events with an explicit **`dataAsOf`** (max `last_polled_at`);
  `GET /api/sports/slate` falls back to it (via
  `canonicalToPublicSlate`, always `delayed: true` + `dataAsOf`) when the
  provider AND its stale cache are both gone — the board renders old data
  labeled as old instead of blanking. Resolution still refuses anything
  delayed (unchanged).
- ~~The interactive slate route stays on ESPN for `?dates=` browsing~~ —
  **closed by task 041** (`041-ingestion-tools-wiring.md`): the board's
  `?dates=` read now serves the canonical tables via
  `readCanonicalPublicSlate` (with `dataAsOf` + a freshness-computed
  `delayed`), and the direct `EspnProvider` instances in `agent-chat.ts` /
  `research-chat.ts` were replaced with the same canonical read. Providers
  are now reached ONLY from ingestion (cron-sports-sync, cron-resolution,
  strategies' live checks).

### Tests (44 new assertions across the sports suite)

- `sportradar.test.ts` — status/roster/injury mapping units; parser
  fixtures built from the documented shapes (schedule, boxscore,
  hierarchy, roster, injuries); polite-fetch pacing + 429 Retry-After
  cooldown (fake clock); adapter over a fake upstream (header injection,
  TTL caching, current-week → injuries resolution, league refusal).
- `ingest.test.ts` — `planInjuryTransitions` (open, touch, change →
  resolve+open, drop-off → resolve, delayed → no-op, duplicate-row
  collapse); freshness registry (`lastGoodAt` frozen by delayed polls).
- Full gates: `npm run typecheck`, `npm run lint`, stub-env server tests —
  523 pass / 0 fail.

## S-004 — Sportradar MCP server evaluation

**What it is** (verified 2026-09-06:
[docs](https://developer.sportradar.com/getting-started/docs/mcp-server),
[changelog](https://developer.sportradar.com/sportradar-updates/changelog/new-mcp-server-for-ai-assisted-development)):
an official **remote** MCP server at `https://developer.sportradar.com/mcp`,
launched 2026-02-11, authenticated with the same `x-api-key`. Sport-scoped
profiles exist — `sportradar-football` covers NFL. It exposes nine tools,
all **documentation/development-assistance**: `list-specs`, `search-specs`,
`list-endpoints`, `get-endpoint`, `get-request-body`, `get-response-schema`,
`get-server-variables`, `get-code-snippet`, `list-security-schemas`. It does
**not** proxy live data; Sportradar's own docs mark it development-use-only.

**Where it fits vs. the phase's canonical-DB rule:** the production agent
path is non-negotiable — agents read Mantua's canonical DB, never a
provider, and the MCP server could not serve that role even if wired: it
returns API _specs_, not scores, and per-request provider access from
agents is exactly what the architecture forbids. There is no conflict to
manage; the two tools answer different questions.

**Recommendation — adopt for operator/dev workflows, do not wire into the
product:**

1. **Use it** in engineering sessions (Claude Code/Cursor config with the
   trial key, `sportradar-football` profile) whenever extending
   `sportradar.ts` — it is the fastest way to resolve this module's
   TODO-verify field mappings and to spec future feeds (play-by-play for
   props, Odds API) against ground truth instead of doc-scraping.
2. **Do not** add it to the server, the agent toolchain
   (`agent-chat.ts`), or any runtime path. The production agent data path
   stays: Sportradar → ingest → canonical DB → agent reads DB.
3. No env-gated wiring shipped: even "trivial" wiring would put a
   provider credential into an agent-adjacent surface for a tool that
   returns documentation — cost without product value. A one-paragraph
   operator setup (editor MCP config JSON) lives in Sportradar's docs page
   and needs nothing from this repo.

## Operator runbook (S-001)

1. Register at the Sportradar Console/Marketplace; start the NFL API trial
   (self-service; 1 QPS, 1,000 calls per rolling 30 days).
2. Set `SPORTRADAR_API_KEY=<console master key>` (and leave
   `SPORTRADAR_ENV=trial`). The next boot serves NFL from Sportradar; no
   deploy-time flag beyond the env var.
3. Verify one `GET /api/cron/sports-sync` tick: response `feeds` shows
   `nfl:teams` / `nfl:rosters` / `nfl:injuries` polled; `teams`, `players`,
   `injuries` tables populate; `events.home_team_id`/`away_team_id`
   backfill.
4. Negotiate the production agreement (D-102 carries the comparison and
   the SportsDataIO lever); on signature set `SPORTRADAR_ENV=production`
   with the production key.

## Quota incident and cross-provider identity (R-012, 2026-09-30)

**What happened.** cron-job.org began firing `/api/cron/live-sync` every
five minutes for real on 2026-09-23. Each tick made one `current_week`
schedule call plus up to two play-by-play calls against the TRIAL key —
~300 calls a day against a cap of 1,000 per rolling 30 days. The window
was exhausted on 2026-09-26; from then on every tick got `HTTP 429` three
times, `refreshSlate` threw `ProviderUnavailableError`, the route answered
502, and the P-012 halt paused in-play buys for four days while the ESPN
adapter sat idle. Nothing fell through to ESPN because `providerFor` picks
Sportradar whenever the key is set — and falling through was never safe:
`events` rows are keyed by `(provider, provider_event_id)`, market ids
hash that id, and ESPN spells three NFL teams differently (WSH/JAX/LAR vs
WAS/JAC/LA), so an ESPN slate would have persisted every game twice.

**What changed.**

- `team-alias.ts` — one canonical abbreviation per team; `teamKey` maps
  ESPN's WSH/JAX/LAR onto Sportradar's WAS/JAC/LA (the persisted spelling).
- `event-match.ts` + `events.provider_ids` (migration 0027) — a second
  provider's event refreshes the row the first provider owns when league,
  both team keys and kickoff (±1h) agree; each describing provider leaves
  its own id in `provider_ids`, so later polls under that id (finals,
  `loadStoredEvents`) find the same row. The owner and the market id never
  change.
- `slate-fallback.ts` + `providerChainFor` / `liveProviderChainFor` — the
  daily sync and settlement try Sportradar then ESPN; the five-minute live
  tick reads **ESPN only on a trial key** (Sportradar's quota is reserved
  for the ~10 daily reference/schedule calls) and Sportradar→ESPN on a
  production key. The tick reports `provider` and `skippedProviders`.

**Runbook addendum.** A trial key cannot serve the live tick; do not raise
`liveProviderChainFor` to Sportradar without `SPORTRADAR_ENV=production`.
The exhausted window rolls off ~2026-10-23; until then every Sportradar
read 429s and the chains serve ESPN, which is expected and logged
(`sports: slate served by fallback`). cron-job.org may have auto-disabled
the job after a week of 502s — check the job's status after deploying.
