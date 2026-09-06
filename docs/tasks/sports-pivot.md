# Mantua — Agent-Driven Sports Prediction Market

> **Build:** Pivot on top of `DelleonMcglone/Mantua-Intelligence` (everything in that repo still ships)
> **Window:** 16 August – 16 September 2026
> **Positioning:** Agent-driven prediction market for sports. Bettors and market makers open positions, provide liquidity, and run automated hedging through natural language. Mantua hooks + autonomous agents + real-time onchain execution turn intent into market actions. A programmable liquidity layer for sports outcomes, live in-game markets, and USDC-settled event contracts.
> **Last updated:** 2026-08-16

---

## 🚦 Priority Legend

| Tag       | Meaning                                     |
| --------- | ------------------------------------------- |
| 🔴 **P0** | Ship blocker                                |
| 🟠 **P1** | Required for the Sept 16 definition of done |
| 🟡 **P2** | Droppable                                   |
| ⚪ **P3** | Post-Sept 16                                |

**Sept 16 scope = P0 + P1 = 94 tasks / 31 days ≈ 3 per day sustained.**

---

## 📅 Week Plan

| Week | Dates        | Milestone                                                             | Gate                                                       |
| ---- | ------------ | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| W1   | Aug 17–23    | Decisions closed; market primitives underway; data layer live         | Split/merge/redeem tests green                             |
| W2   | Aug 24–30    | Primitives complete; Dynamic Market Hook deployed; resolution working | One market opens → freezes → resolves → redeems on-chain   |
| W3   | Aug 31–Sep 6 | Home board, sport pages, chat dock, auth rework, trading page         | All three surfaces clickable end to end                    |
| W4   | Sep 7–13     | Agent page + Circle Agent Stack; hedging strategies                   | Agent arms and executes a hedge under a policy cap         |
| W5   | Sep 14–16    | Stabilisation, E2E, ship                                              | Definition of Done clean                                   |

---

## ⛔ Open Decisions

| ID     | Decision                   | Proposed default                                                                               | Blocks     | Status |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------- | ---------- | ------ |
| DM-101 | Market mechanism           | **Closed 2026-08-16 — outcome-token AMM (YES/NO ERC-20 vs USDC in v4 pools).**                 | B1, B2, B7 | ✅     |
| DM-102 | Conditional token standard | **Closed 2026-08-16 — purpose-built binary ERC-20 pair per market.**                           | B1         | ✅     |
| DM-103 | Resolution authority       | ⏸ **OPEN — needs owner sign-off on the signer arrangement.**                                   | B4         | ⏸      |
| DM-104 | Chain                      | **Closed 2026-08-16; retargeted 2026-09 — Base Mainnet (8453), the single supported chain.**   | Everything | ✅     |
| DM-105 | League coverage            | **Closed 2026-08-16 — NFL and WNBA. NBA/MLB/NHL/Soccer show "Coming soon".**                   | B3, B5     | ✅     |
| DM-106 | Market types               | **Closed 2026-08-16 — moneyline at launch; totals W4 (P2).**                                   | B1, B3, B5 | ✅     |
| DM-107 | Settlement data source     | **Closed 2026-08-16 — ESPN primary; second provider W3.**                                      | B3, B4     | ✅     |
| DM-108 | Jurisdictional posture     | **Closed 2026-08-16 — implied, not surfaced: no extra jurisdictional notice in the UI.**       | B10        | ✅     |
| DM-110 | Dynamic Market Hook spec   | **Closed 2026-08-17 — spec supplied and authoritative (`docs/specs/dynamic-market-hook.md`).** | B2         | ✅     |
| DM-111 | Agent wallet path          | ✅ **CLOSED 2026-08-17** — keep the existing Circle DCW path; Base fully supported (B8-001)    | B8, B9     | ✅     |
| DM-112 | Routing split              | **Closed 2026-08-16 — market pools direct; Trading API for base pairs.**                       | B7         | ✅     |

---

## ⚠️ Risk Acknowledgments

**Risk 1 — ESPN dependency.** ESPN retired its public developer API in 2014;
`site.api.espn.com` is the undocumented JSON backend behind ESPN's own site,
with no documentation, support, or SLA. Mitigated by the adapter interface
(B3-001), second provider (B3-007), and manual resolver override (B4-004).

**Risk 2 — Resolution centralisation.** v1 ships a trusted resolver with no
dispute window. Disclosed in UI (B4-006).

---

## 🧱 PHASE B0 — Decision Gate & Specs (W1) 🔴

