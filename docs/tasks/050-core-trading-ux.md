# Task 050 — Core Trading UX, consumer layer (Phase 6, T-001 … T-023)

> Owner directive 2026-09-12 (Phase 6 📱, 🔴). The five product principles
> made real: feels like a modern sports app with the complexity underneath,
> and keeps Mantua's conversational architecture (the dock is the primary
> surface) instead of becoming a conventional sports dashboard. Prompt
> record: `docs/promptHistory/2026-09-12-core-trading-ux.md`.

## Task description

The market stack (Phases 4–5) is complete and deployment-gated. This task
builds the consumer layer on top of it without touching the mechanism, the
fee model, or the server's execution path. Every consumer rule is pinned to
a pure module with a test so the rule cannot drift: the tap budget, the fee
lines, the error copy, the probability provenance, the freshness stamp, the
quick actions, and the discovery filters.

## Success criteria

- [x] **Discovery.** A `Discover` surface lists tradeable markets across the
      covered leagues with sport / league / team / game / status / start
      time / liquidity / popularity filters and sorts (T-001, T-018).
      Natural-language phrases ("Show me today's NFL markets", "Find the
      most liquid NFL markets", "What can I trade right now?") parse to the
      same filter object (T-019). No market id or address is ever an input
      or shown (T-020).
- [x] **Tap budget.** A pure ticket state machine proves price → amount
      preset → Confirm is three taps for a buy (T-002) and Close → Confirm
      is two for an exit (T-011). Buy and sell are both first-class before
      and during the game (T-003).
- [x] **Chainless surface.** No gas / ETH / network / chain / explorer /
      address words in the consumer files (T-004, T-005); a test greps them.
- [x] **Execution confirmation.** An explicit **Trade executed** card with
      what was bought, at what price, and the two next actions (T-006).
- [x] **Live updates.** The wallet balance and market positions refresh on
      every trade and on a shared poll; the ticket's balance line reads the
      same source as the portfolio (T-007).
- [x] **Fee display.** Position / Fee / Fee % / Total from the hook quote in
      every season; 0% shown in the regular season; a quote above 0.70% is
      refused, never rendered; the spec numbers are asserted: a $100 buy at
      50/50 and the ceiling shows $0.35, 100 contracts at that price show
      $0.18 (T-008). A fee-structure explainer sits behind one tap (T-009).
- [x] **Market page, simple layer.** Headline price / implied probability
      with its source label, recent movement, game info, freshness; holders,
      activity and comments behind expandable sections (T-010).
- [x] **Error copy.** Every server code and client condition maps to owner-
      readable copy: insufficient balance, market closed, feed halted, cap
      exceeded, kill switch, not deployed, no market, quote failed, wallet
      declined, reverted (T-012).
- [x] **Onboarding.** When a logged-in user's balance cannot cover the
      ticket, the ticket offers **Add funds** inline (bank via the shipped
      Plaid rail, or a USDC transfer) and **Skip** for USDC-native users;
      the ticket resumes where it was (T-013).
- [x] **Conversation first.** The dock stays on every page (T-015);
      contextual quick actions for Analyze, Trade, Swap, Add Liquidity,
      Portfolio and Agent render above it and route through the same intent
      detector (T-016); every submission re-detects intent and can switch
      surfaces, including a team name landing on that game (T-017).
- [x] **Probability provenance.** Every probability carries its source
      (market price / projection / agent estimate) (T-021); agent output
      carries a standing "estimate, not a guarantee" line (T-022); every
      live-data surface shows when it was last updated (T-023).
- [x] **E2E loop.** A composed test drives Discover → Analyze → Trade →
      Monitor → Exit/Settle through the shipped pure modules against the
      server's real quote / fee / error contracts (T-014). The on-chain leg
      on a real market is deployment-gated (D-112) — see What remains.

## Failure conditions

- A buy needs more than three app taps from a price to a placed trade.
- The ticket renders a fee rate above 0.70% or a fee number the hook did not
  quote.
- A consumer surface names gas, ETH, a network, a chain, an explorer, or a
  0x address.
- A trade ends in a state the user cannot read as executed or failed.
- A probability renders without its source, or agent copy promises an
  outcome.
- A natural-language discovery phrase lands somewhere a tap could not.

## Edge cases

- Regular-season quote: Fee $0.00 / 0.00% still renders all four lines.
- Fee rounds up to the cent; a non-zero fee never shows $0.00.
- Balance exactly equal to the ticket total is sufficient.
- Logged-out user: the ticket shows **Log in to trade**, not Add funds.
- Server returns `MARKETS_NOT_DEPLOYED`: copy says markets are opening
  soon, never a stack trace.
- Wallet declines the signature: copy says nothing was placed.
- A team name that matches no game in the slate lands on the league page
  with no selection, not an error.
- Slate `delayed` + `dataAsOf`: the freshness stamp shows the ingest time
  and marks the data as delayed.

## Implementation checklist

- [x] Task doc, prompt history.
- [x] `trade-ticket-core.ts` + tests (tap budget, presets, readiness).
- [x] `market-trade-core.ts`: fee lines, ceiling guard, spec-number tests.
- [x] `trade-errors.ts` + tests.
- [x] `probability-source.ts`, `freshness.ts`, `quick-actions.ts` + tests.
- [x] `discovery.ts` (filters / sort) + `discovery-query.ts` (parse / title) + tests.
- [x] `chat-intent.ts`: `discover` intent, team hint on position intents.
- [x] Server `GET /api/markets/discover` + pure composer + tests.
- [x] `TradeTicket` (sides, amount, review, funding, executed, status).
- [x] `FeeExplainer`, `MarketSummary`, `MarketDetail` split, `DiscoverPage`,
      `QuickActions`, `Freshness`, `ProbabilityTag`, agent disclaimer.
- [x] `use-live-balance.ts` shared refresh.
- [x] `chainless-copy.test.ts`, `consumer-loop.e2e.test.ts`.
- [x] Docs: architecture, README, fee-model, roadmap ledger.

## Reconciled table

| ID    | Task                                    | Found before this task                                                       | Remainder → shipped here                                                                                               | Status |
| ----- | --------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------ |
| T-001 | Market discovery home                   | Home board (today, per league) + league pages; nav data-driven off `SPORTS`  | `DiscoverPage` across leagues with filters; a new sport is one `SPORTS` row + one server allowlist entry, no nav layer | ✅     |
| T-002 | ≤3-tap trade flow                       | Price pick → typed amount → Trade (no review, bump chips)                    | `trade-ticket-core.ts` tap machine; presets set the amount in one tap; Confirm is tap three; asserted in tests         | ✅     |
| T-003 | Instant buy and sell                    | Buy/Sell tabs, Max, one-click Close (B7-003, D-103 in-play)                  | Kept; "Lock in profit" label on winning positions                                                                      | ✅     |
| T-004 | Clean sports-app interface              | Sidebar spoke USDC / YES / slippage / on-chain                               | Ticket copy in dollars and contracts; deeper data behind expandable sections                                           | ✅     |
| T-005 | Gasless surface                         | C-005 smart wallets behind flag; sidebar linked an explorer, said "on-chain" | Explorer link and chain words removed from consumer files; `chainless-copy.test.ts` guards them                        | ✅     |
| T-006 | Unambiguous execution confirmation      | "Done. View transaction"                                                     | `TicketExecuted` card: Trade executed · what · price · View position / Trade again                                     | ✅     |
| T-007 | Real-time position and balance updates  | 15 s portfolio poll + `mantua:refresh-portfolio` on fills                    | `use-live-balance.ts` shared by the ticket and the portfolio; positions refresh on the same event                      | ✅     |
| T-008 | Transparent fee display                 | H-012 fee line (playoffs only)                                               | Four lines in every season; ceiling guard; $0.35 / $0.18 asserted                                                      | ✅     |
| T-009 | Fee-structure explainer                 | `docs/fee-model.md` only                                                     | `FeeExplainer` behind "How fees work" in the ticket and on the market page                                             | ✅     |
| T-010 | Market page, simple layer               | Chart + five tabs                                                            | `MarketSummary` headline (price, movement, game info, freshness); tabs behind "More"                                   | ✅     |
| T-011 | ≤3-tap exit                             | One-click Close deep-link                                                    | Close → Confirm asserted as two taps                                                                                   | ✅     |
| T-012 | Error copy for every state              | Raw `err.message` in the sidebar                                             | `trade-errors.ts` maps every code and client condition                                                                 | ✅     |
| T-013 | Onboarding: bank-connect + deposit      | Deposit dialog on the profile; Plaid tab on Assets; unreachable from a trade | `TicketFunding` step inside the ticket with Skip                                                                       | ✅     |
| T-014 | E2E full loop                           | Server E2Es (042) cover agent + hedging                                      | `consumer-loop.e2e.test.ts` over the pure modules + server contracts; on-chain leg gated by D-112                      | ✅     |
| T-015 | Preserve the command bar                | Dock on every page                                                           | Unchanged; quick actions feed the same handler                                                                         | ✅     |
| T-016 | Contextual quick actions                | Four home cards (agent/analyze/swap/pool)                                    | `quick-actions.ts` route → chips incl. Trade and Portfolio; rendered above the dock                                    | ✅     |
| T-017 | Natural-language intent switching       | Per-submission re-detection                                                  | `discover` intent, team hint → game preselect                                                                          | ✅     |
| T-018 | Discovery filters                       | league + dates only                                                          | `discovery.ts` filters/sorts; server join for liquidity + popularity                                                   | ✅     |
| T-019 | Natural-language discovery              | League nav only                                                              | The three owner phrases parse to filters; tested                                                                       | ✅     |
| T-020 | No market id / address required         | Internal ids only                                                            | Guarded by the chainless copy test                                                                                     | ✅     |
| T-021 | Market vs model probability             | "Market odds" chip when live; bare % otherwise                               | `probability-source.ts` labels every probability                                                                       | ✅     |
| T-022 | Never present a prediction as certainty | —                                                                            | `PredictionNote` on agent + analysis surfaces                                                                          | ✅     |
| T-023 | Timestamp / freshness                   | `fetchedAt`/`dataAsOf` on the wire, never rendered                           | `Freshness` stamp on board, league, discover, market page, analysis                                                    | ✅     |

## What remains

- **Live on-chain E2E (T-014's last leg).** `MARKETS_BY_CHAIN` and
  `DYNAMIC_MARKET_BY_CHAIN` are empty until the owner's D-112 launch-chain
  decision and the H-009 deploy. The loop test composes the shipped modules
  against the server's real contracts (quote shape, fee quote, error
  codes); the run on a real market follows the deploy with no code change.
- **House review steps.** The external o3 / Gemini reviews are not reachable
  from this environment; the review that ran is this checklist plus the
  suites (client, server, lint, typecheck).

## Integration with Phases 7–9 (merge, 2026-09-13)

This lane was built beside Phases 7–9 (PRs #53–#55) and merged after them.
Six client files conflicted; the resolution keeps the consumer layer's
structure and folds the later phases' behaviour into it:

- **Trade hook (`use-market-trade.ts`).** Phase 7's states win (quote route,
  `building`, `confirming` → `pending` / `done` / `failed`, the pending-trade
  register, `classifyTradeError`); the `error` phase additionally carries the
  thrown value so `describeTradeError` (T-012) keeps mapping codes to copy.
  The dropped-trade message is chainless.
- **Trade ticket.** `use-trade-ticket` renders the previous quote while
  re-quoting (R-003), treats `pending` as still executing and `failed` as
  the reverted copy (R-004), lists trades from earlier sessions with a
  neutral "View transaction" link (PF-018), and shows "Trading paused" on
  an operator pause (R-005) via a new `paused` readiness. The executed card
  notes when the position is still being recorded.
- **League page** keeps this lane's split (`GamesList`, `TradeTicket`,
  `detail/`). **Board** takes Phase 7's single live stream plus the
  Discover entry and the freshness stamp.
- **Positions** use Phase 9's grouped-by-game section with this lane's
  copy ("contracts", dollar values, "Lock in profit") and the 30 s poll
  (T-007) moved into `use-market-positions`.
- **Chainless sweep.** Phase 7's `TradeErrorKind` value `network` is now
  `offline` so `trade-status-core.ts` passes the T-004 sweep; the detection
  regex is unchanged in effect.
