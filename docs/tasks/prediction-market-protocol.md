# Phase 4 — Prediction Market Protocol

> Owner directive 2026-09-06. NFL markets on Uniswap v4 with USDC liquidity;
> settlement onchain; mechanism per **D-103**, resolution per **D-104**
> (`docs/decisions/v2-open-decisions.md`).
>
> Much of this phase shipped inside the sports-pivot waves (B0–B10, tasks
> 011–042). This ledger reconciles each row against commit-level evidence and
> tracks only the genuine remainder. Snapshot: 2026-09-06 (post-044/045/046/047)
> · **14 ✅ · 0 🟡 · 0 ⬜** — every P-row's code has landed; what is left is
> deployment (D-112) and one owner signature (M-01), both in **What remains**
> below. Previous snapshot: 5 ✅ · 8 🟡 · 1 ⬜.
>
> **Owner decision 2026-09-06 (in D-103): in-play trading.** Buy/sell is
> allowed at any time before or during the event. This supersedes the
> `market-lifecycle.md` §3.4 kickoff-freeze deferral and changes contract
> semantics (task 045): trading closes on final (resolver/operator freeze)
> with a permissionless time backstop, not at kickoff.

## Reconciled table

| ID    | Task                                                            | Found                                                                                                                                                                                | Remainder → task                                                                                                                                         | Status |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P-001 | Market mechanism design                                         | Shipped: full-collateral YES/NO, YES/USDC pool, price=probability (`contracts/src/markets/*`, `docs/specs/market-lifecycle.md`, `probability.ts`)                                    | D-103 authored (this wave) — codifies mechanism + in-play change                                                                                         | ✅     |
| P-002 | Factory binds game → market                                     | `MarketFactory.sol` binds `marketId`/`startsAt`/`label`/`collateral`/`resolver`; teams/type/source bound only via keccak preimage; planning reads live slate, not persisted `events` | **Landed (046).** Migration 0017 adds `markets.provider`/`provider_event_id`; `upsertMarketRows` persists the preimage write-once and refuses a row whose recomputed `computeMarketId` ≠ the id; sync cron plans via `planMarketsFromCanonical` off persisted `events`, never the live slate | ✅     |
| P-003 | Outcome tokens, full-collateral invariant                       | `split`/`merge`/`redeem`, four invariants (`MarketInvariant.t.sol`)                                                                                                                  | —                                                                                                                                                        | ✅     |
| P-004 | Lifecycle; buy/sell before **or during** the event              | States OPEN→FROZEN→RESOLVED→SETTLED (+INVALID); shipped freeze fires at kickoff                                                                                                      | **Landed (045 + 046 + 047).** Contracts: `Market.MAX_EVENT_DURATION = 12h`, resolver-only freeze from `startsAt`, permissionless after the backstop, `isTradeable()` backstop-aware, hook gate `eventState == FINAL \|\| isPastBackstop` (`FREEZE_LEAD` removed, cross-layer equality asserted). Server/client: trade gate, `ticksFromSlates`, reband window and UI all in-play (046). Resolution cron freeze sweep moved off kickoff onto final-or-backstop (**047**) | ✅     |
| P-005 | Resolution engine (D-104)                                       | S-022…S-026 machinery, `Resolver.sol`, cron (task 040)                                                                                                                               | **Landed (044).** `resolutionProviderFor` → `providerFor` (ESPN bypass fixed); mandatory dispute window (`RESOLUTION_DISPUTE_WINDOW_SECONDS`, migration 0016, stamped on the `resolutions` row, operator hold honoured); audited manual-override route through the Resolver operator role with a mandatory note | ✅     |
| P-006 | Settlement; automatic position settlement                       | `redeem`/`redeemInvalid`, redeemable API, ClaimWinnings UI; protocol-side reclaim sweep                                                                                              | **Landed (046).** Fill path maintains one aggregate `market_positions` row per (market, wallet, side); `settleResolvedPositions` stamps `settled_at`/`settlement_price` (winner from the resolutions log, unknown winner HOLDS); agent-wallet positions auto-redeem through the Circle path and stamp `redeemed_at`/`redeem_tx_hash` | ✅     |
| P-007 | Auto market creation from NFL schedule                          | Real automated pipeline: `cron-sports-sync` → plan → `createMarketIfAbsent` → pool open + seed; idempotent                                                                           | Deployment-gated only (`MARKETS_BY_CHAIN`/`DYNAMIC_MARKET_BY_CHAIN` empty until mainnet deploy — D-112)                                                  | ✅     |
| P-008 | v4 pool wiring with Dynamic Market Hook                         | `planMarketPool` (dynamic fee, hook), register-then-initialize order enforced, hook rejects unregistered/static pools                                                                | —                                                                                                                                                        | ✅     |
| P-009 | v4 API + routing for market trades                              | `swap-route.ts` venues, V4Quoter build path, task 033                                                                                                                                | — (note: market venue slippage rides `sqrtPriceLimitX96`, no `amountOutMinimum`)                                                                         | ✅     |
| P-010 | Onchain settlement audit (internal ops only; chainless user UI) | `MarketResolved` event; `resolutions` row records txHash/signer/payload                                                                                                              | **Landed (044 + 046).** `GET /api/ops/resolution` (internal auth) serves txHash, signer, method, confidence state, dispute-window stamps, source-payload summary and BaseScan links; the public `MarketDetail` explorer link + `basescan.org` constant removed by 046 — user UI is chainless | ✅     |
| P-011 | Historical price recording (every trade/tick)                   | Schema only — `market_prices` has **zero writers**; chart derives from client-reported `market_fills`                                                                                | **Landed (046).** Two writers: receipt-verified fills write a `fill` tick (idempotent on the fill insert) and `snapshotMarketPoolPrices` writes `pool` ticks per sync cron tick (60 s cadence dedupe); the detail chart, history, metrics and agent tools read the recorded series. Pool snapshots are deployment-gated (D-112) | ✅     |
| P-012 | Integrity safeguards: halt on feed failure, delay resolution    | Resolution delay ✅ (S-022 breaker); on-chain "halt" is time-based + degradation clamp (fee/cap), by design                                                                          | **Landed (046).** `assessMarketTradability` halts server-side quoting (buys) while a game is in play and `events.last_polled_at` is older than `IN_PLAY_FEED_MAX_AGE_MS`; sells always build; route returns 503 `TRADING_HALTED`. On-chain stays open-but-clamped by the hook's ladder, as D-103 states | ✅     |
| P-013 | AI security analysis of market/outcome contracts                | Hook-only review (`dynamic-market-hook-review.md`); sign-off predates markets contracts; `docs/security/slither/` empty                                                              | **Landed (045).** `docs/security/markets-contracts-review.md` — ToB methodology over `contracts/src/markets/*` + the four changed hook files under the NEW semantics. **0 HIGH** (found and fixed a permissionless `Resolver.freeze()` forward, regression-tested). Slither 0.11.4 outputs checked in (27 findings, 0 High, 9 Medium all triaged). **M-01 MEDIUM open — owner written acceptance pending (see What remains)** | ✅     |
| P-014 | Mainnet-fork E2E incl. live-trade during game                   | `FullLifecycle.t.sol` (local, mock USDC) covers the journey; fork suite covers generic v4 only; 032 forked deploy scripts                                                            | **Landed (045).** `MarketLifecycleForkE2E.t.sol` on forked Base Mainnet with real canonical USDC, stack deployed in-fork (CREATE2-mined hook, dedicated DM PoolManager): pre-kickoff trade → **in-play trade + split** → stranger freeze rejected → resolver freeze on final → resolve → redeem → USDC conservation. 1 passed | ✅     |