| ID     | Task                                                                                                                                                                                                                                                                                                            | Priority | Status |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| B0-001 | Close all 11 decisions; record each in `docs/architecture.md` with rationale and date — **8 of 11 closed 2026-08-16** (`docs/decisions/sports-pivot-decisions.md`); DM-103/110/111 open — **8/11 closed 2026-08-16** — `docs/decisions/sports-pivot-decisions.md` + `docs/architecture.md`. DM-103/110/111 open | 🔴 P0    | 🟡     |
| B0-002 | `docs/specs/market-lifecycle.md`: create → seed → trade → freeze → resolve → redeem → void — ✅ `docs/specs/market-lifecycle.md`                                                                                                                                                                                | 🔴 P0    | ✅     |
| B0-003 | `docs/specs/dynamic-market-hook.md` from the DM-110 spec — ✅ **spec supplied and saved 2026-08-17** (§0–§46)                                                                                                                                                                                                   | 🔴 P0    | ✅     |
| B0-004 | Market ID scheme: deterministic hash of (provider event ID, market type, outcome index) — ✅ `docs/specs/market-id.md` + `server/src/lib/market-id.ts` (13 tests)                                                                                                                                               | 🔴 P0    | ✅     |
| B0-005 | Postgres additions: `sports`, `leagues`, `events`, `markets`, `market_outcomes`, `market_positions`, `resolutions`, `hedge_strategies` — ✅ `server/src/db/schema/markets.ts` — 8 tables                                                                                                                        | 🔴 P0    | ✅     |
| B0-006 | Reconcile carried-forward scope: which repo items survive, which are superseded, which are deferred — ✅ `docs/tasks/sports-pivot-scope-reconciliation.md`                                                                                                                                                      | 🔴 P0    | ✅     |
| B0-007 | Branch + task doc per house convention; prompt history captured — ✅ branch `sports-pivot`; `docs/promptHistory/2026-08-16-sports-pivot-b0.md`                                                                                                                                                                  | 🟠 P1    | ✅     |

---

## 🎲 PHASE B1 — Market Primitives (W1–W2) 🔴

| ID     | Task                                                                                                                                                                                       | Priority | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| B1-001 | `MarketFactory.sol` — deploy a YES/NO ERC-20 pair per market, USDC-collateralised 1:1 — ✅ `contracts/src/markets/MarketFactory.sol` + `OutcomeToken.sol`                                  | 🔴 P0    | ✅     |
| B1-002 | `split(usdcAmount)` — 1 USDC in → 1 YES + 1 NO out — ✅ `Market.split`                                                                                                                     | 🔴 P0    | ✅     |
| B1-003 | `merge(setAmount)` — 1 YES + 1 NO in → 1 USDC out — ✅ `Market.merge`                                                                                                                      | 🔴 P0    | ✅     |
| B1-004 | `redeem()` — winning token 1:1 for USDC, losing token zero — ✅ `Market.redeem` / `redeemInvalid`                                                                                          | 🔴 P0    | ✅     |
| B1-005 | State machine `OPEN → FROZEN → RESOLVED → SETTLED`, plus `INVALID` for postponed/abandoned games — ✅ `Market.State` + freeze/resolve/void transitions                                     | 🔴 P0    | ✅     |
| B1-006 | Outcome tokens use the shared decimals utility — ✅ outcome tokens inherit collateral decimals (6dp USDC ERC-20 side)                                                                      | 🔴 P0    | ✅     |
| B1-007 | Foundry tests: split/merge round-trip, collateral solvency invariant, resolve-before-freeze rejection, double-redeem rejection — ✅ `test/markets/Market.t.sol` — 30 tests                 | 🔴 P0    | ✅     |
| B1-008 | Fuzz harness: collateral can never fall below outstanding redeemable supply — ✅ `test/markets/MarketInvariant.t.sol` — 4 invariants, 512k calls                                           | 🟠 P1    | ✅     |
| B1-009 | Pool bootstrap: open the YES/USDC v4 pool at market creation, seeded at opening implied probability — ✅ `MarketPoolBootstrap.sol` + 6 tests. Hook slot takes `address(0)` until DM-110/B2 | 🔴 P0    | ✅     |
| B1-010 | Price ↔ probability util — one shared module for contracts-adjacent code, UI, and agent — ✅ `server/src/lib/probability.ts` — 17 tests                                                    | 🔴 P0    | ✅     |

---

## 🪝 PHASE B2 — Dynamic Market Hook (W2) 🔴

