# Phase 7 — Live-Sports Reliability Infrastructure

> Owner directive 2026-09-12 (Phase 7 ⚡, 🔴). Execution confidence is part
> of the product — a launch blocker, not a polish item. The platform must be
> MORE reliable when markets move fastest. Ten rows, R-001 … R-010.
> Decision record: **D-113** in `docs/decisions/v2-open-decisions.md`.
>
> Naming note: the legacy v2 roadmap (`docs/tasks/v2-roadmap.md`, declared
> historical by the scope reconciliation) also has a "Phase 7" — DefiLlama
> analytics, rows `P7-00x`. This ledger is the sports-era Phase 7; its rows
> keep the owner's `R-` prefix so the two never collide.
>
> Snapshot: 2026-09-12 (post-054) · **5 ✅ · 5 🟡 · 0 ⬜**. Lanes: 051, 052,
> 053, 054 — all landed. Every 🟡 is owner-gated (a provider key, a
> vendor, a test wallet) or waits on R-007's downstream (positions on the
> stream); nothing is unstarted.

## What the reconnaissance found (baseline, before any lane)

- **No real-time path for market data.** SSE existed only for the LLM chat;
  the board polled `/api/sports/slate` every 60 s, the portfolio every 15 s,
  fiat rails every 1.5 s. Three `useSlate` instances per session, no shared
  cache, no visibility gating, no backoff.
- **A live correctness bug.** The in-play buy halt (P-012) trips when the
  feed is older than `IN_PLAY_FEED_MAX_AGE_MS` (10 min), but the only thing
  stamping `events.last_polled_at` was `/api/cron/sports-sync`, scheduled
  **once a day** (Vercel Hobby). Every in-play buy was halted outside a
  few minutes per day.
- **No status surface.** The kill switch, the provider breakers and the
  feed-freshness registry were only visible inside a cron-secret-gated
  response body. The client never checked `/api/health` and never handled
  `KILL_SWITCH_ACTIVE`. No global banner, no error boundary, no offline
  detection.
- **Trades could be lost.** The ticket dropped the tx hash on any receipt
  failure (timeout, RPC flake, tab close) and showed "error" for a trade
  that was probably mined; the fill report was fire-and-forget; nothing
  persisted across a reload; five incompatible status models across flows.
- **RPC is two public endpoints** with one retry each; the server default
  `BASE_RPC_URL` is `https://mainnet.base.org`. `/api/markets/positions`
  can issue ~120 uncached RPC reads per request; a quote is 5 serial hops.
- **Every data cache is per-lambda-instance memory**; Upstash holds only
  rate-limit counters and the kill-switch flag. `pg.Pool` is unconfigured.
- **No metrics, no error tracking, no alerting, no load or chaos harness.**
  The repo's own docs say so (`docs/tasks/040…:109`, M-01 in
  `docs/security/markets-contracts-review.md:233`).

## Reconciled table

