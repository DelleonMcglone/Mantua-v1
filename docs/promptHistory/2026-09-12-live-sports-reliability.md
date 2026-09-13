# Prompt History — Live-Sports Reliability Infrastructure (Phase 7, tasks 051–054)

**Date:** 2026-09-12
**Branch:** `claude/xenodochial-hypatia-de2279`
**Task:** Phase 7 R-001 … R-010; lanes 051 (status spine, stream, trade status), 052, 053, 054.

## Original prompt (owner)

> ⚡ PHASE 7: Live-Sports Reliability Infrastructure 🔴
>
> Execution confidence is part of the product. A launch blocker, not a polish
> item. The platform must be MORE reliable when markets move fastest.
>
> | ID    | Task                                                                                                                                                 | Status |
> | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
> | R-001 | Real-time transport: WebSocket/SSE price, position, and balance streaming to clients                                                                 | ⬜     |
> | R-002 | Load architecture for game-time spikes: horizontal scaling, connection pooling, queue backpressure for simultaneous trading bursts                   | ⬜     |
> | R-003 | Latency budget: define and enforce p95 targets for quote, trade submit, and confirmation during live games; avoid lag and unnecessary loading states | ⬜     |
> | R-004 | Trade-status pipeline: submitted → pending → confirmed with push updates; no ambiguous states; clearly distinguish pending/success/failed            | ⬜     |
> | R-005 | Degradation strategy: reads stay live if writes degrade; clear status banner; never silent failure                                                   | ⬜     |
> | R-006 | Dedicated/paid RPC infrastructure (no public rate-limited endpoints in production — inherited v2 lesson TD-005)                                      | ⬜     |
> | R-007 | Caching layers for market lists and static data so live-game hot paths get the headroom                                                              | ⬜     |
> | R-008 | Load test: simulate a marquee-game spike (concurrent users × trades/sec target) and pass without errors, lag, or unnecessary loading                 | ⬜     |
> | R-009 | Chaos test: kill a data feed / RPC mid-game and verify halts, banners, and recovery behave as designed                                               | ⬜     |
> | R-010 | Monitoring + alerting: real-time dashboards for trade success rate, confirmation latency, feed lag; on-call paging thresholds                        | ⬜     |

## Refined prompt (as executed)

Reconcile each row against the repo (three read-only surveys: server
infrastructure, client data flow, docs/ops conventions), then build in
lanes, keeping the CI gates green after each:

1. **051 — status spine, stream, trade status.** A pure degradation ladder
   over the enforcement points' own inputs, served at `GET /api/status` and
   pushed on the stream; a global banner; a 5-minute game-time ingest tick
   (the daily sync had left the P-012 halt effectively permanent); one SSE
   stream per page for slate + prices + status with reconnect, polling
   fallback and per-instance capacity shedding; a server trade-status read
   and a persisted per-wallet pending register so a signed trade is never
   lost or misreported.
2. **052 — RPC, caching, pooling.** Production refuses public RPC defaults;
   per-host breakers + health into the status; a shared (Upstash) cache in
   front of the hot reads; `pg.Pool` sizing and timeouts; regions pinned.
3. **053 — latency budget, monitoring.** p95 targets for quote / submit /
   confirm as constants, per-route timing with budget-violation events, a
   metrics read, alert thresholds and the M-01 frozen-not-final alert.
4. **054 — load + chaos.** A load script against a deployment with a
   documented spike target, and chaos drills through the routers' seams:
   feed dead / RPC dead mid-game → halts, banner, recovery.

Note on the prompt's "TD-005": in this repo TD-005 is the E2E-harness debt
item; the inherited dedicated-RPC lesson lives in `rpc-client.ts`'s header,
task 045 §"Flakiness caveat", and `contracts.yml`. Lane 052 cites those.
