# Phase 4 — Prediction Market Protocol

> Owner directive 2026-09-06. NFL markets on Uniswap v4 with USDC liquidity;
> settlement onchain; mechanism per **D-103**, resolution per **D-104**
> (`docs/decisions/v2-open-decisions.md`).
>
> Much of this phase shipped inside the sports-pivot waves (B0–B10, tasks
> 011–042). This ledger reconciles each row against commit-level evidence and
> tracks only the genuine remainder. Snapshot: 2026-09-06 · 5 ✅ · 8 🟡 · 1 ⬜.
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
| P-002 | Factory binds game → market                                     | `MarketFactory.sol` binds `marketId`/`startsAt`/`label`/`collateral`/`resolver`; teams/type/source bound only via keccak preimage; planning reads live slate, not persisted `events` | Persist the preimage binding at creation; plan from canonical `events` → **046**                                                                         | 🟡     |
| P-003 | Outcome tokens, full-collateral invariant                       | `split`/`merge`/`redeem`, four invariants (`MarketInvariant.t.sol`)                                                                                                                  | —                                                                                                                                                        | ✅     |
| P-004 | Lifecycle; buy/sell before **or during** the event              | States OPEN→FROZEN→RESOLVED→SETTLED (+INVALID); shipped freeze fires at kickoff                                                                                                      | **In-play trading** (owner call): state-driven freeze-on-final + time backstop, hook + spec + E2Es → **045**                                             | 🟡     |
| P-005 | Resolution engine (D-104)                                       | S-022…S-026 machinery, `Resolver.sol`, cron (task 040)                                                                                                                               | Dispute window; audited manual-override route; route resolution cron through `providerFor` (ESPN bypass fix) → **044**                                   | 🟡     |
| P-006 | Settlement; automatic position settlement                       | `redeem`/`redeemInvalid`, redeemable API, ClaimWinnings UI; protocol-side reclaim sweep                                                                                              | `market_positions` writers; post-resolution settlement pass (agent wallets auto-redeem; user positions marked claimable/settled) → **046**               | 🟡     |
| P-007 | Auto market creation from NFL schedule                          | Real automated pipeline: `cron-sports-sync` → plan → `createMarketIfAbsent` → pool open + seed; idempotent                                                                           | Deployment-gated only (`MARKETS_BY_CHAIN`/`DYNAMIC_MARKET_BY_CHAIN` empty until mainnet deploy — D-112)                                                  | ✅     |
| P-008 | v4 pool wiring with Dynamic Market Hook                         | `planMarketPool` (dynamic fee, hook), register-then-initialize order enforced, hook rejects unregistered/static pools                                                                | —                                                                                                                                                        | ✅     |
| P-009 | v4 API + routing for market trades                              | `swap-route.ts` venues, V4Quoter build path, task 033                                                                                                                                | — (note: market venue slippage rides `sqrtPriceLimitX96`, no `amountOutMinimum`)                                                                         | ✅     |
| P-010 | Onchain settlement audit (internal ops only; chainless user UI) | `MarketResolved` event; `resolutions` row records txHash/signer/payload                                                                                                              | Internal ops surface reading `resolutions` with BaseScan links; **remove** the public `MarketDetail` explorer link (chain branding in user UI) → **044** | 🟡     |
| P-011 | Historical price recording (every trade/tick)                   | Schema only — `market_prices` has **zero writers**; chart derives from client-reported `market_fills`                                                                                | Server-side tick writers: on receipt-verified fills + periodic pool snapshot in the sync cron; history/agent tools read it → **046**                     | ⬜     |
| P-012 | Integrity safeguards: halt on feed failure, delay resolution    | Resolution delay ✅ (S-022 breaker); on-chain "halt" is time-based + degradation clamp (fee/cap), by design                                                                          | Server-side quoting halt on feed outage (build refusal for affected markets) → **046**; on-chain stance documented in D-103                              | 🟡     |
| P-013 | AI security analysis of market/outcome contracts                | Hook-only review (`dynamic-market-hook-review.md`); sign-off predates markets contracts; `docs/security/slither/` empty                                                              | ToB-style review of `contracts/src/markets/*` **after** the 045 semantics change, slither regenerated, HIGH blocks ship → **045**                        | 🟡     |
| P-014 | Mainnet-fork E2E incl. live-trade during game                   | `FullLifecycle.t.sol` (local, mock USDC) covers the journey; fork suite covers generic v4 only; 032 forked deploy scripts                                                            | Fork E2E of the market lifecycle under new in-play semantics: trade during game → freeze on final → resolve → settle → balances → **045**                | 🟡     |

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

## Failure conditions

- A market remains tradeable after its event is final (backstop missing).
- A resolution submits without passing the criteria gate + dispute window.
- Chain branding reaches user-facing UI (ops-only surfaces excepted).
- A HIGH finding is open in the markets-contracts review at ship.
- `market_prices` stays empty while the chart claims history.
