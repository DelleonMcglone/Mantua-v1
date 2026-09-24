# Task 051 — Live status spine, real-time stream, trade-status pipeline (Phase 7, R-001/R-002/R-004/R-005)

> Owner directive 2026-09-12 (Phase 7 ⚡, 🔴): the platform must be MORE
> reliable when markets move fastest. This lane is the user-visible half:
> the platform says what state it is in, market data arrives as it
> changes, and a signed trade can never be lost or misreported. Ledger:
> `docs/tasks/live-sports-reliability.md`. Decision: **D-113**.
>
> Gates: server typecheck ✅, lint ✅, **785 pass / 0 fail** (765 → 785);
> client typecheck ✅, lint ✅, **163 pass / 0 fail** (135 → 163).

## Task description

Four things, each the smallest shape that makes the property true:

1. **A status surface (R-005).** `GET /api/status` computes the platform's
   degradation state from the inputs the enforcement points already use —
   per-league feed freshness (`events.last_polled_at`), games in play, the
   kill switch (deploy-time OR runtime flag), the provider breakers — and
   returns `mode` (live / degraded / paused), `reads`, `trading` (open /
   buys_halted / paused) and a banner-ready `message` that always says what
   is closed, what still works, and what happens next. The rules are the
   same code paths' rules: a league is `buysHalted` under exactly P-012's
   condition, `delayed` under exactly the slate route's. The client renders
   a global banner (paused / degraded / unreachable / offline) and disables
   the buy button during an operator pause.
2. **The feed actually stays fresh (R-005).** `/api/cron/live-sync` is the
   slice of the daily sync that stamps `last_polled_at` (slate + upsert,
   the bounded play-by-play rotation, the pool-price snapshot) — read-only
   for money, so the kill switch leaves it running. `.github/workflows/
live-sync.yml` fires it every 5 minutes. `IN_PLAY_FEED_MAX_AGE_MS` is
   15 minutes: two missed ticks with scheduler drift, an outage, not jitter.
