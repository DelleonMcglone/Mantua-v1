# Prompt History — Prediction Market Combos (Phase 16, task 072)

**Date:** 2026-09-19
**Branch:** `claude/agent-extended-social-reputation-dzi0fj` (restarted from `main` at `fa2f63c`)
**Task:** 072 — Phase 16 CB-001 … CB-010, on the owner's master list refreshed 2026-09-19.

## Original prompt (owner)

> 🎰 PHASE 16: Prediction Market Combos 🟢
>
> Parlay-like experience with prediction-market mechanics. E.g. Cowboys
> win + Chiefs win + Raiders win as a single trade. Not a launch
> dependency — the core loop comes first.
>
> CB-001 Combo mechanism design: bundle multiple event outcomes into a
> single trade/transaction
> CB-002 Combo Builder UX: select first market → add legs → review each
> leg → see combined position/payout → see fees clearly → confirm
> CB-003 Combined payout + pricing engine for multi-leg positions
> CB-004 Combo fee display: per-leg and total fees, same transparency
> standard as single trades
> CB-005 Single-transaction combo submission
> CB-006 Agent-constructed combos: agent builds combos automatically from
> the user's strategy or risk profile
> CB-007 Combo settlement: all-legs resolution logic, partial-outcome
> handling
> CB-008 Portfolio integration: combos as first-class positions
> CB-009 Implement agent monitoring of open combo positions and automated
> management of individual legs where the combo mechanism permits
> CB-010 Define combo risk limits, maximum combined exposure,
> correlated-leg controls, and user-configurable restrictions

## Refined prompt

Build Phase 16 as task 072 on the existing prediction-market stack
(D-103 full-collateral YES/NO markets on Uniswap v4 with the Dynamic
Market Hook; D-104 resolution; D-114 agent execution protocol; D-109
agent policy), with these resolutions of the open questions:

1. **Mechanism.** A combo is a conjunction market: a new market created
   through the existing factory whose YES pays $1 iff every leg's YES
   resolves. Its id is derived from the sorted leg ids. This makes the
   single transaction (one swap), the fee standard (one hook quote), the
   position (one token balance marked at one pool price) and settlement
   (the resolver) fall out of what exists. No new contract (Foundry is
   unavailable here and the contracts need no change).
2. **Pricing.** Fair probability is the product of the legs' pool prices;
   the pool quotes the actual price; the engine reports both and the
   premium between them. Independence is assumed and disclosed;
   correlated legs (same game, same team) are refused rather than priced.
3. **Settlement.** Any leg lost → lost; every non-void leg won → won;
   every leg void → void; a void leg drops out. Leg results are stamped as
   they land so partial outcomes are visible before the combo settles.
4. **Agent.** Proposals from edge (consensus vs pool) sized by risk level
   under the user's `combo` policy block, previewed and confirmed through
   the existing gate; a fifteen-minute monitor manages open tickets
   (take-profit sale, leg hedge) for autonomous agent-wallet tickets and
   recommends for everyone else.
5. **Limits.** Env platform limits plus a per-user `combo` policy block,
   enforced in one pure gate.

Deliverables: the modules and routes in the task document, tests first,
files ≤ 150 lines, no new dependencies, docs in sync (architecture,
decision D-119, roadmap, task list, market-id spec, env example), a
draft PR.

## Why the refined prompt is better

The original asks for a "parlay-like experience with prediction-market
mechanics" without saying how the two reconcile. A real parlay's
all-or-nothing product payout cannot be assembled from independent
full-collateral positions (the holder would keep the winning legs), and
sequencing legs by resolution time fails for same-slot games, which is
exactly the owner's example. The refinement names the one construction
that gives a genuine product payoff with the deployed contracts — a
conjunction market — and derives every other row from it, so the ten
rows are one coherent design rather than ten features.