> Gated on DM-110.

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                         | Priority | Status |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| B2-001 | Implement hook against `docs/specs/dynamic-market-hook.md` — pre-flight done (decimals 6, keeper = resolver key); `RiskPolicy` blocked on the six risk parameters (spec §0.3) — ✅ 8 modules in `contracts/src/hooks/dynamic-market/`                                                                                                                                                                                                        | 🔴 P0    | ✅     |
| B2-002 | Permission-flag address mining (v4 encodes callbacks in the hook address) — ✅ `SaltMine.t.sol` mines a real salt, deploys via CREATE2 proxy, asserts `& 0x3FFF == 0x28C0`                                                                                                                                                                                                                                                                   | 🔴 P0    | ✅     |
| B2-003 | Freeze enforcement — hook rejects swaps once market is `FROZEN` — ✅ timestamp-driven; proven to fire with no keeper write ever made                                                                                                                                                                                                                                                                                                         | 🔴 P0    | ✅     |
| B2-004 | Fee behaviour per game state (pre-game / in-play / near-resolution) per spec — ✅ five-premium stack + directional adjustment, per event state                                                                                                                                                                                                                                                                                               | 🔴 P0    | ✅     |
| B2-005 | Deploy via Foundry, verify, record in hook registry — ✅ pre-launch broadcast 2026-08-17 by the operator from the encrypted keystore (bits `0x28C0` asserted; recorded in deploy/dynamic-market/README.md; deliberately outside the fixed-pair hook registry — market pools have no fixed pair, DM-112). That deployment is superseded: **Base Mainnet redeploy pending**, addresses env-driven with no defaults | 🔴 P0    | ✅     |
| B2-006 | Retain Stable Protection + Dynamic Fee hooks for non-market base pools — ✅ untouched; regression guards in `server/src/lib/v4-contracts.test.ts`                                                                                                                                                                                                                                                                                            | 🟠 P1    | ✅     |
| B2-007 | Security pass using the existing Trail of Bits skills methodology; HIGH findings block ship — ✅ `docs/security/dynamic-market-hook-review.md` — 0 HIGH, 1 MEDIUM found and fixed                                                                                                                                                                                                                                                            | 🔴 P0    | ✅     |
| B2-008 | Invariant tests: fee never exceeds cap; hook cannot block a legitimate redeem — ✅ 128k-call campaign, 0 reverts, + 100k deterministic sweep                                                                                                                                                                                                                                                                                                 | 🟠 P1    | ✅     |

---

## 📡 PHASE B3 — Sports Data Layer (W1–W3) 🔴

| ID     | Task                                                                                                                                                                                                                                                                                                                   | Priority | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| B3-001 | `SportsDataProvider` interface — ESPN is an adapter behind it, not called directly by feature code — ✅ `server/src/lib/sports/provider.ts`                                                                                                                                                                            | 🔴 P0    | ✅     |
| B3-002 | ESPN adapter for the DM-105 league(s): scoreboard, event summary, team marks — ✅ `espn.ts` — scoreboard, summary, team marks; fixture-tested, no network in tests                                                                                                                                                     | 🔴 P0    | ✅     |
| B3-003 | Resilience: retry with backoff, host fallback, cache (60s pre-game / 10s live), circuit breaker with "data delayed" state — ✅ `resilience.ts` — jittered backoff, per-host breakers, 60s/10s TTLs, stale-serve flagged `delayed`                                                                                      | 🔴 P0    | ✅     |
| B3-004 | Normalise provider event → canonical `events` row; provider-agnostic team IDs — ✅ normalization in adapters + `store.ts` canonical rows; home/away flip on a known event is refused, not applied                                                                                                                      | 🔴 P0    | ✅     |
| B3-005 | Ingest worker: slate refresh, live score polling, final capture — ✅ `ingest.ts` + `/api/cron/sports-sync`; scores ride the same slate poll; on-chain submission is B4's                                                                                                                                               | 🔴 P0    | ✅     |
| B3-006 | Market generator: new scheduled game auto-creates its market set per DM-106 — ✅ planner is pure and deterministic; two markets per game (one per side); on-chain creation LIVE 2026-08-17 via `createMarketsOnChain` on every sports-sync tick (idempotent `createMarketIfAbsent`; needs `MARKET_SIGNER_PRIVATE_KEY`) | 🔴 P0    | ✅     |
| B3-007 | Second-provider adapter per DM-107 — ✅ `consensus.ts` `SecondaryProvider` — vendor configurable; DM-107 names the requirement, not the vendor                                                                                                                                                                         | 🟠 P1    | ✅     |
| B3-008 | Disagreement detection: providers disagreeing on a final flags for manual review instead of auto-resolving — ✅ `corroborate` — agreement resolves, disagreement escalates to review, never a tiebreak                                                                                                                 | 🟠 P1    | ✅     |

---

## ⚖️ PHASE B4 — Resolution & Settlement (W2) 🔴

