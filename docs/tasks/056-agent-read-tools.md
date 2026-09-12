# Task 056 — Agent read tools: search, market overview, positions, portfolio (Phase 8, A-011/A-019 … A-024)

> Owner directive 2026-09-12 (Phase 8 🤖 AI Agent Core, "continue starting
> with phase 8"). Ledger: `docs/tasks/ai-agent-core.md`. Decision record:
> D-114 (task 055) covers the write side; this lane is reads only.
>
> Gates: server typecheck ✅, lint ✅, **863 pass / 0 fail** (856 → 863);
> client untouched (the positions route only gains a field).

## Task description

Phase 8's tool architecture names four reads the agent must have before it
can reason about a bet the way the user's own screens do: find markets,
read one market in full, read the agent's position, read the agent's
portfolio. The repo had the raw pieces — the canonical slate, thirteen
single-purpose sports tools, an LP-only portfolio — but no composed reads,
and the agent could not see its own sports positions at all (the positions
computation lived inside the user route).

### What landed

| Tool                    | Row   | Source of truth                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mantua_search_markets` | A-020 | `readCanonicalPublicSlate` + `withLiveOdds` (the board's own readers), filtered and ranked by the pure `searchMarkets` (`lib/agent/read-tools.ts`): team/key/abbreviation fragment, league, live/upcoming/final; each row carries the two `outcomeIndex` values `mantua_simulate_trade` takes. Delayed slate copies are flagged with `dataAsOf`. |
| `mantua_get_market`     | A-021 | `getMarketOverview` (`lib/sports/agent-sports-tools.ts`): the game plus, per market, the public row, latest captured price with age, pool depth, 24 h fill volume — composed over the same `SportsToolsDb` seam as the single-purpose tools; missing captures are `null`, never invented.                                                        |
| `mantua_get_position`   | A-023 | `readMarketPositions` (`lib/sports/market-positions.ts`, lifted out of the user route so both share one computation and one 10 s shared-cache window) → `summarizeMarketPositions`: tokens, mark, value, entry, P&L, and the exact exit arguments for an open YES position.                                                                      |
| `mantua_get_portfolio`  | A-024 | `getAgentPortfolio` (balances, LP positions, transactions) + the marked sports positions with totals. Closes the A-011 visibility gap on the agent side.                                                                                                                                                                                         |

`MarketPositionRow` gains `outcomeIndex` (the UI ignores it; the agent
needs it to build an exit). The user route's response is otherwise
unchanged; `market-fills.ts` keeps its invalidation import through a
re-export.

### A-019 — the separation, stated

`docs/architecture.md` "Agent tool architecture — the five layers" records
the rule: **skill** (prompt guidance) → **tools** (typed reads; typed
writes behind the gate) → **wallet authorization** (server-custodied
Circle wallet, daily cap, policy row) → **contract enforcement**
(allowlist, hook, market state on-chain) → **user permission** (the
D-114 confirmation). No layer trusts the one above it.

### Options weighed

| Option                                         | Verdict | Why                                                                                                                                           |
| ---------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Rename the thirteen sports tools to `mantua_*` | ✗       | Churn in the prompt and the tests for no new capability; the composed tools carry the Phase 8 names and the detail tools stay for drill-down. |
| A separate positions query for the agent       | ✗       | Two computations drift (A-011 wants one attributable ledger). Lifting the route's computation gives the agent exactly what the user sees.     |
| Search over a new events index                 | ✗       | The canonical slate is already the board's read path with live odds and staleness labels; filtering it in code is cheap and consistent.       |
| Compose the overview inside the chat loop      | ✗       | Untestable without a database; over the `SportsToolsDb` seam it runs on the existing in-memory fixture.                                       |

### Success criteria

- [x] `mantua_search_markets` finds a game by team fragment, key, league and status, ranked live → upcoming → final, with outcome indices — A-020
- [x] `mantua_get_market` returns game + every market's price, depth and volume in one call, nulls where data is not yet ingested — A-021
- [x] `mantua_get_position` / `mantua_get_portfolio` show the agent's sports positions marked at the live price with P&L and totals, from the same computation as the user's portfolio — A-011, A-023, A-024
- [x] The five-layer separation is written down — A-019
- [x] Prompt routes game questions through the composed tools first; the detail tools remain

### Tests

- `server/src/lib/agent/read-tools.test.ts` — ranking, filters (fragment, key, league, status), not-found note, delayed flag, limit; position shaping, totals, exit hints, filters.
- `server/src/lib/sports/agent-sports-tools.test.ts` — `getMarketOverview` by providerEventId and marketId over the existing fixture (price age, depth, 24 h volume window, undeployed pool), not_found and input validation.
