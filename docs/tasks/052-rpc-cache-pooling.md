# Task 052 — Dedicated RPC, shared cache, pool sizing (Phase 7, R-006/R-007/R-002)

> Owner directive 2026-09-12 (Phase 7 ⚡, 🔴). The infrastructure half of
> "more reliable when markets move fastest": no public rate-limited RPC in
> production, one shared cache in front of the live-game hot reads, and a
> Postgres pool sized for a serverless fan-out. Ledger:
> `docs/tasks/live-sports-reliability.md`. Decision: **D-113** (transport
> and status); the RPC posture is the inherited lesson made a boot rule.
>
> Gates: server typecheck ✅, lint ✅, **802 pass / 0 fail** (785 → 802).

## Task description

1. **No public RPC in production (R-006).** The lesson lives in three
   places — `server/src/lib/rpc-client.ts`'s original header ("public RPC
   hosts rate-limit once the app's polling + quoting traffic concentrates
   on one"), task 045 §"Flakiness caveat" (`mainnet.base.org` returns
   Cloudflare 502s under fan-out), and `contracts.yml`'s retry wrapper —
   and the production default was still `https://mainnet.base.org`. Now:
   - `rpcProviderIssues` (pure, `lib/rpc-config.ts`) runs in `env.ts`'s
     boot-issues machinery: a public primary, a public host in
     `BASE_RPC_FALLBACK_URLS`, or `BASE_RPC_PUBLIC_FALLBACK=1` in production
     **fails the production boot** with the fix in the message (warns
     elsewhere — the dev default keeps working).
   - `resolveRpcUrls` (pure) builds the one ordered list: primary, then the
     dedicated fallbacks, then the public backstop only where allowed
     (unset → on outside production, off in production). The viem client
     and the wallet-side proxy (`routes/rpc-proxy.ts`) both read
     `RPC_UPSTREAMS`; the two lists can no longer diverge.
   - Every response is scored per host through viem's `fallback`
     `onResponse` hook (and the proxy reports through `recordRpcOutcome`);
     `rpcHealthSnapshot()` reports hostname-only health (`healthy`,
     `onFallback`, consecutive failures, last error) and feeds `/api/status`'s
     RPC rung — "Blockchain reads are degraded" is now a real signal, not
     `null`.
   - `http()` transports carry an 8 s timeout so a sick host yields to the
     next instead of holding a request to viem's 10 s default.
2. **A shared cache for the hot reads (R-007).** `lib/shared-cache.ts` is
   two tiers: a bounded per-instance L1 with in-flight dedup, and the same
   Upstash Redis the rate limiters use (C-021) as L2 — so N instances
   compute one value per window, not N. It never fails a read (Redis
   errors fall through to compute), rejects L2 values older than the
   caller's TTL, and keeps only an L2 value's remaining life in L1 so the
   tiers expire together. Applied to:
   - `withLiveOdds` — the board's RPC amplifier (3 reads per event), keyed
     on the ingest time so a fresh ingest invalidates it (15 s);
   - the canonical slate read behind `/api/sports/slate` (5 s; the stream's
     own 2 s L1 sits in front for connected clients);
   - `/api/markets/pools` (15 s) and `getMarketMetrics` (15 s, was a
     per-instance `TtlCache`);
   - `/api/markets/positions` per wallet (10 s) — the worst per-request RPC
     amplifier (~3 reads per market row) — **invalidated by a verified fill
     for that wallet** (`market-fills.ts`), so the number moves the moment
     the trade lands; response is `private, no-store`.
