# Prompt History — Agent Extended (Phase 13, task 070)

**Date:** 2026-09-18
**Branch:** `claude/agent-extended-social-reputation-dzi0fj`
**Task:** 070 — Phase 13 AE-001 … AE-014, on the owner's master list of 2026-09-16.

## Original prompt (owner)

> 📣 PHASE 13: Agent Extended — Social Posting, Reputation + AI Customer
> Support 🟡
>
> Capability 3 — Real-Time Social Posting ("sports agent analyst" layer)
> AE-001 Connect an agent to a social account (platform per D-107)
> [X / Twitter account login — credentials redacted here; see
>
> > the note below]
> > AE-002 Automatic real-time market updates and analysis posts
> > AE-003 Explain-the-move posts: why prices are moving; changes in
> > probabilities, game conditions, market sentiment
> > AE-004 Use changing prediction-market prices as a signal for forecasting
> > public information
> > AE-005 Per-agent public voice, track record, and reputation (public
> > performance page)
> > AE-006 Posting policy + rate controls: user-approved templates/cadence;
> > compliance-safe wording; no unsubstantiated performance claims
>
> Agent Reputation Architecture
> AE-011 Define canonical agent performance ledger using realized P&L,
> unrealized P&L, ROI, win/loss, drawdown, exposure, and risk metrics
> AE-012 Build public agent performance page with transparent historical
> record
> AE-013 Ensure performance metrics distinguish simulated, user-confirmed,
> and autonomous trades
> AE-014 Prevent cherry-picking or deletion of historical losing trades
> from public performance records
>
> Capability 5 — AI Customer Support
> AE-007 Support agent across channels
> AE-008 Explain deposits, withdrawals, positions, and transactions with
> account-aware context
> AE-009 Basic troubleshooting flows
> AE-010 Escalation to human support for complex issues

## Refined prompt (as executed)

1. **The ledger is derived, not declared (AE-011, AE-014).** The
   canonical ledger is computed from three records nobody edits through
   the app: chain-verified fills (`market_fills`, unique on tx hash),
   market resolutions, and the audit log. A migration adds a database
   trigger that refuses UPDATE and DELETE on `market_fills`, so even a
   direct database write cannot quietly drop a losing trade. The public
   response carries a digest over every entry, so two readers can prove
   they saw the same history.
2. **Mode is a label on every entry (AE-013).** The agent's execution
   site already audits each trade; it now also records the agent mode in
   the audit params. A pure mapping turns (audit action, params) into
   `user_confirmed` (a confirmation id was presented), `autonomous`
   (autonomous mode without one, or a hedge-engine fill), or
   `unattributed` (no audit row — never assumed to be confirmed).
   Simulations come from the activity timeline and are reported in their
   own block, never inside P&L.
3. **Metrics are pure functions (AE-011).** Realised P&L reuses the
   existing per-market ledger; unrealised P&L reuses the marked
   positions; drawdown is peak-to-trough on the cumulative realised
   series ordered by resolution; ROI is realised over capital deployed;
   exposure is open cost plus mark; the risk block is largest stake
   share, largest loss, profit factor and average stake.
4. **The public page is a handle, not an address (AE-005, AE-012).** A
   user claims a lowercase handle for their agent; `/agents/:handle` is a
   public URL the app restores on load. The page shows the record, the
   mode breakdown, the digest and the agent's recent posts.
5. **One platform account, per-agent voice (AE-001, D-107).** X is the
   platform. The deployment holds one X app's consumer key/secret and one
   user token/secret in server env. A user's agent "connects" by claiming
   a handle and enabling posting; its posts go out through that account
   with the agent named in the text. Per-agent OAuth is the recorded next
   step. Nothing from the login shared in the prompt is used or stored:
   a password cannot drive the API, and a pasted password is a disclosed
   one and should be rotated.
6. **Posts are templates over data, linted, then gated (AE-002, AE-003,
   AE-004, AE-006).** A market-update template states price, move and
   liquidity; an explain-the-move module attributes a move to scoring,
   order flow or news-implied repricing from the price series and game
   facts; a price-signal module turns a move that the score does not
   explain into a forecast statement with a confidence. Every text passes
   a compliance lint (forbidden claims, required disclaimer, length,
   performance figures only from the ledger) and a cadence gate the user
   configured, and every attempt is recorded, sent or not.
7. **Support is read-only and channel-agnostic (AE-007 … AE-010).** One
   generator answers from a knowledge base and, for a signed-in user,
   from their own activity, transfers, positions and agent status. The
   web route streams it; a JSON route returns it whole for other
   channels. Troubleshooting is deterministic code keyed on platform
   status and the user's state. Escalation writes a ticket with a
   transcript summary and returns its id.

## Why the refined prompt is better

The original list names outcomes. The refined version fixes the one
property each outcome depends on: that nothing public can be typed, only
derived; that every entry says how it happened; that every post is
composed, checked and gated by code before a model or a person sees it;
and that support can read but never move money. Each of those is a test,
not a promise.
