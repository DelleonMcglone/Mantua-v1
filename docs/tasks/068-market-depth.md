# Task 068 — Market Depth & Research Layer (Phase 11, D-001 … D-008)

> Numbering: built as "Phase 12" under the directive of 2026-09-13; the
> owner's master list of 2026-09-16 (`docs/tasks/mantua-v1-task-list.md`)
> numbers it **Phase 11** and makes Phase 12 the voice layer. Row IDs are
> unchanged.

> Owner directive 2026-09-13 ("skip phase 11 for now and complete phase
> 12 please"). Prompt record: `docs/promptHistory/2026-09-13-market-depth.md`.

## Task description

Progressively deeper information per market, all on the market page. The
page already had a summary, a price chart, and a "More" layer (positions,
comments, activity, holders, agent). This task adds the layer between: the
market's numbers and depth, the live game, the analyst's research, the
fee and execution mechanics, and past markets — each behind one tap, and
proven reachable without leaving the page.

## Success criteria

- [x] **D-001** The Depth section shows the current price with its 24 h
      move, volume (24 h and all time), trades and traders, open interest
      as contracts outstanding and open positions, and the pool's
      liquidity — from the metrics module, keyed by event, never by id.
- [x] **D-002** A live game panel shows score, period and clock,
      possession, and the latest play from the sports data layer, with a
      freshness stamp; fields the provider did not send are absent.
- [x] **D-003** A Research section renders `sports_intelligence`'s
      analysis for either side, tagged as an agent estimate with the
      prediction note; never rendered as a market price.
- [x] **D-004** Sections start closed; each opens in place; "Open all"
      opens every available one; the fee model and the fill mechanics live
      in the Fees & execution section.
- [x] **D-005** The chart carries annotations for kickoff, period starts,
      the freeze, the resolution, and injury reports, drawn from data the
      layer holds; nothing is estimated.
- [x] **D-006** A depth ladder shows, on both sides, the USDC and contracts
      that move the price by 1, 2, 5, 10, and 20¢ through the pool's
      liquidity — the honest artefact for an automated market maker, which
      has no order book, and the page says so.
- [x] **D-007** A historical browser lists resolved markets with the final
      score, the outcome, the settlement price, and a price-path sparkline,
      filterable by league, reachable from the market page and Discover.
- [x] **D-008** `client/e2e/market.spec.ts` walks one market page and
      asserts every data point above while the page heading stays visible;
      `market-depth.e2e.test.ts` composes the wire reads through every
      pure module.

## Failure conditions

- A depth ladder that pretends to be an order book.
- A model probability rendered without the agent-estimate tag.
- A live field invented when the provider did not send it.
- A section open by default for a first-time user.
- A market id or address on any new surface (T-020), or chain vocabulary
  in the new copy (the chainless sweep covers every new file).

## Edge cases

- A game with no market: the Depth section is offered but says depth
  appears once the market opens; research still works from the catalog.
- A price at the clamp (1¢ / 99¢): the ladder has one side, deduplicated.
- No plays ingested for a live game: score only, with the reason.
- Voided markets: settlement 50¢ both sides, labelled as such.
- Injury reports up to seven days before kickoff belong to the game; at
  most six are drawn.

## Implementation checklist

- [x] Server: `lib/sports/market-depth.ts` (curve), `market-depth-read.ts`
      (assembly over a `DepthDb` seam), `market-depth-annotations.ts`,
      `market-depth-db.ts`, `market-history.ts` + `market-history-db.ts`;
      routes `market-depth.ts`, `market-analysis.ts`, `market-history.ts`
      registered in `app.ts`; tests for every pure module and route.
- [x] Client: `detail/depth-types.ts`; pure cores with tests —
      `disclosure-core`, `depth-core`, `live-game-core`,
      `chart-annotations`, `research-core`, `history/history-core`;
      hooks `use-market-depth`, `use-market-analysis`,
      `history/use-market-history`; components `LiveGamePanel`,
      `ChartAnnotations` + `ChartLegend`, `DepthPanel`, `FeesAndExecution`,
      `ResearchSection`, `PastMarkets`, `MarketDepthSections`, `MarketTabs`,
      `history/{HistoryPage,HistoryRowCard,Sparkline}`; `PriceChart`
      annotations; `MarketDetail` composition; `history` route in App with
      entries from the market page and Discover.
- [x] Length rule: `LeaguePage` split (`LeagueHeader.tsx`,
      `default-selection.ts` + test); `MarketDetail` split (`MarketTabs`).
- [x] E2E: `depth-fixtures.ts` shared by the harness and the composed
      test; `market.spec.ts` (3 specs); harness `liveGame` option.
- [x] Docs: this file, prompt history, roadmap block, architecture
      section, README (renumbered to Phase 11 on 2026-09-16).

## Outcome (2026-09-13)

- Browser suite 13 specs green; client unit tests 269; server 973; lint
  and typecheck clean; changed files Prettier-formatted.
- `client/src/App.tsx` and `server/src/app.ts` were already over the
  150-line rule before this task and gained only route registrations; a
  routing split is its own task.
- Not in scope, recorded: halftime is drawn as the first play of period 3
  when ingested; the data layer carries no separate halftime event.