## Task lanes

- **043 — this doc + decisions** (D-103, D-104, DM-103 close, ledger).
- **044 — resolution engine completion** (dispute window, manual override,
  providerFor routing fix, ops verifiability surface, explorer-link removal).
- **045 — in-play trading contracts + security + fork E2E** (freeze-on-final
  semantics in `Market.sol`/hook, spec §3.4 rewrite, markets security review,
  slither, fork lifecycle E2E with in-game trading).
- **046 — market data spine** (price-tick writers, positions + auto
  settlement, factory binding persistence + plan-from-events, feed-outage
  quoting halt, hedging freeze-signal alignment to in-play semantics).
- **047 — in-play freeze sweep** (the resolution cron's `planResolution`
  still swept an on-chain freeze at kickoff — the last pre-D-103 assumption,
  and the one holding the resolver key; moved to freeze-on-final + the 12 h
  backstop, plus a repo-wide grep sweep for the same assumption elsewhere).

## What remains

Every P-row's code has landed. Two things are outstanding, neither of them
code in this phase:

1. **M-01 (MEDIUM) — owner written acceptance pending.** From 045's
   security review and the `docs/security/sign-off.md` D-103 addendum: the
   hook's halt (`eventState = FINAL`) and the market's `freeze()` are two
   different writes by the same service, so a half-operating service can
   leave a decided market trading until the stale-keeper clamp and the 12 h
   backstop catch it. The mitigation is **operational** (both writes on the
   same tick, alerting when they diverge), so the finding needs the owner's
   written acceptance of the residual risk — the addendum explicitly does
   **not** re-sign the ship gate. L-01/L-02/I-01/I-02 remain documented and
   open; none block.
2. **Deployment-gated by D-112 (launch chain: Base vs Arc, owner decision
   after 2026-09-17).** `MARKETS_BY_CHAIN` and `MARKETS_PERIPHERY_BY_CHAIN`
   are `{}` and `DYNAMIC_MARKET_BY_CHAIN` is unpopulated until the mainnet
   deploy, so the on-chain legs of otherwise-✅ rows degrade to planning
   rather than executing: market creation and pool seeding (P-007), pool
   price snapshots (P-011), on-chain metrics/live odds, the resolution
   submitter (the cron reports 503 `RESOLUTION_DISABLED` with its dry-run
   plan) and agent auto-redeem. All are env-driven nulls by design, and the
   pure planning/decision paths above them are tested and green. Also
   carried to the deploy: sign-off finding I-01 (keeper key == resolver key
   until the keys are split at deploy).

## Failure conditions

- A market remains tradeable after its event is final (backstop missing).
- A resolution submits without passing the criteria gate + dispute window.
- Chain branding reaches user-facing UI (ops-only surfaces excepted).
- A HIGH finding is open in the markets-contracts review at ship.
- `market_prices` stays empty while the chart claims history.
