# Prompt History — Core Trading UX, consumer layer (Task 050)

**Date:** 2026-09-12
**Branch:** `claude/admiring-tesla-4yvv4o`
**Task:** 050 — Phase 6 T-001 … T-023.

## Original prompt (owner)

> 📱 PHASE 6: Core Trading UX — Consumer Layer 🔴
> The five product principles made real. Feels like a modern sports app;
> complexity underneath. Preserves the original Mantua conversational
> architecture rather than becoming a conventional sports dashboard.
> Tasks T-001 … T-023 (table): market discovery home; ≤3-tap trade flow;
> instant buy and sell; clean sports-app interface with no DeFi
> terminology; gasless surface; unambiguous execution confirmation;
> real-time position and balance updates; transparent fee display
> identical to the hook quote (H-012); fee-structure explainer; simple
> market page with deeper data behind expandable sections; ≤3-tap exit;
> error copy for every state; onboarding with bank-connect + deposit woven
> into the first trade; E2E loop; preserve the command bar as the primary
> surface; contextual quick actions; natural-language intent switching;
> discovery filters; natural-language discovery; never require a market
> id or contract address; distinguish market-implied from model
> probability; never present an agent prediction as certainty; show data
> freshness whenever an analysis depends on live data.

## Refined prompt (as executed)

Build the consumer layer on the shipped market stack without changing the
market mechanism, the fee model, or the server's execution path:

1. **Discovery.** One `Discover` surface across the covered leagues,
   driven by a pure filter/sort module (sport, league, team, game, status,
   start time, liquidity, popularity) and a server read
   (`GET /api/markets/discover`) that joins the public slate to per-market
   liquidity and volume. Natural-language discovery phrases parse to the
   same filter object through `chat-intent.ts`, so typing and tapping land
   on the same page in the same state. No market id or address is ever an
   input.
2. **Trade ticket.** Replace the sidebar with a ticket whose tap budget is
   modelled as a pure state machine (`trade-ticket-core.ts`) and asserted
   in a test: price tap → amount preset → Confirm is three taps for a buy;
   Close → Confirm is two for an exit. The review block (Position, fee,
   fee %, Total) renders the hook quote verbatim in every season and never
   a rate above 0.70%. Execution ends in an explicit **Trade executed**
   card. Every failure state maps to owner-readable copy through
   `trade-errors.ts`.
3. **Chainless surface.** No gas, ETH, network, chain, explorer, or
   address words in the consumer files; a test greps them out. The wallet's
   own prompts are described as "Approve in your wallet" only where a
   signature is unavoidable.
4. **Onboarding.** When a logged-in user's balance cannot cover the ticket,
   the ticket offers **Add funds** inline (bank via the shipped Plaid rail,
   or a USDC transfer) and a **Skip** for USDC-native users; the ticket
   resumes where it was.
5. **Market page, simple layer.** Headline price / implied probability,
   recent movement from the recorded price series, game info, freshness
   stamp; holders, activity, and comments move behind expandable
   sections.
6. **Probability provenance.** Every probability carries its source label
   (market price, provider projection, agent model); agent output carries
   a standing "estimate, not a guarantee" line; every live-data surface
   shows when it was last updated.
7. **Conversation first.** The dock stays the primary surface on every
   page; contextual quick actions (Analyze, Trade, Swap, Add Liquidity,
   Portfolio, Agent) are a pure route → chips function rendered above it;
   each submission re-detects intent and can switch surfaces.
8. **E2E.** A composed test drives Discover → Analyze → Trade → Monitor →
   Exit/Settle through the shipped pure modules with the server's real
   quote/fee/error contracts; the on-chain leg on a real market is
   deployment-gated (D-112) and documented as such.

## Why the refinement is better

The owner's table lists outcomes; the refinement pins each to a testable
artifact so "three taps" and "never above 0.70%" are assertions, not
intentions. Discovery is split into a pure filter module and a thin read
so the natural-language path and the tap path cannot diverge. The chainless
requirement becomes a regression test rather than a copy review. The
onboarding row is scoped to what the shipped fiat rail can do today (Plaid
link + deposit) rather than inventing a new rail. The E2E row is stated
honestly: the loop is proven over the shipped modules, and the live
on-chain run waits on the same deployment gate every other phase carries.

## Clarifications made without the owner

- **"Taps" count app interactions only.** The wallet's signature prompt is
  outside the app and counted as zero; a token approval is bounded to the
  trade and only appears when an allowance is missing.
- **"Contracts"** is the consumer word for outcome tokens (matching
  `docs/fee-model.md`); "YES/NO" stays as the side label.
- **Popularity** is 24 h traded volume plus fill count from the recorded
  fills; **liquidity** is the pool's USDC depth from the latest pool
  snapshot. Both are zero, not absent, for a market with no on-chain leg.
- The external o3 / Gemini review steps in the house process are not
  reachable from this environment; the review that ran is the checklist
  in the task doc and the test suites.
