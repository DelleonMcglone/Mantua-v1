# Prompt History — Market Depth & Research Layer (Phase 11, task 068)

> Recorded under the directive's numbering ("Phase 12"); the owner's master
> list of 2026-09-16 numbers this work Phase 11. The record below is kept
> as written.

**Date:** 2026-09-13
**Branch:** `claude/admiring-tesla-4yvv4o` (the session's designated branch; stacked after the Phase 10 commits in PR #56)
**Task:** 068 — Phase 12 D-001 … D-008. Phase 11 skipped for now on the owner's instruction.

## Original prompt (owner)

> skip phase 11 for now and complete phase 12 please
>
> 🔍 PHASE 12: Market Depth & Research Layer 🟡
> Progressively deeper information per market — users never leave the
> market page to understand what they're trading.
>
> D-001 Market page deep data: current price/implied probability, historical
> pricing, trading volume, liquidity/market depth, recent price movement,
> open interest (where applicable), market activity
> D-002 Relevant game information panel: live score, clock, situation from
> the sports data layer
> D-003 AI-generated analysis and research section per market (powered by
> sports_intelligence)
> D-004 Layered disclosure UX: simple surface, expandable sections /
> secondary views for depth — casual users unhindered, pros and agents fully
> served (fees and execution mechanics included in the deeper views)
> D-005 Price history charting with market-event annotations (game start,
> halftime, injuries)
> D-006 Order-book/depth visualization for the pro layer
> D-007 Historical market browser: resolved markets with final outcomes and
> price paths
> D-008 E2E: every listed data point reachable from a market page without
> leaving it

## Refined prompt (as executed)

1. **Survey first.** Map every row onto what the market page, the detail
   route, the fills and pool-tick tables, the slate's live fields, the
   analyst (`sports_intelligence`) and the resolution records already
   provide, so each row extends a module rather than duplicating one.
2. **One read for depth (D-001, D-006, D-007 data).** A server read keyed
   by league + event id (never a market id or address, T-020) that returns
   the market's current price and implied probability, the price path,
   volume windows, liquidity and a depth curve derived from the pool's
   concentrated liquidity (an AMM has no order book — the honest artefact
   is the cost to move the price), open interest as contracts outstanding,
   and the recent fills. Pure modules compute every number; the route only
   joins.
3. **The game panel (D-002)** renders the live fields the sports data layer
   already carries (score, period, clock, status) with the freshness stamp
   (T-023); fields the provider does not send are absent, not invented.
4. **Research (D-003)** is the analyst's own output for that market, cached
   per market and labelled as an agent estimate with the prediction note
   (T-021/T-022); it never renders as a market price.
5. **Layered disclosure (D-004)** is a pure section model: the summary
   surface a first-time user sees, then expandable sections (Depth, Fees
   and execution, Research, History) whose open/closed state is explicit
   and tested; the fee model and execution path text lives in the deeper
   view.
6. **Charts (D-005, D-006)** are inline SVG built from tested pure
   scalers — no new charting dependency — with annotations for the events
   the data carries (game start, period changes, halftime, final). Injury
   annotations render only when the data layer supplies injuries; today it
   does not, and the doc says so.
7. **Historical browser (D-007)** lists resolved markets with the final
   outcome, the settlement price, and a price-path sparkline, reachable
   from the market page and the Discover filters.
8. **E2E (D-008)**: a browser spec that walks one market page and asserts
   every listed data point is visible without navigation, plus a composed
   node test over the wire shapes.
9. Docs: task 068, this file, roadmap Phase 12 block (Phase 11 noted as
   skipped), architecture section, README; lint, typecheck, unit and
   browser suites green; commit and push to the designated branch.

## Why the refined prompt is better

- It names the one artefact an AMM can honestly show for "order book":
  the depth curve. A fake book would mislead the pro layer it is meant to
  serve.
- It fixes provenance up front: market prices, projections, and agent
  estimates stay labelled (T-021), so the research section cannot be
  mistaken for the market.
- It keeps the consumer-layer rules (no market ids, chainless copy,
  freshness stamps) as constraints on every new surface instead of
  re-deciding them.
- It makes "reachable without leaving the page" a browser assertion, not a
  claim.

## Clarifications assumed

- Injury annotations: rendered only when a provider supplies injury
  events; the current data layer does not, so the chart annotates game
  start, period changes, halftime, and final.
- Open interest: contracts outstanding on the market (collateral locked),
  shown where the market exists on-chain; hidden, not zero, otherwise.
- Research uses the existing analyst path and its quota; no new model
  calls beyond what the analyst already makes per market.
- Phase 11 is skipped, not dropped: the roadmap records it as deferred by
  the owner on 2026-09-13 without a scope, to be supplied later.
