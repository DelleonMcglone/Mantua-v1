# Task 054 — Load test and chaos drills (Phase 7, R-008/R-009)

> Owner directive 2026-09-12 (Phase 7 ⚡, 🔴). "Simulate a marquee-game
> spike and pass without errors, lag, or unnecessary loading" and "kill a
> data feed / RPC mid-game and verify halts, banners, and recovery behave
> as designed". Ledger: `docs/tasks/live-sports-reliability.md`. Thresholds
> asserted: `docs/ops/monitoring.md`.
>
> Gates: server typecheck ✅, lint ✅, **825 pass / 0 fail** (818 → 825); client unchanged
> (163 pass / 0 fail).

## Task description

### R-008 — the spike, twice

1. **In CI, against the real routers** (`server/src/routes/live-stream-load.test.ts`).
   No network, no database: the routers on an ephemeral express app with
   their readers faked to realistic delays. Proven on every push:
   - **150 concurrent live streams** all receive their snapshot, p95
     time-to-first-snapshot within the `stream_open` budget (1 000 ms), and
     the 151st client is shed with 503 `STREAM_BUSY` (the cap set to 150
     for the test; production's is 200 per instance).
   - **300 concurrent `/api/status` reads** collapse onto **one** underlying
     computation (the 5 s cached reader) and stay within the `status`
     budget (300 ms).
   - **100 concurrent quotes** through the real trade router — the per-IP
     write limiter (20/min) bypassed exactly as the script bypasses it,
     with the load-test secret — return 200 with zero errors and p95 within
     the `quote` budget (800 ms, against a 10 ms fake quoter: what is
     proven is the router's own overhead and the bypass, not the RPC).
2. **Against a deployment** (`npm run load:spike -w @mantua/server -- --target <origin> [--spike]`,
   `server/src/scripts/load-test.ts`). Each virtual user holds a live
   stream (reconnecting like the client), reads `/api/status` every 20 s
   and the slate every 15 s; with a Privy token the users collectively
   issue quotes at the requested aggregate rate. The script reports
   p50/p95/p99 per route against `latency-budgets.ts`, the error rate, and
   the stream-open success rate, reads `/api/ops/metrics` for the server's
   own alerts, and exits 1 on any budget miss, ≥ 1 % errors, or < 99 %
   stream opens. Gated responses (`MARKETS_NOT_DEPLOYED`, `NO_MARKET`,
   `BETTING_CLOSED`, `TRADING_HALTED`) are reported, not counted as errors.

   **The marquee-game target** (`SPIKE_TARGET`, `--spike`): **500 concurrent
   viewers, 5 quotes/s aggregate, 120 s** — a prime-time NFL game on a
   platform at launch scale; every viewer streams, one in a hundred is
   quoting at any moment. Sized to the current deployment (one function,
   Neon pooler, dedicated RPC) and revised when real traffic says so.

   **The limiter bypass** (`LOAD_TEST_SECRET`, header `x-mantua-load-test`):
   the per-IP limiters would refuse 500 users from one machine — correctly.
   Requests carrying the configured secret skip them; with no secret set
   there is no bypass. Set it for the run, rotate it after.

### R-009 — the drills (`server/src/lib/chaos-drills.test.ts`)

Four timelines through the shipped modules, each pinning that the trade
gate, the status ladder, the alert policy and the transport agree at every
step:

| Drill | Fault                       | Verified                                                                                                                                                                                                                                                             |
| ----- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | The data feed dies mid-game | Half-way to the threshold: `feed_lag` warns, data labeled delayed, buys still open. Past it: buys **halted**, sells open, banner says exactly that, `feed_dark` pages. One ingest → live again, alerts clear.                                                        |
| 2     | The RPC dies mid-game       | Primary down → `rpc_on_fallback` warns. All hosts down → status degraded with the RPC message, `rpc_down` pages, **trading stays open**, and the live stream still delivers the score (a DB read) with the degraded status in the same snapshot. One success → live. |
| 3     | The kill switch is flipped  | POSTs and money crons refuse 503 `KILL_SWITCH_ACTIVE`; reads, the stream and the read-only live-sync pass; status paused with the operator message; `kill_switch` is info (never paged). Disengage → open.                                                           |
| 4     | A provider host dies        | Reads retry then stale-serve flagged `delayed`; after `BREAKER_THRESHOLD` failures the breaker opens and makes no calls; status degraded, trading open, `provider_breaker_open` warns.                                                                               |

**On a deployment**, the same drills are one env flip each — the runbook's
existing levers: stop the `live-sync` workflow (drill 1), point a preview's
`BASE_RPC_URL` at an unreachable dedicated host (drill 2), `SET
mantua:kill-switch 1` in Upstash (drill 3), block the provider host at the
network edge (drill 4) — and `GET /api/status` + `/api/ops/alerts` are the
observation points. Recovery is the reverse flip. Schedule: once before
launch and after any change to `platform-status.ts`, `alerts.ts`,
`market-trade-build.ts`, or `rpc-config.ts`.

## Options weighed

| Option                                             | Verdict                                                                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| k6 / artillery for the load test                   | Rejected for now. A dependency-free `tsx` script reads the repo's own budget constants, speaks the SSE protocol the client speaks, and needs nothing installed. k6 is the upgrade if the run needs to be distributed across machines. |
| A fault-injection layer in production code         | Rejected. Every drill runs through seams the routers already expose (`create*Router` deps, `ResilientJson`'s `fetchImpl`, the kill-switch gate's runtime flag, `RpcHealthRegistry`). No test-only branches ship.                      |
| Simulating the wallet's confirmation in the script | Not possible without a signing key on the load machine; the confirmation p95 is measured by the in-app pending register's `slow` label in production and remains a follow-up beacon (053).                                            |

## Success criteria

- [x] CI proves 150 concurrent streams within budget with shedding at the cap, 300 status reads on one computation within budget, and 100 concurrent quotes with zero errors within budget (R-008).
- [x] A deployment load script exists with the documented marquee-game target, budget-driven pass/fail, and a controlled limiter bypass (R-008).
- [x] Feed death, RPC death, kill switch, and provider death each verify the halt, the banner, the alert, and the recovery through the shipped modules (R-009).
- [x] The deployment drill procedure and observation points are written down (R-009).
- [ ] The `--spike` run executed against the deployment with a dedicated RPC and a Privy token — **owner-gated** (needs TD-007 and a test wallet).

## Failure conditions

- The in-process spike fails on a push (a budget regression or a shedding regression).
- A drill's four surfaces disagree at any step (e.g. the gate halts and the status says live).
- `LOAD_TEST_SECRET` unset and a bypass still exists.

## Implementation checklist

- [x] `server/src/lib/latency-budgets.ts` — budgets as a leaf module (the script's import); `metrics.ts` re-exports
- [x] `server/src/env.ts` `LOAD_TEST_SECRET`; `server/src/middleware/rate-limit.ts` bypass (`skipLimiter`)
- [x] `server/src/scripts/load-test.ts`; `npm run load:spike`
- [x] `server/src/routes/live-stream-load.test.ts`
- [x] `server/src/lib/chaos-drills.test.ts`

## Honest notes / follow-ups

- The in-process spike measures the routers, not the RPC or the database; the deployment run measures the whole. Both are needed and only the first is automatic.
- 500 streams from one laptop is a real client load; if the script itself becomes the bottleneck (CPU on the load machine), split the run across two machines with different `--users`.
