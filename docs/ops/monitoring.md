# Monitoring, latency budgets, and paging (Phase 7, tasks 051–053)

> Who this is for: the operator on call, and whoever wires the log drain.
> Everything here is served by the API itself — no vendor is required to
> read it — and the paging thresholds are code (`server/src/lib/alerts.ts`),
> tested, so the policy cannot drift from the numbers.

## The three reads

| Read                   | Auth               | What it is                                                                                                                                                                   |
| ---------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/status`      | none (cached 5 s)  | The platform's degradation state: `mode`, `reads`, `trading`, per-league feed freshness, breakers, RPC, banner message. What users see.                                      |
| `GET /api/ops/metrics` | Bearer CRON_SECRET | Budgets, per-route latency (p50/p95/p99/max, violations, 5xx), trade counters, stream gauge, cache stats, RPC host health, DB pool, the M-01 rows, and the evaluated alerts. |
| `GET /api/ops/alerts`  | Bearer CRON_SECRET | The evaluated alerts only.                                                                                                                                                   |

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://test-mantua.vercel.app/api/ops/metrics \
  | jq '{alerts, latency: [.latency[] | {key, p95, budgetMs, violations, count}], rpc: .rpc.detail, cache: .cache, db: .db}'
```

**Scope.** Latency, counters, the stream gauge and cache stats are **per
lambda instance** — the response's `scope` field says so. Status, RPC
health and the M-01 rows are platform-wide. Cross-instance aggregation is
the log drain's job (below); the per-instance numbers are still the right
shape for "is this instance sick" and for the load test.

## Latency budgets (R-003)

p95 targets, milliseconds, measured at the edge of Express
(`server/src/lib/metrics.ts`, `createLatencyMiddleware`). Every request over
budget logs a structured `latency_budget_exceeded` event with `key`, `ms`,
`budgetMs`, `status`.

| Key            | Route                              | p95 budget | Why                                                                                |
| -------------- | ---------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `quote`        | `POST /api/markets/trade/quote`    | 800        | 5 serial RPC hops on a dedicated endpoint + 1 DB read; the ticket debounces 400 ms |
| `calldata`     | `POST /api/markets/trade/calldata` | 1 200      | the quote path + the cap check/record                                              |
| `fill`         | `POST /api/markets/fills`          | 2 500      | two receipt reads + insert + bookkeeping                                           |
| `trade_status` | `GET /api/markets/trade/status`    | 600        | one or two receipt reads                                                           |
| `status`       | `GET /api/status`                  | 300        | one cached aggregate; the banner's source                                          |
| `slate`        | `GET /api/sports/slate`            | 500        | cached canonical read + cached live-odds overlay                                   |
| `positions`    | `GET /api/markets/positions`       | 1 500      | cached per wallet; cold path ~3 RPC reads per market row                           |
| `confirmation` | client receipt wait                | 8 000      | Base blocks ~2 s; four blocks. Measured by the load test, not the middleware       |

Paging on latency: p95 over budget with ≥ 20 samples in the window →
**warn**; over 2× budget → **critical**.

## Alerts — the paging policy (R-010)

`evaluateAlerts` runs on every `/api/ops/alerts` read and on every
live-sync tick (every 5 minutes); on a tick, each firing `warn`/`critical`
alert is logged as a structured `alert` event (`alertId`, `severity`,
`title`, `detail`, `runbook`) — the line the drain routes to a pager.

| Alert id                | Fires when                                                                                        | Severity  | Runbook          |
| ----------------------- | ------------------------------------------------------------------------------------------------- | --------- | ---------------- |
| `feed_lag:<league>`     | a game is in play and the feed is older than half `IN_PLAY_FEED_MAX_AGE_MS` (7.5 min)             | warn      | runbook §8       |
| `feed_dark:<league>`    | a game is in play and the feed is older than `IN_PLAY_FEED_MAX_AGE_MS` (15 min) — buys are halted | critical  | runbook §3, §8   |
| `provider_breaker_open` | any sports-provider host breaker is open                                                          | warn      | runbook §3       |
| `rpc_on_fallback`       | the primary RPC host is failing and reads are on a fallback                                       | warn      | runbook §9       |
| `rpc_down`              | every RPC host is failing                                                                         | critical  | runbook §9       |
| `latency:<key>`         | p95 over budget (warn) / over 2× budget (critical), ≥ 20 samples                                  | warn/crit | this doc         |
| `trade_success_rate`    | > 10% of reported fills failed verification, ≥ 10 fills                                           | critical  | this doc §Trades |
| `frozen_not_final`      | **M-01**: a market is FROZEN while its game is not final, for > 5 min                             | critical  | runbook §2; M-01 |
| `stream_at_capacity`    | live-stream connections at the per-instance cap (200)                                             | warn      | runbook §8       |
| `kill_switch`           | the kill switch is engaged (deliberate — shown, never paged)                                      | info      | runbook §1       |