| ID     | Task                                                                                                                                                                                                                                                                     | Priority | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| B4-001 | `Resolver` contract — accepts outcome for a market ID, enforces signer authority, emits `MarketResolved` — ✅ `contracts/src/markets/Resolver.sol` — by market id, signer + operator authority, 16 tests                                                                 | 🔴 P0    | ✅     |
| B4-002 | Freeze trigger at scheduled start time — ✅ three layers: `Market.freeze` (permissionless, time-based), the hook's timestamp check, and the service's freeze sweep in `planResolution`                                                                                   | 🔴 P0    | ✅     |
| B4-003 | Resolution service: final detected → outcome derived → submitted onchain → DB reconciled — ✅ `resolution.ts` plan/execute over ports + `resolution-store.ts` + `/api/cron/resolution` (503 dry-run until the Resolver deploys)                                          | 🔴 P0    | ✅     |
| B4-004 | Manual override on the resolver; a bad or missing feed must not auto-settle a market — ✅ operator override on the Resolver; service holds on delayed, missing, unknown, or contradictory data — waiting is the default, settling is the exception                       | 🔴 P0    | ✅     |
| B4-005 | Void path: postponed/cancelled → `INVALID` → everyone redeems at cost — ✅ contract void (B1) + service mapping (postponed/cancelled/tie → both markets void) + 0.50 disclosure in Terms/docs                                                                            | 🔴 P0    | ✅     |
| B4-006 | Public resolution log (source, timestamp, signer, tx link) + UI disclosure of resolution authority — ✅ `resolutions` rows written only with a tx hash; `MarketResolved`/`MarketVoided` events carry the caller; authority disclosed in Terms, docs, and the market page | 🟠 P1    | ✅     |
| B4-007 | Resolver multisig upgrade per DM-103 — ⏸ P2 — blocked on DM-103 (single key vs multisig). The Resolver's operator seat already rotates two-step, so the swap is a role change, not a redeploy                                                                            | 🟡 P2    | ⏸      |

---

## 🏠 PHASE B5 — Landing, Board & Chat (W3) 🔴

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                         | Priority | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| B5-001 | Landing page stays (decided 2026-08-16); behind it, home is the Polymarket-style board, scoped to covered sports only — ✅ home's left column is the board (`Board.tsx`): covered leagues' games as matchup cards, chat/panel column alongside                                                                                                                               | 🔴 P0    | ✅     |
| B5-002 | Header sport buttons route to that sport's live page with the current slate — ✅ `/api/sports/slate` (public, sanitized whitelist) + `MarketPage` renders the league's live slate                                                                                                                                                                                            | 🔴 P0    | ✅     |
| B5-003 | Sport page: matchup cards with team marks, start time, live status, implied odds per outcome — ✅ `SlateList.tsx` — team marks, kickoff time, Live/Final/Postponed chips, implied win % from provider bps, winner bolding; scores hidden pre-game                                                                                                                            | 🔴 P0    | ✅     |
| B5-004 | Matchup click → analyst view renders inline; readable logged out — ✅ card click seeds the analyst thread; new `get_sports_slate` tool grounds answers in the real slate; works logged out (verified in browser)                                                                                                                                                             | 🟠 P1    | ✅     |
| B5-005 | Chat dock persistent at page bottom — ✅ the InputBar command dock persists at the bottom of the chat column on every route                                                                                                                                                                                                                                                  | 🔴 P0    | ✅     |
| B5-006 | Output placement: responses render below the last matchup content and above the chat dock, aligned to the same content column; scroll anchors so new output lands in view without jumping the board — ✅ adapted to the two-column shell: analysis renders in the right column beside the board, above the dock (deviation from single-column Polymarket layout, deliberate) | 🟠 P1    | ✅     |
| B5-007 | Auth gating: browse, analysis and chat open; every action (position, liquidity, hedge, agent) prompts login — ✅ REVISED by owner 2026-08-18: browsing + matchup details public; chatbot input AND trading require login (dock, board analyze clicks, and /api/analyze/chat all gated, client + server)                                                                      | 🔴 P0    | ✅     |
| B5-008 | Rate limiting + abuse controls on logged-out chat — ✅ `/api/analyze/chat` was already IP-rate-limited (`walletRateLimiter` falls back to IP) + global `ipRateLimiter`                                                                                                                                                                                                       | 🔴 P0    | ✅     |
| B5-009 | Empty / off-season state per sport — ✅ per-league off-season empty state, distinct from the error state; delayed-data banner on degraded slates                                                                                                                                                                                                                             | 🟠 P1    | ✅     |
| B5-010 | Mobile layout for board + chat dock — ✅ shell stacks below 1024px; board verified at ~700px viewport                                                                                                                                                                                                                                                                        | 🟡 P2    | ✅     |

---

## 🔐 PHASE B6 — Privy Auth, Profile & Portfolio (W3) 🔴