| ID    | Task                                                                                                                                                 | Found (baseline)                                                      | Landed → lane                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| R-001 | Real-time transport: WebSocket/SSE price, position, and balance streaming to clients                                                                 | Polling only (60 s slate, 15 s portfolio)                             | **051:** `GET /api/stream/live` (SSE) streams the slate, live pool prices and the platform status — snapshot on connect, deltas on change, 5 s ticks in play, heartbeats, `Last-Event-ID`, deliberate `end` under the function ceiling. Client: one connection per page, reconnect/backoff, polling fallback, hidden-tab shedding. **Remaining:** positions and balances still poll — they wait on R-007 (their reads are the RPC amplifiers)                                                                | 🟡     |
| R-002 | Load architecture for game-time spikes: horizontal scaling, connection pooling, queue backpressure for simultaneous trading bursts                   | One lambda, `pg.Pool` defaults, no regions pin, no shedding           | **051:** stream backpressure — per-instance connection cap → 503 `STREAM_BUSY` + `Retry-After`, N clients share one read per league per tick, hidden tabs disconnect. **052:** `pg.Pool` per-instance max + connect/query timeouts + error handler, `regions: ["iad1"]`. **Remaining:** per-route shedding and the spike numbers come from 054's load test                                                                                                                                                   | 🟡     |
| R-003 | Latency budget: define and enforce p95 targets for quote, trade submit, and confirmation during live games; avoid lag and unnecessary loading states | No budget, no measurement; ~10 bare "Loading…" states                 | **051:** the ticket never blanks during re-quote/reconnect; slate data stays on screen while the transport reconnects. **053:** `LATENCY_BUDGETS_MS` (quote 800 / calldata 1 200 / fill 2 500 / status 300 / slate 500 / positions 1 500 ms p95; confirmation 8 000 client-side) enforced by `createLatencyMiddleware` at the Express edge — over-budget requests log `latency_budget_exceeded`; p95 per route in `/api/ops/metrics`; the ticket keeps the last quote visible while re-quoting               | ✅     |
| R-004 | Trade-status pipeline: submitted → pending → confirmed with push updates; no ambiguous states; clearly distinguish pending/success/failed            | Hash dropped on receipt failure; fire-and-forget fill; no persistence | **051:** `GET /api/markets/trade/status` (chain-verified: confirmed / failed / pending / unknown + `recorded`); client phases `confirming → pending → done/failed` with `error{kind}` reserved for pre-chain failures; the pending-trade register persists per wallet, resumes after reload, re-reports missing fills                                                                                                                                                                                        | ✅     |
| R-005 | Degradation strategy: reads stay live if writes degrade; clear status banner; never silent failure                                                   | No status endpoint; no banner; halt logic starved by a daily sync     | **051:** `GET /api/status` + pure ladder (`assessPlatformStatus`, same rules as the trade gate and the slate label); global `StatusBanner` (paused / degraded / unreachable / offline); `/api/cron/live-sync` every 5 min from GitHub Actions; `IN_PLAY_FEED_MAX_AGE_MS` 10 → 15 min sized for two missed ticks                                                                                                                                                                                              | ✅     |
| R-006 | Dedicated/paid RPC infrastructure (no public rate-limited endpoints in production — inherited v2 lesson)                                             | Default is `mainnet.base.org`; public hosts in the hot path           | **052:** production boot FAILS on a public `BASE_RPC_URL` / public fallback / public backstop (`rpcProviderIssues`); one ordered upstream list (`RPC_UPSTREAMS`) shared by the viem client and the wallet proxy; per-host health scored on every response → `/api/status.rpc`. **Owner-gated:** the dedicated provider key itself (TD-007)                                                                                                                                                                   | 🟡     |
| R-007 | Caching layers for market lists and static data so live-game hot paths get the headroom                                                              | Per-instance `Map`s only; positions uncached                          | **052:** `SharedCache` (per-instance L1 + Upstash L2, never fails a read) on live odds, the canonical slate read, pools, metrics, and per-wallet positions (invalidated by a verified fill)                                                                                                                                                                                                                                                                                                                  | ✅     |
| R-008 | Load test: simulate a marquee-game spike (concurrent users × trades/sec target) and pass without errors, lag, or unnecessary loading                 | Nothing                                                               | **054:** in CI — 150 concurrent streams within the `stream_open` budget with shedding at the cap, 300 status reads on one computation within budget, 100 concurrent quotes with zero errors within budget (`live-stream-load.test.ts`); against a deployment — `npm run load:spike` with the documented marquee target (500 viewers, 5 quotes/s, 120 s), budget-driven pass/fail, limiter bypass via `LOAD_TEST_SECRET`. **Owner-gated:** the `--spike` run on the deployment (needs TD-007 + a test wallet) | 🟡     |
| R-009 | Chaos test: kill a data feed / RPC mid-game and verify halts, banners, and recovery behave as designed                                               | Nothing (seams exist: `ResilientJson`, router factories)              | **054:** four drills through the shipped modules (`chaos-drills.test.ts`): feed dies → warn, then buys halted / sells open / banner / page, ingest recovers; RPC dies → degraded + page, trading open, the stream still delivers the score; kill switch → writes refuse, reads + live-sync pass, status paused; provider dies → stale-serve, breaker opens, degraded. Deployment procedure in the lane doc                                                                                                   | ✅     |
| R-010 | Monitoring + alerting: real-time dashboards for trade success rate, confirmation latency, feed lag; on-call paging thresholds                        | pino + audit table only                                               | **053:** `GET /api/ops/metrics` + `/api/ops/alerts` (cron-secret): latency p50/p95/p99, trade counters, stream gauge, cache, RPC hosts, DB pool, status, M-01 rows; `evaluateAlerts` = the paging policy (feed lag/dark, breaker, RPC, latency, trade success rate < 90%, **M-01 frozen-not-final**, stream capacity) evaluated every live-sync tick as structured `alert` log events; `docs/ops/monitoring.md`. **Owner-gated:** the log drain + pager vendor                                               | 🟡     |

## Task lanes

| Lane | Rows                       | Doc                                           |
| ---- | -------------------------- | --------------------------------------------- |
| 051  | R-001, R-002, R-004, R-005 | `docs/tasks/051-live-status-spine.md`         |
| 052  | R-006, R-007, R-002 (rest) | `docs/tasks/052-rpc-cache-pooling.md`         |
| 053  | R-003, R-010               | `docs/tasks/053-latency-budget-monitoring.md` |
| 054  | R-008, R-009               | `docs/tasks/054-load-chaos-drills.md`         |

## Failure conditions (the phase fails if any is reachable)

- A game is in play, the feed is fresh, and a buy is refused as halted.
- A game is in play, the feed has been dark longer than
  `IN_PLAY_FEED_MAX_AGE_MS`, and the platform does not say so anywhere the
  user can see it before they click.
- The platform is paused (kill switch) and a client learns it only from a
  refused POST.
- A signed trade is mined and the client shows "error" — or shows nothing
  after a reload.
- A stream that cannot connect leaves the board blank instead of polling.
- An overloaded instance stalls trade routes because streams hold it.

## What remains (owner-gated)

- **A log drain + pager vendor** for the `alert` / `latency_budget_exceeded`
  events (`docs/ops/monitoring.md` §Dashboards); until then `/api/ops/alerts`
  and the live-sync run log are the on-call's surface.
- **The `--spike` load run against the deployment** with the dedicated RPC
  in place and a Privy token for a test wallet (`docs/tasks/054-load-chaos-drills.md`).
- **Positions and balances on the stream** (R-001's remainder) — now
  unblocked by R-007's per-wallet cache; a follow-up lane.

- **A dedicated RPC provider key** (Alchemy / QuickNode / similar) for
  `BASE_RPC_URL` in production — lane 052 makes the public default a
  production boot failure; provisioning is an account the owner opens.
- **The Actions secret `CRON_SECRET`** must equal production's for the
  5-minute live-sync loop to run (the same requirement the autonomy loops
  already carry).
