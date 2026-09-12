# Prompt History — Dynamic Market Hook fee model (Task 049)

**Date:** 2026-09-11
**Branch:** `claude/wizardly-ride-429024`
**Task:** 049 — Phase 5 H-001 … H-017.

## Original prompt (owner)

> 🪝 PHASE 5: Dynamic Market Hook & Fee Model 🔴
> Adjust the hook codebase to meet Mantua's standards and formula; deploy to
> mainnet. Regular season: 0% trading fees. Playoffs: fees are introduced,
> dynamic 0.10%–0.70%, ceiling 0.70%, varying by liquidity, volatility,
> trading activity, market uncertainty; highest at p ≈ 0.50.
> Formula: Fee = C × fee rate × p × (1 − p). Tasks H-001 … H-017 (table).

## Refined prompt (as executed)

Implement the fee model in `contracts/src/hooks/dynamic-market/` so that:

1. The hook returns to Uniswap v4 the pip fee `r × (1 − p)` on the swap's
   gross input, which realises `Fee = C × r × p × (1 − p)` exactly with `C`
   defined as the contract-equivalent of the gross input at the pre-trade
   pool price (derivation in `docs/tasks/049-dynamic-market-fee-model.md`).
2. `r` is 0 for a pool registered as regular season, else a rate in
   `[0.10%, 0.70%]` from four bounded drivers; both bounds are `constant`.
3. The season flag is per pool, set once at registration from the league
   calendar the provider feed reports (Sportradar `PST`, ESPN type 3).
4. The hook exposes `quoteFee` on the same code path as `beforeSwap`, so
   the server's pre-trade quote and the executed fee come from one source.
5. Tests: unit, property, fuzz, 100k invariant sweep, scenario matrix,
   rounding/overflow, manipulation resistance; shared vectors between
   Solidity and TypeScript.
6. Server/UI: season type through planning to `registerPool`; fee quote on
   the trade build; fee telemetry decoded from the swap receipt on each
   verified fill; Position / Estimated fee / Total in the trade sidebar.
7. Docs and the AI-assisted security review; deployment prepared but left
   to the owner (keys, funds, D-112 window).

## Why the refinement is better

The original formula is stated per contract while v4 charges a fraction of
the input token, so the ambiguous step — what pip value the hook must
return — is pinned down with a derivation and a definition of `C` that makes
the equality exact in all four swap shapes. "Season" is made a concrete,
manipulation-resistant per-pool fact instead of a mutable global switch.
"No discrepancy between quote and execution" is achieved structurally (one
view function on the hook) rather than by re-implementing state on the
server. Mainnet deployment is explicitly gated on owner inputs the session
cannot produce, so nothing is faked.

## Clarifications made without the owner

- **`C` for USDC-denominated inputs** is `input / p` at the pre-trade
  price (gross of fee). The alternative — counting contracts received net
  of fee — would change the pip formula by a factor `1 / (1 + r(1−p))`,
  below 0.7% of the fee; the gross definition keeps the formula exact.
- **"Trading activity"** is the existing flow imbalance plus the Nezlobin
  directional surcharge; **"market uncertainty"** is model/market deviation
  weighted by keeper confidence plus event-state risk. Each driver owns 25%
  of the 0.60% headroom.
- **Stale keeper** in the playoffs fails closed to the 0.70% rate (the §22
  posture); in the regular season the season rule wins and the fee stays 0.
- The UI example in the brief ("Position $100 / fee $0.18 / total $100.18")
  is treated as illustrative; the UI shows the exact quote from the hook.