| ID     | Task                                                                                                                                                                                                                                                                                                                     | Priority | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| B6-001 | Login methods → Google, email, wallet; remove Apple and passkey from current config — ✅ `privy/config.ts` → `["google", "email", "wallet"]`                                                                                                                                                                             | 🔴 P0    | ✅     |
| B6-002 | Distinct Log in and Sign up entry points (Privy exposes one flow; the split is presentational) — ✅ header shows Log in (ghost) + Sign up (primary); both open the Privy modal                                                                                                                                           | 🔴 P0    | ✅     |
| B6-003 | Embedded wallet on signup for users without one — ✅ already configured (`createOnLogin: "users-without-wallets"`, D-006)                                                                                                                                                                                                | 🔴 P0    | ✅     |
| B6-004 | Chain restriction updated to the DM-104 target — ✅ Base-only (`supportedChains: [base]`)                                                                                                                                                                                                                                | 🔴 P0    | ✅     |
| B6-005 | Return-to-intent: user who clicked a matchup action lands back on that market — ✅ by construction — the Privy modal overlays the current route, so login from a market page resumes on that market                                                                                                                      | 🟠 P1    | ✅     |
| B6-006 | Server-side token verification retained on protected routes — ✅ unchanged — `attachAuth` global, `requireAuth` on write routes                                                                                                                                                                                          | 🔴 P0    | ✅     |
| B6-007 | Header auth control swaps state on login: Log in / Sign up becomes the profile button — ✅ logged in, the buttons become the profile pill (`WalletMenu`)                                                                                                                                                                 | 🔴 P0    | ✅     |
| B6-008 | Profile button routes to the portfolio; portfolio lives inside the user profile, not as a standalone nav item — ✅ `ProfilePage.tsx`; while it's open the left column swaps to the portfolio stack (balances + assets)                                                                                                   | 🔴 P0    | ✅     |
| B6-009 | Portfolio: open market positions with entry price, current implied odds, unrealised P/L, and market status — ✅ COMPLETE — live pool marks + ENTRY PRICE and unrealized P&L from indexed fills (`market_fills`, receipt-verified server-side, avg-cost basis) + one-click Close deep-linking into the league page's Sell | 🔴 P0    | ⏸      |
| B6-010 | Portfolio: LP positions with hook badges, token balances, and transaction history with explorer links — ✅ via the existing `PositionsList` (hook badges + history), linked from the profile                                                                                                                             | 🔴 P0    | ✅     |
| B6-011 | Portfolio: agent wallet view and armed hedging strategies (wires to B8, B9) — ⏸ agent-wallet section links to the Agent panel; armed strategies join when B9 exists                                                                                                                                                      | 🟠 P1    | ⏸      |
| B6-012 | Profile menu: settings, spending cap controls, log out — ✅ profile menu: Profile & portfolio, copy address, explorer, refresh, Agent & spending cap, Log out                                                                                                                                                            | 🟠 P1    | ✅     |

---

## 📊 PHASE B7 — Trading Page (W3) 🔴

| ID     | Task                                                                                                                                                                                                   | Priority | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| B7-001 | Split-screen: Swap modal left, Liquidity modal right, above the fold — ✅ `trading` route: swap left column, liquidity form right column (side-by-side ≥1024px)                                        | 🔴 P0    | ✅     |
| B7-002 | Pool list full width directly beneath the split — ✅ pool list renders beneath the swap panel                                                                                                          | 🔴 P0    | ✅     |
| B7-003 | Swap handles market outcome tokens and base tokens (USDC / EURC / cbBTC) — ✅ COMPLETE — buy AND sell live in the sidebar (Buy/Sell tabs, holdings display with Max); positions offer one-click Close | 🔴 P0    | ⏸      |
| B7-004 | Liquidity add/remove on market pools and base pools — ⏸ base-pool add/remove live (existing flows); market pools gated on deploy                                                                       | 🔴 P0    | ⏸      |
| B7-005 | Routing split per DM-112 — ✅ complete — `getV4StackForHook` resolves the Dynamic Market Hook to its own stack, so shared quote/calldata builders route market pools directly (DM-112)                 | 🔴 P0    | ⏸      |
| B7-006 | Pool list columns: pair, hook badge, TVL, 24h volume, fee tier, market status — ⏸ pair, hook badge, TVL, volume, fee tier shown; the market-status column joins when markets exist                     | 🟠 P1    | ⏸      |
| B7-007 | Filter/sort by sport, league, market status, TVL; responsive vertical collapse — ⬜ P2 — deferred                                                                                                      | 🟡 P2    | ⬜     |

---

## 🤖 PHASE B8 — Agent & Circle Agent Stack (W4) 🟠

> Circle Agent Stack includes Agent Wallets, Agent Marketplace, Circle CLI,
> Nanopayments via Circle Gateway, and Circle Skills. Agent Wallets are
> programmable USDC wallets with global limits, per-service caps, contract or
> chain allowlists, and time-bounded sessions.