3. **A live stream (R-001, R-002).** `GET /api/stream/live` is one SSE
   connection carrying the slate (scores, odds, live pool prices) and the
   status: snapshot on connect, then only what changed, every 5 s while a
   served league has a game in play (20 s otherwise), heartbeats every
   15 s, `id:` on every frame and `Last-Event-ID` honored, a deliberate
   `end` frame at 240 s (under the function's 300 s ceiling) so the client
   reconnects on purpose. Backpressure: at most 200 streams per instance;
   the next client gets 503 `STREAM_BUSY` + `Retry-After` and polls. Every
   stream on an instance shares one read per league per tick. The client
   keeps one connection per page (the board's two per-league hooks became
   one), reconnects with full-jitter backoff, falls back to the 60 s poll
   after four failures or an immediate 503, treats 45 s of silence as a
   drop, and disconnects hidden tabs.
4. **A trade-status pipeline (R-004).** The client phases are now
   `confirming{txHash}` → `done` / `failed` / `pending` — `pending` means
   the receipt wait (60 s) timed out and is NOT a failure; `failed` means
   the chain reverted it; `error{kind}` is reserved for things that never
   reached the chain, with a wallet rejection classified as benign ("you
   declined — nothing was sent"). The moment a hash exists the trade
   enters the pending register (localStorage, per wallet) and leaves only
   on a server-verified terminal state: `GET /api/markets/trade/status`
   reads the chain (confirmed / failed / pending / unknown, plus whether
   the fill is on record) and the register's resume loop re-reports a
   missing fill and surfaces the outcome — across reloads.

## Options weighed

| Option                                                       | Verdict                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebSocket for R-001                                          | Rejected for now. The API is one Express function on Vercel with no long-lived process to own a socket registry and no pub/sub bus; the client already speaks `text/event-stream`. The architecture doc's WebSocket grammar (subscribe by id, event_type frames, snapshot-then-deltas, heartbeat) is honored over SSE. |
| Server-side event bus for deltas                             | Rejected. There is no shared process; each stream ticks its own reads through a 2 s per-instance cache, which is the honest shape on serverless and costs one query per league per tick per instance regardless of client count.                                                                                       |
| Streaming positions/balances in this lane                    | Deferred to after R-007. `/api/markets/positions` is up to ~120 RPC reads per request; streaming it every few seconds before caching exists would be the outage.                                                                                                                                                       |
| Running live-sync from the stream (fetch provider on demand) | Rejected — reintroduces provider calls on page load (the 041 rule: providers feed ingestion only; Sportradar trial is 1 QPS).                                                                                                                                                                                          |
| Keeping `IN_PLAY_FEED_MAX_AGE_MS` at 10 min                  | Rejected. GitHub's minimum schedule is 5 min and it drifts; 10 min would halt buys on a single late tick. 15 min = two missed ticks.                                                                                                                                                                                   |

## Success criteria

- [x] `GET /api/status` is public, cached 5 s, always 200, and reports `mode`, `reads`, `trading`, `killSwitch`, per-league feed freshness, open breakers, and a banner message (R-005).
- [x] The status ladder is pure and unit-tested; buys-halted and delayed use the trade gate's and slate route's own thresholds (R-005).
- [x] The kill switch state is one shared reader for the gate and the status, so they never disagree within a window (R-005).
- [x] `/api/cron/live-sync` + `live-sync.yml` keep `last_polled_at` fresh at game cadence; `IN_PLAY_FEED_MAX_AGE_MS` = 15 min with the rationale in code (R-005).
- [x] The client shows a global banner while degraded / paused / unreachable / offline and nothing while live; the buy button reads "Trading paused" during an operator pause (R-005).
- [x] `GET /api/stream/live` implements the documented protocol; route tests pin snapshot, change-only deltas, status pushes, heartbeats, `end`, capacity shedding, and validation (R-001, R-002).
- [x] The client stream reconnects, honors `retry:`, falls back to polling, sheds hidden tabs; the SSE parser and the reconnect policy are pure and tested; the agent and analyst chat streams now share the parser (R-001).
- [x] The board holds one stream for all launch leagues (R-002).
- [x] `GET /api/markets/trade/status` maps receipt success / revert / known-unmined / never-seen to confirmed / failed / pending / unknown with `recorded` (R-004).
- [x] The ticket distinguishes confirming, pending (with explorer link, "you can leave this page"), done, failed (reverted — nothing traded), and pre-chain errors by kind (R-004).
- [x] The pending register persists per wallet, resumes on load, re-reports a missing fill, and surfaces earlier outcomes with a dismiss (R-004).
- [x] Positions and balances streamed — after R-007 (R-001). Signed-in streams, 2026-09-24.

## Failure conditions

- `assessPlatformStatus` and `assessMarketTradability` disagree on whether a league's buys are halted.
- A stream frame is emitted without an `id:`; a client reconnect replays a full snapshot it did not need (acceptable) or misses a change (not acceptable — the snapshot on reconnect covers it).
- A client with no stream shows a blank board (the poll runs whenever the stream is not open).
- A trade with a hash reaches `error` without the hash (only pre-chain failures may).
- The register removes a trade before the server verifies a terminal state.

## Edge cases

- **Off-season league.** A league not ingested for days is labeled delayed on its own card; the platform stays `live` unless every league is stale or a league with a game in play is stale.
- **Never-ingested league with a game in play.** Halted — absence of data is an outage, never fresh.
- **Two tabs.** Each holds its own stream; hidden ones disconnect. Register writes are last-writer-wins on one localStorage key; the resume loop is idempotent (fills are unique on tx hash server-side).
- **`unknown` hash.** Kept for 15 min (propagation lag), then dropped with a "never mined — nothing was traded" line.
- **Fill report fails after a confirmed receipt.** The ticket shows "Confirmed (Recording the fill…)"; the trade stays registered and the resume loop re-reports it.

## Implementation checklist

- [x] `server/src/lib/platform-status.ts` (+ test), `server/src/lib/sports/store.ts` `readLeagueFeedInputs`
- [x] `server/src/middleware/kill-switch.ts` `killSwitchEngaged()` (shared runtime flag)
- [x] `server/src/routes/platform-status.ts`, `server/src/routes/live-stream.ts` (+ test), `server/src/routes/cron-live-sync.ts`, `.github/workflows/live-sync.yml`
- [x] `server/src/routes/market-fills.ts` — `GET /api/markets/trade/status`, `fillExists` seam, `recorded` on the fill response (+ test)
- [x] `server/src/lib/sports/market-trade-build.ts` — `IN_PLAY_FEED_MAX_AGE_MS` 15 min
- [x] `client/src/lib/sse-core.ts`, `stream-policy-core.ts`, `live-stream.ts` (+ tests); `agent-stream.ts` / `analyze-stream.ts` on the shared parser
- [x] `client/src/features/status/` — `connection-status-core.ts` (+ test), `status-bus.ts`, `PlatformStatusProvider.tsx` (provider, hook, `StatusBanner`)
- [x] `client/src/features/markets/` — `trade-status-core.ts` (+ test), `PendingTradesProvider.tsx`, `use-market-trade.ts`, `use-slate.ts`, `LeaguePage.tsx`, `Board.tsx`
- [x] `client/src/components/shell/AppShell.tsx` banner slot; `client/src/main.tsx` providers

## Honest notes / follow-ups for other lanes

- The stream's cost model is per instance: N instances × (leagues × 1 read / tick). Lane 052's shared cache moves the per-league read behind Upstash so instances share it too.
- `/api/status` reports `rpc: null` until lane 052 wires the RPC client's breaker snapshot into `defaultPlatformStatusDeps`.
- The 5-minute GitHub schedule is best-effort. If the owner moves to Vercel Pro, `vercel.json` crons can take `*/2 * * * *` and `IN_PLAY_FEED_MAX_AGE_MS` can tighten again.
- React hooks and components remain untestable with the repo's runner (no DOM); every state machine in this lane is a `*-core.ts` with tests and the hooks are thin wiring, per the existing convention.
