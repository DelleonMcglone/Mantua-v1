# Phase B3 — Sports Data Layer

> Master: `docs/tasks/sports-pivot.md` — PHASE B3 (W1–W3, 🔴 P0)
> Snapshot: 2026-09-03 · 8 ✅

## Success Criteria

- [ ] Feature code consumes the `SportsDataProvider` interface only — ESPN is an adapter behind it, never called directly (B3-001)
- [ ] The ESPN adapter covers the DM-105 leagues: scoreboard, event summary, team marks (B3-002, DM-105)
- [ ] Resilience stack: retry with jittered backoff, host fallback, cache (60s pre-game / 10s live), circuit breaker surfacing a "data delayed" state (B3-003)
- [ ] Provider events normalise to canonical `events` rows with provider-agnostic team IDs (B3-004)
- [ ] The ingest worker refreshes the slate, polls live scores, and captures finals (B3-005)
- [ ] A new scheduled game auto-creates its market set per DM-106 — moneyline at launch — and on-chain creation is idempotent per sync tick (B3-006, DM-106)
- [ ] A second-provider adapter exists behind a configurable vendor per DM-107 (B3-007)
- [ ] Providers disagreeing on a final flags manual review instead of auto-resolving (B3-008)

## Failure Conditions

- Feature code imports the ESPN adapter directly instead of going through the provider interface
- A provider outage degrades into a resolution instead of the "data delayed" state
- A home/away flip on a known event is applied instead of refused (B3-004)
- A sync tick creates duplicate on-chain markets (idempotency broken)
- Provider disagreement on a final is settled by picking a winner automatically
- The second provider's identity is hard-coded rather than vendor-configurable (B3-007)

## Edge Cases

- Risk 1: `site.api.espn.com` is undocumented with no SLA — the adapter interface (B3-001), the second provider (B3-007), and the resolver's manual override (B4-004) are the standing mitigations
- Scores ride the same slate poll; on-chain submission belongs to B4's resolution service, not the ingest worker (B3-005)
- Stale cache serves flagged `delayed`, never as fresh (B3-003)
- A tie game maps to the void path downstream — both markets void — not to a winner (B3-008, B4-005)
- On-chain market creation needs `MARKET_SIGNER_PRIVATE_KEY`; its absence fails the tick loudly (B3-006)

## Checklist

- [x] B3-001 — `SportsDataProvider` interface: ESPN is an adapter behind it, not called directly by feature code
- [x] B3-002 — ESPN adapter for the DM-105 league(s): scoreboard, event summary, team marks
- [x] B3-003 — Resilience: retry with backoff, host fallback, cache (60s pre-game / 10s live), circuit breaker with "data delayed" state
- [x] B3-004 — Normalise provider event → canonical `events` row; provider-agnostic team IDs
- [x] B3-005 — Ingest worker: slate refresh, live score polling, final capture
- [x] B3-006 — Market generator: new scheduled game auto-creates its market set per DM-106
- [x] B3-007 — Second-provider adapter per DM-107, vendor configurable
- [x] B3-008 — Disagreement detection: providers disagreeing on a final flags manual review instead of auto-resolving