3. **Pool sizing and region (R-002).** `db/client.ts` configures `pg.Pool`
   from env: `DATABASE_POOL_MAX` (default 5 per instance — the ceiling is
   this × live instances against Neon's pooler), `DATABASE_CONNECT_TIMEOUT_MS`
   (5 s wait for a slot), `DATABASE_QUERY_TIMEOUT_MS` (15 s per statement —
   a runaway query fails, never holds a lambda to its 300 s ceiling), a
   10 s idle release, `application_name`, and a handled `error` event so a
   pooler recycle is a log line, not a crashed instance. `dbPoolSnapshot()`
   exposes the counters for lane 053. `vercel.json` pins `regions: ["iad1"]`
   — the region the runbook already tells the operator to put Upstash in,
   and where Neon's US-East pooler lives — so the three sit in one
   datacenter and the latency budget (053) is measured against a known
   topology.

## Options weighed

| Option                                                | Verdict                                                                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep a public backstop in production for availability | Rejected. Under the load that degrades a dedicated endpoint, a public host adds 10 s timeouts, not answers (045's 502s). A second dedicated endpoint in `BASE_RPC_FALLBACK_URLS` is the availability answer. |
| Warn (not fail) on a public primary in production     | Rejected. A warning in a log nobody reads is how the default survived to Phase 7. The boot failure names the exact variable and fix.                                                                         |
| Vercel Runtime Cache instead of Upstash               | Deferred. Upstash is already provisioned and shared by the limiters and the kill switch; one dependency, one runbook section. Revisit if L2 latency shows up in 053's numbers.                               |
| Cross-instance stampede lock (SET NX)                 | Not now. The per-instance in-flight dedup covers the common burst; a handful of instances computing once each per window is acceptable at these TTLs.                                                        |
| Caching `/api/markets/trade/quote`                    | Rejected. A quote is a price the user commits against; 5 serial RPC hops per re-quote is the honest cost, and slot0 already has a per-instance cache. The load test (054) will say whether it needs more.    |

## Success criteria

- [x] Production boot fails on a public `BASE_RPC_URL`, a public fallback entry, or `BASE_RPC_PUBLIC_FALLBACK=1`; the message names the fix (R-006).
- [x] `resolveRpcUrls` is pure and tested; the viem client and the proxy share `RPC_UPSTREAMS` (R-006).
- [x] Per-host health is scored on every response and surfaces in `/api/status.rpc` (R-005/R-006).
- [x] `SharedCache` is tested for L1 burst collapse, cross-instance L2 hits, tier co-expiry, dead-Redis fall-through, garbage tolerance, and invalidation (R-007).
- [x] Live odds, the slate read, pools, metrics and per-wallet positions read through the shared cache; a verified fill invalidates the wallet's positions (R-007).
- [x] `pg.Pool` has a per-instance max, connect and query timeouts, and an error handler; `regions` is pinned (R-002).
- [ ] A dedicated provider key is set in production — **owner-gated** (TD-007).

## Failure conditions

- A production deploy boots with `mainnet.base.org` as the primary.
- Two instances serving the same league compute the live-odds overlay for the same ingest.
- A verified fill lands and the wallet's positions read returns the pre-trade balance for a full window.
- A Redis outage makes any cached route return an error.

## Edge cases

- **Upstash unconfigured** (dev, CI): L2 is absent; behavior equals the pre-lane per-instance caches. `snapshot().l2` says which.
- **Upstash auto-parses JSON on `get`**: the cache accepts both the raw string and a pre-parsed object.
- **A public host as a subdomain** (`rpc.base.drpc.org`) is recognized as public.
- **`BASE_RPC_FALLBACK_URLS` repeating the primary** collapses to one entry.

## Implementation checklist

- [x] `server/src/lib/rpc-config.ts` (+ test) — pure: public hosts, `resolveRpcUrls`, `rpcProviderIssues`, `RpcHealthRegistry`
- [x] `server/src/lib/rpc-client.ts` — `RPC_UPSTREAMS`, per-host scoring, `rpcHealthSnapshot`, `recordRpcOutcome`, 8 s timeout
- [x] `server/src/env.ts` — `BASE_RPC_FALLBACK_URLS`, `BASE_RPC_PUBLIC_FALLBACK`, `DATABASE_POOL_MAX`, `DATABASE_CONNECT_TIMEOUT_MS`, `DATABASE_QUERY_TIMEOUT_MS`; `rpcProviderIssues` in the boot issues
- [x] `server/src/routes/rpc-proxy.ts` — shared upstream list + health scoring
- [x] `server/src/lib/shared-cache.ts` (+ test); applied in `live-odds.ts`, `sports-slate.ts`, `market-pools.ts`, `market-metrics.ts`, `market-positions.ts` (+ invalidation seam in `market-fills.ts`)
- [x] `server/src/db/client.ts` — pool config, error handler, `dbPoolSnapshot`
- [x] `server/src/routes/platform-status.ts` — RPC health wired
- [x] `vercel.json` `regions`; `server/.env.example` documents the new variables

## Honest notes / follow-ups

- The production boot rule will fail the **current** production deploy until `BASE_RPC_URL` is set to a dedicated endpoint. That is the directive ("no public rate-limited endpoints in production"); the failure is loud and the message says exactly what to set. TD-007 tracks the provisioning.
- The cache's L2 hit rate is only observable through `sharedCache.snapshot()`; lane 053's metrics read exposes it.
- `readSlot0` keeps its per-instance `TtlCache`: it is on the trade-build path where a stale price is worse than an extra read.