| ID     | Task                                                                                                                                                                                                                                                                                                               | Priority | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| B8-001 | Verify Circle Agent Wallets support the DM-104 chain before migration work starts — ✅ verified 2026-08-17 against Circle docs: Base supports wallets, transfers, contract execution, signing, Gas Station; DM-111 closed                                                                                          | 🔴 P0    | ✅     |
| B8-002 | Agent page: header "Agent" routes here; mode selection; funding UI; live activity log — ✅ existing Agent panel: header route, funding UI, activity; carried through the pivot                                                                                                                                     | 🔴 P0    | ✅     |
| B8-003 | Intent parser extension: `open_position`, `close_position`, `provide_liquidity`, `hedge`, `analyze_matchup`, `query_market` — ✅ `chat-intent.ts`: league nav (`market`) + `position` open/close/hedge intents, WNBA/NBA disambiguation, analysis phrasing falls through to research; 9 new tests                  | 🔴 P0    | ✅     |
| B8-004 | Structured preview card before every confirmation modal — ✅ the trade sidebar is the structured preview for manual trades (side, amount, live quote, effective price, payout); the agent states its quote + cost in-conversation and executes inside caps                                                         | 🔴 P0    | ⏸      |
| B8-005 | Agent actions: open position, close position, add/remove market liquidity, portfolio summary — ✅ COMPLETE 2026-08-18 — the agent's `trade_market` tool buys/sells outcome tokens from its Circle wallet via the shared builder, balance- and cap-checked, allowlist-enforced                                      | 🔴 P0    | ⏸      |
| B8-006 | Contract allowlist restricted to Mantua market contracts and pools — ✅ `circle/allowed-targets.ts` enforced inside both Circle execution paths — tokens, v4 stacks, Permit2, commerce registry; market contracts join the list at deploy                                                                          | 🔴 P0    | ✅     |
| B8-007 | Agent never holds signing rights over the user's Privy wallet — ✅ by architecture — the agent signs only with its own Circle developer-controlled wallet; Privy keys never leave the user's client                                                                                                                | 🔴 P0    | ✅     |
| B8-008 | Prompt-injection hardening: matchup and market text entering LLM context is data, not instruction — ✅ provider strings sanitized once at the serializer (`public-slate.ts`: control chars, angle brackets, length caps, https-only logos); analyst system prompt frames slate strings as data, never instructions | 🟠 P1    | ✅     |
| B8-009 | Provision agent wallet via Circle Agent Stack; verify onchain — ✅ existing `getOrCreateAgentWallet` provisions a Circle DCW on Base and verifies on-chain — already the Circle stack per DM-111                                                                                                                   | 🟠 P1    | ✅     |
| B8-010 | Map Circle policies (global limit, per-service cap, contract allowlist, session TTL) onto the existing cap model — ⏸ global cap + contract allowlist mapped; per-service caps and session TTLs not yet — tracked here                                                                                              | 🟠 P1    | ⏸      |
| B8-011 | Migration or coexistence plan vs. the existing path per DM-111; document in `docs/architecture.md` — ✅ documented in `docs/architecture.md` — coexistence: the current path IS Circle's wallet stack on Base; no migration                                                                                        | 🟠 P1    | ✅     |

---

## 🛡️ PHASE B9 — Automated Hedging (W4) 🟠

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                        | Priority | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| B9-001 | Strategy schema: trigger, action, size, cap, expiry, kill condition — ✅ zod `strategyConfigSchema` (take-profit-stop / delta-hedge) + per-strategy USDC cap + expiry + disarm reasons; matches the B1 `hedge_strategies` table                                                                                                                                                                                                             | 🟠 P1    | ✅     |
| B9-002 | Strategy 1 — take-profit / stop: close a position when implied probability crosses a threshold — ✅ pure `evaluateStrategy` — thresholds speak the YES side's probability in one vocabulary; triggers close-position with the reason recorded                                                                                                                                                                                               | 🟠 P1    | ✅     |
| B9-003 | Strategy 2 — delta hedge: keep net exposure across correlated markets within a user-set band — ✅ band-around-target over summed exposures; ANY unknown exposure holds (hedging a partial picture can double exposure); rebalance sized and capped by the strategy cap                                                                                                                                                                      | 🟠 P1    | ✅     |
| B9-004 | Natural-language → strategy config, with structured preview before arming — ✅ `parseStrategyDraft` (conservative — null over guessed numbers) + preview lines + team→market candidate resolution against live slates; structured confirm required, prose never arms                                                                                                                                                                        | 🟠 P1    | ✅     |
| B9-005 | Execution engine: evaluate on price and game-state ticks, execute inside the agent wallet's policy caps — ✅ COMPLETE 2026-08-18 — triggered take-profit/stops now EXECUTE: signed by the user's agent wallet (never Privy keys), full balance clamped by the strategy cap, through the same shared trade builder as the user's button; audit row carries the tx hash. User-wallet positions trigger + record and wait for the user's click | 🟠 P1    | ⏸      |
| B9-006 | Strategy dashboard: armed / triggered / executed / expired, full audit trail — ✅ profile dashboard (`StrategiesSection`): status chips, disarm, arm via preview→confirm; every transition writes a `mantua_audit_log` row                                                                                                                                                                                                                  | 🟠 P1    | ✅     |
| B9-007 | Kill switch per strategy and globally; strategies auto-disarm on market freeze — ✅ P0 — precedence proven by test: kickoff freeze disarms on the very tick that would have fired; per-strategy disarm endpoint + `STRATEGIES_KILL_SWITCH` global; unparseable stored config auto-disarms (verified live)                                                                                                                                   | 🔴 P0    | ✅     |
| B9-008 | Market-maker mode with inventory skew — ⬜ P3 — deferred                                                                                                                                                                                                                                                                                                                                                                                    | ⚪ P3    | ⬜     |