**Paging thresholds:** `critical` pages the on-call immediately; `warn`
posts to the ops channel and pages if it persists for two consecutive
ticks (10 minutes); `info` is dashboard-only.

### Trades

Counters (per instance, monotonic since cold start): `fill.recorded`,
`fill.replayed`, `fill.tx_failed`, `fill.wrong_target`, `fill.verify_failed`,
`trade_status.<state>`, `market-quote.ok`, `market-quote.<reason>`,
`market-trade.ok`, `market-trade.<reason>` where reason ∈
`cap_blocked | halted | closed | no_market | not_deployed | quote_failed`.
Trade success rate = `fill.recorded / (fill.recorded + tx_failed +
wrong_target + verify_failed)`. A rising `market-trade.halted` during a
game is the P-012 halt doing its job — check `feed_*` first.

### M-01 (frozen-but-not-final)

`readFrozenNotFinal` (store) lists markets whose row is `FROZEN` while the
canonical event is not `final`/`postponed`/`cancelled`. The resolution flow
writes both on one tick; a persistent divergence means the service is
half-operating (the freeze landed, the registry state did not) — the
scenario the security review's M-01 requires monitoring for. The strict
on-chain form (reading the hook's event state per frozen market) is a
follow-up; this catches what the service itself can see.

### Pricing (Phase 9, task 066)

| Alert          | Severity | Rule                                                                                          | Runbook                                                                                                       |
| -------------- | -------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pricing_zero` | warn     | `pricing.fallback_zero` > 0 this instance (Pyth and DefiLlama both failed for a priced token) | check the Pyth Hermes and DefiLlama Coins endpoints; totals undervalue until a feed recovers; caps unaffected |

### Agent gate (Phase 8, task 061)

| Alert                | Severity | Rule                                                                                              | Runbook                            |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `agent_refusal_rate` | warn     | ≥ 10 gated executions this instance and > 50 % refused (`agent.funnel.refused.*` vs `execute_ok`) | `docs/ops/incident-runbook.md` §12 |

The funnel counters (`agent.funnel.turn`, `.analyze`, `.simulate`,
`.preview`, `.confirm_minted`, `.execute_ok`, `.refused.<code>`) are the
user-testing baseline (A-044); read them from `/api/ops/metrics` before
and after each owner user test.

## Dashboards and the log drain (owner-gated)

The API emits everything as structured pino JSON to stdout, which Vercel
captures per invocation. To get cross-instance dashboards and a pager:

1. Vercel → Project → Settings → Log Drains → add a drain to the vendor
   (Datadog, Grafana Cloud/Loki, Axiom, Better Stack — any JSON drain).
2. Route on `event`: `alert` (by `severity`), `latency_budget_exceeded`
   (by `key`), and the request logs' `res.statusCode`/`responseTime` for
   the p95 panels.
3. Panels: trade success rate (from the `fill.*` counters or the
   `/api/markets/fills` status codes), confirmation latency (the load
   test's client-side numbers; production needs the client to report it —
   follow-up), feed lag (`/api/status.feeds.*.ageMs`, scrape every 60 s),
   RPC host health (`/api/ops/metrics.rpc.hosts`).
4. Pager rules = the table above. Until a drain exists, the live-sync
   workflow's run log carries the `alert` lines and `/api/ops/alerts` is
   the on-call's first `curl`.

## Load and chaos (task 054)

The load test asserts the budgets above against a deployment and the
chaos drills assert the alert table above through the routers' seams;
their runbooks live in `docs/tasks/054-load-chaos-drills.md`.
