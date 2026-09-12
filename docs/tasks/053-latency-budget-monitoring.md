# Task 053 — Latency budget, metrics, alerts (Phase 7, R-003/R-010)

> Owner directive 2026-09-12 (Phase 7 ⚡, 🔴). "Define and enforce p95
> targets for quote, trade submit, and confirmation during live games" and
> "real-time dashboards for trade success rate, confirmation latency, feed
> lag; on-call paging thresholds". Ledger: `docs/tasks/live-sports-reliability.md`.
> Ops reference: `docs/ops/monitoring.md`.
>
> Gates: server typecheck ✅, lint ✅, **818 pass / 0 fail** (802 → 818); client typecheck ✅,
> lint ✅, **163 pass / 0 fail**.

## Task description

1. **The budget is code and it is enforced (R-003).** `LATENCY_BUDGETS_MS`
   (`server/src/lib/metrics.ts`) holds p95 targets for the paths a user
   waits on during a game — quote 800 ms, calldata 1 200, fill 2 500,
   trade status 600, status 300, slate 500, positions 1 500 — with the
   rationale next to each number (5 serial RPC hops on a dedicated
   endpoint, the 400 ms debounce, Base's ~2 s blocks). The client-side
   confirmation target is 8 000 ms (four blocks). `createLatencyMiddleware`
   sits right after the request logger and times every classified route
   from the edge of Express; a request over budget emits a structured
   `latency_budget_exceeded` event. `LatencyRecorder` keeps a bounded
   window per key (512 samples) with nearest-rank p50/p95/p99, max,
   violations and 5xx counts.
2. **"Avoid lag and unnecessary loading states" (R-003, client).** The
   ticket no longer blanks on every keystroke: `quoting` carries the
   previous quote, the numbers stay on screen at reduced opacity with
   `aria-busy`, and "Quoting…" appears only before the first quote. (051
   already keeps slate data on screen while the stream reconnects and
   never shows a spinner over data it has.)
3. **A metrics read and an alert policy (R-010).** `GET /api/ops/metrics`
   and `GET /api/ops/alerts` (Bearer `CRON_SECRET`, like the crons) expose
   budgets, per-route latency, trade counters (`fill.recorded / tx_failed /
wrong_target / verify_failed`, `trade_status.<state>`, `market-quote.*`,
   `market-trade.*`), the stream gauge, cache stats, per-host RPC health,
   the DB pool, the platform status, the M-01 rows, and the evaluated
   alerts. `evaluateAlerts` (`server/src/lib/alerts.ts`, pure, tested) is
   the paging policy: feed lag/dark during play, provider breaker open, RPC
   on fallback / down, latency over budget / over 2×, trade success rate
   under 90%, **M-01 frozen-but-not-final**, stream at capacity, kill
   switch (info). Every live-sync tick (5 min) evaluates it and logs each
   `warn`/`critical` alert as a structured `alert` event — the line a log
   drain routes to a pager.
4. **M-01's monitoring requirement.** `readFrozenNotFinal` lists markets
   whose row is FROZEN while the canonical event is not final/void;
   `frozen_not_final` pages once a divergence persists past a 5-minute
   grace. This is the "monitoring MUST alert on a Frozen market whose
   registry state is not FINAL/RESOLVED" clause of
   `docs/security/markets-contracts-review.md` M-01, in the form the
   service can see server-side (the on-chain registry read is a follow-up).

## Options weighed

| Option                                                       | Verdict                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add an APM/error-tracking SDK (Sentry, Datadog) in this lane | Deferred — vendor choice and DSN are the owner's; the lane emits everything as structured JSON so any log drain works, and `docs/ops/monitoring.md` gives the drain recipe. The alert policy lives in code either way. |
| Store metrics in Upstash for cross-instance p95              | Rejected for now. A per-request Redis write on the hot paths is the wrong trade; per-instance windows + the drain's aggregation is the standard serverless shape. The response declares its scope.                     |
| Budgets as env-tunable numbers                               | Rejected. A budget that can be relaxed by env is not a budget; changing it is a code change with a rationale, like the hard ceilings in `constants.ts`.                                                                |
| Confirmation latency measured server-side                    | Not possible — the wallet signs and waits client-side. The load test measures it; a client beacon is a follow-up.                                                                                                      |

## Success criteria

- [x] p95 budgets for quote, calldata (submit), fill, trade status, status, slate, positions are constants with rationale; confirmation's client-side target is stated (R-003).
- [x] Classified routes are timed at the Express edge; over-budget requests log `latency_budget_exceeded`; p95 is computed over a bounded window (R-003).
- [x] The trade ticket keeps the last quote visible while re-quoting (R-003).
- [x] `/api/ops/metrics` and `/api/ops/alerts` exist, are cron-secret guarded, and declare their per-instance scope (R-010).
- [x] The alert policy is pure, tested per threshold, and runs on every live-sync tick with structured `alert` log events (R-010).
- [x] M-01's frozen-but-not-final condition is detected and pages after a grace window (R-010).
- [ ] A log drain + pager vendor wired — **owner-gated** (`docs/ops/monitoring.md` §Dashboards).
- [ ] The confirmation p95 measured in production (needs a client beacon) — the load test (054) measures it meanwhile.

## Failure conditions

- A route over its budget with no `latency_budget_exceeded` line.
- An alert threshold in the doc that differs from `alerts.ts`.
- A FROZEN market with a live game and no `frozen_not_final` after the grace window.
- `/api/ops/metrics` reachable without the cron secret.

## Implementation checklist

- [x] `server/src/lib/metrics.ts` (+ test) — budgets, `routeBudgetKey`, `LatencyRecorder`, `Counters`, `createLatencyMiddleware`
- [x] `server/src/lib/alerts.ts` (+ test) — `evaluateAlerts` and the thresholds
- [x] `server/src/routes/ops-metrics.ts` (+ test) — the two reads; `buildAlertInput`
- [x] `server/src/lib/sports/store.ts` — `readFrozenNotFinal`
- [x] `server/src/routes/live-stream.ts` — `liveStreamConnections` gauge
- [x] `server/src/routes/market-fills.ts`, `market-trade.ts` — outcome counters
- [x] `server/src/routes/cron-live-sync.ts` — tick-time alert evaluation + `alert` log events
- [x] `server/src/app.ts` — latency middleware after the request logger; ops router
- [x] `client/src/features/markets/use-market-trade.ts`, `LeaguePage.tsx` — `quoting.previous`
- [x] `docs/ops/monitoring.md`

## Honest notes / follow-ups

- Counters and latency reset on a cold start and are per instance. The
  drain recipe in `docs/ops/monitoring.md` is how they become dashboards.
- The M-01 check is DB-level. Reading the hook's event state on-chain per
  frozen market would make it strict; it needs an ABI entry the hook does
  not expose today.