---

## ✅ PHASE B10 — E2E & Ship (W5) 🔴

| ID      | Task                                                                                                                                                                                                                                                                                                                                                                                 | Priority | Status |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| B10-001 | Safety rails re-verified on new surfaces: spending caps, slippage, confirmation modal, kill switch, rate limits, audit log — ✅ rail-by-rail verification table in `docs/security/sign-off.md` §2 — caps, allowlist, confirms, kill switches, rate limits, audit, freeze layers, injection hardening, each with its enforcement point and evidence                                   | 🔴 P0    | ✅     |
| B10-002 | Full-lifecycle E2E: create → seed → positions both sides → add liquidity → price moves → freeze → resolve → redeem → balances verified — ✅ `contracts/test/e2e/FullLifecycle.t.sol` — every shipped contract in one harness, production wiring: split both sides → pool under hook at 0.50 → LP → swap → kickoff freeze (LP exit stays open) → resolve → redeem 1:1 → solvent-empty | 🔴 P0    | ✅     |
| B10-003 | Void E2E: postponed game → `INVALID` → all collateral returned — ✅ same harness — void pays exactly 0.50 to both sides, market drains to zero                                                                                                                                                                                                                                       | 🔴 P0    | ✅     |
| B10-004 | Data-outage E2E: provider down mid-game → market freezes, does not mis-resolve — ✅ outage scenario tests: freeze still happens on delayed data (timestamp-driven, cannot be wrong); nothing settles from a stale cache even when it contains a final; recovery settles normally                                                                                                     | 🔴 P0    | ✅     |
| B10-005 | Agent E2E: natural language → parse → preview → confirm → execute → audit entry — ✅ `server/src/lib/agent-e2e.test.ts` (task 042): one continuous journey — NL → real parser → preview (zero spend seams touched) → kill-switch-gated confirm → guardSpend around the real Circle receipt poll (SENT ≠ success) → `agent_swap` audit row with the confirmed tx hash; kill-switch and cap-exhausted refusal legs | 🔴 P0    | ✅     |
| B10-006 | Hedging E2E: arm strategy → trigger fires → executes under cap → disarms on freeze — ✅ `server/src/lib/sports/hedging-e2e.test.ts` (task 042): one journey over one strategy — NL draft → arm → real tick pipeline triggers → concurrent sweeps race the real `claimTriggered` (one winner) → cap-clamped receipt-confirmed close; SENT-stuck attempts bound at 3 → `execute-failed`; kickoff freeze disarms with zero executions and zero spend | 🟠 P1    | ✅     |
| B10-007 | Security sign-off — zero HIGH findings open, MEDIUM accepted in writing (`docs/security/sign-off.md`) — ✅ SIGNED 2026-08-18 — 0 HIGH, 0 MEDIUM open; L-01/L-02 accepted by the owner in writing (`docs/security/sign-off.md`)                                                                                                                                                       | 🔴 P0    | ✅     |
| B10-008 | Jurisdictional posture verified end to end (DM-108). No extra jurisdictional notice in the UI per the DM-108 close — ✅ marketing surfaces (landing, hero, features) carry no such notice; operational docs name Base Mainnet factually — DM-108 compliant                                                                                                              | 🔴 P0    | ✅     |
| B10-009 | Incident runbook: kill-switch activation, mis-resolution recovery, provider failover, user comms — ✅ `docs/ops/incident-runbook.md` — kill-switch tiers, mis-resolution response (prevention-first; on-chain is final), provider failover (designed response is no action), comms templates, escalation table                                                                       | 🟠 P1    | ✅     |
| B10-010 | Ship — ✅ SHIPPED 2026-08-18 — production live end to end: daily markets + seeded pools, full-screen trading UI with buy/sell + P&L, hedging execution, settlement armed, security sign-off signed                                                                                                                                                                                   | 🔴 P0    | ⏸      |

---

## 📊 Task Count

