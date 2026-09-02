# Sports Pivot — Carried-Forward Scope Reconciliation

**Task:** B0-006 in `docs/tasks/sports-pivot.md`.
**Premise:** the pivot builds on the existing repo and "everything in that repo
still ships". This document says, per area, what survives untouched, what is
superseded, and what is deferred — so no phase starts by guessing.

**Date:** 2026-08-16.

---

## Survives untouched

Load-bearing for the pivot. No planned work removes or rewrites these.

| Area                             | Where                                       | Why it survives                                                             |
| -------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Uniswap v4 pool / position stack | `server/src/lib/v4-*`, `features/liquidity` | DM-101 puts market pools on it; outcome tokens are just another ERC-20 pair |
| Stable Protection Hook           | Base Mainnet deploy pending (env-driven)    | B2-006 keeps it for base pools; unaffected by market work                   |
| Dynamic Fee Hook                 | Base Mainnet deploy pending (env-driven)    | Same                                                                        |
| Swap + bridge paths              | `features/swap`, `features/bridge`          | B7-003 extends them to outcome tokens rather than replacing them            |
| Base chain config + RPC fallback | `client/src/lib/chains.ts`                  | DM-104 (retargeted): Base Mainnet 8453 is the single chain                  |
| Decimals utility (18dp/6dp)      | `agent/src/lib/decimals.ts`                 | B1-006 requires outcome tokens to use it                                    |
| Spending caps + audit log        | `server/src/lib/spending-cap.ts`            | B8-010 maps Circle policies onto it; B10-001 re-verifies                    |
| Agent wallet boundary (D-008)    | `docs/architecture.md`                      | B8-007 restates it: the agent never signs with the user's Privy wallet      |
| x402 marketplace path            | agent stack                                 | Unchanged; the Agents feature card and docs both describe it                |
| Privy auth + server verification | `lib/privy`, `middleware/auth.ts`           | B6 reshapes the login method list, not the mechanism                        |
| Landing / legal / docs surfaces  | `components/landing`, `legal`, `docs`       | Confirmed 2026-08-16: the landing page stays                                |

---

## Superseded

Still present, but the pivot changes or replaces them. Each needs the listed
task to run before the repo is self-consistent.

| Item                                             | Superseded by             | Action                                                                                                                                                    |
| ------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home surface = portfolio + chat panel            | B5-001 board              | Board becomes the logged-in home; landing stays in front of it                                                                                            |
| Portfolio as a top-level surface                 | B6-008                    | Moves inside the user profile                                                                                                                             |
| Privy login incl. Apple + passkey (D-005)        | B6-001                    | Narrow to Google, email, wallet. **Also update the docs Getting-started page and the Privacy policy, both of which currently say passkeys are supported** |
| Analyze panel's `mantua-hooks` blurb             | current hook descriptions | Says "two hooks", cites Pyth/TWAP, lists old pairs. Stale — rewrite when B2 lands                                                                         |
| Base Mainnet framing in `v2-roadmap.md`          | DM-104                    | Base Mainnet (8453) is the target once again; the roadmap's chain framing is current, its task statuses historical                                        |
| `docs/legal/PRIVACY-POLICY-DRAFT.md` (pre-pivot) | merged 2026-08-16         | Now the source of truth for the published page; both updated for the pivot                                                                                |

---

## Deferred

Built or planned, explicitly out of scope for Sept 16.

| Item                                  | Status                                         |
| ------------------------------------- | ---------------------------------------------- |
| RWA Gate hook, Async Limit Order hook | Built, deferred to mainnet (pre-existing)      |
| Hook/market contract mainnet deploys  | Pending; addresses env-driven until deployed   |
| Live in-game props, spreads           | Sep W4 per the plan                            |
| Leagues beyond NFL and WNBA           | Sep W4; `coverage` field already supports them |
| Dispute window, resolver committee    | Oct W1                                         |
| Market-maker mode (B9-008)            | P3                                             |
| Circle Agent Marketplace listing      | Oct                                            |

---

## Open threads this surfaces

1. **`v2-roadmap.md` is now historical.** It describes a Base Mainnet rebuild
   and locks decisions (D-002 … D-014) that the pivot partly overrides — D-005
   on login methods most directly. It is not marked as superseded anywhere.
   Recommend a status banner on that file so nobody follows it as current.

2. **Two hook descriptions disagree.** The Analyze panel says two hooks with
   Pyth and TWAP mechanics; the landing page, docs, and FAQ say three with the
   current mechanics. The Analyze copy is stale.

3. **Dynamic Fee's described mechanics are unverified.** The Chainlink and
   Nezlobin description appears on the landing page and in the docs, but that
   hook's Solidity is not in this repo — only an E2E test — and nothing in the
   tree references either. Worth confirming against the deployed contract.

4. **Passkey references need to move with B6-001**, in two places outside the
   auth config: the docs Getting-started page and the Privacy policy.