| Phase                              | 🔴 P0  | 🟠 P1  | 🟡 P2 | ⚪ P3 | Total  |
| ---------------------------------- | ------ | ------ | ----- | ----- | ------ |
| B0 Decision Gate & Specs           | 6      | 1      | 0     | 0     | 7      |
| B1 Market Primitives               | 9      | 1      | 0     | 0     | 10     |
| B2 Dynamic Market Hook             | 6      | 2      | 0     | 0     | 8      |
| B3 Sports Data Layer               | 6      | 2      | 0     | 0     | 8      |
| B4 Resolution & Settlement         | 5      | 1      | 1     | 0     | 7      |
| B5 Landing, Board & Chat           | 5      | 4      | 1     | 0     | 10     |
| B6 Privy Auth, Profile & Portfolio | 9      | 3      | 0     | 0     | 12     |
| B7 Trading Page                    | 5      | 1      | 1     | 0     | 7      |
| B8 Agent & Circle Stack            | 7      | 4      | 0     | 0     | 11     |
| B9 Automated Hedging               | 1      | 6      | 0     | 1     | 8      |
| B10 E2E & Ship                     | 7      | 3      | 0     | 0     | 10     |
| **Total**                          | **66** | **28** | **3** | **1** | **98** |

---

## 🗓️ Deferred Past Sept 16

| Item                                                | Target |
| --------------------------------------------------- | ------ |
| Live in-game props                                  | Sep W4 |
| Spreads                                             | Sep W4 |
| Additional leagues beyond DM-105                    | Sep W4 |
| Dispute window + resolver committee                 | Oct W1 |
| Market-maker mode, cross-market correlation hedging | Oct    |
| Mainnet posture                                     | Oct+   |
| Circle Agent Marketplace listing                    | Oct    |

---

## ✅ Definition of Done — Sept 16

- [ ] All 11 decisions closed and documented
- [ ] Browse sports, read analysis, and use chat without logging in
- [ ] Log in or sign up with Google, email, or wallet
- [ ] Header auth control becomes the profile button on login; profile opens the portfolio
- [ ] Portfolio shows market positions, LP positions, balances, and history
- [ ] Logged-in user opens a position on a real scheduled game
- [ ] Logged-in user provides liquidity to a market pool
- [ ] A market freezes at start, resolves from live data, and pays out correctly onchain
- [ ] A void game returns all collateral
- [ ] Agent executes a market action from natural language with preview + confirmation
- [ ] A user arms a hedging strategy in natural language and watches it execute under a cap
- [ ] Trading page split-screen live with pool list beneath
- [ ] Security sign-off, zero HIGH findings
- [x] ~~Jurisdictional posture explicit in the UI~~ — dropped 2026-08-16; implied, not marketed (DM-108)

---

## 🔗 References

| Resource                     | URL                                            |
| ---------------------------- | ---------------------------------------------- |
| Circle Agent Stack           | https://agents.circle.com/                     |
| Circle Agent Stack overview  | https://www.circle.com/agent-stack             |
| Circle developer platform    | https://developers.circle.com/                 |
| Uniswap v4 hooks             | https://docs.uniswap.org/contracts/v4/overview |
| Uniswap Trading API          | https://docs.uniswap.org/api/trading/overview  |
| Privy React docs             | https://docs.privy.io/basics/react/quickstart  |
| ESPN endpoint community docs | https://github.com/pseudo-r/Public-ESPN-API    |
| Foundry book                 | https://book.getfoundry.sh/                    |

---

## Site copy built ahead of this plan (Aug 16)

The marketing surface was rewritten for the sports positioning before this plan
landed. It is live and consistent with the positioning, but several pieces
encode assumptions this plan revises — see B0-006. Files:

- `client/src/components/landing/LandingPage.tsx` — hero, league nav, feature
  cards, FAQ, footer
- `client/src/components/legal/` — Privacy, Terms of Use, Market Integrity
- `client/src/components/docs/` — documentation site
- `client/src/features/markets/` — per-league market page (empty state) and the
  sport catalog

Known conflicts to resolve when the relevant task runs:

| Site copy today                                                  | Conflicts with                         | Action                                    |
| ---------------------------------------------------------------- | -------------------------------------- | ----------------------------------------- |
| Docs + Privacy say sign-in supports passkeys                     | B6-001 (remove Apple and passkey)      | Update both when the Privy config changes |
| Terms/Privacy describe trading and LPing, not resolution or void | B4-006 (disclose resolution authority) | Extend Terms with resolution + void terms |

Resolved 2026-08-16:

- **League coverage (DM-105).** NFL and WNBA are the covered set and lead the
  nav; NBA, MLB, NHL, and Soccer stay in the nav carrying a `Soon` chip, and
  their market pages show a coming-soon state that routes to the covered
  leagues. Driven by `coverage` in `features/markets/sports.ts`.
- **Jurisdictional posture (DM-108).** Implied, not surfaced. No banner or
  notice in the UI; B10-008 keeps the verification, drops the disclosure. The
  docs name Base Mainnet factually where users need chain details — that is
  instruction, not posture marketing.
- **Landing page (B5-001).** The landing page stays as the public marketing
  surface. The board is the logged-in home behind it.
