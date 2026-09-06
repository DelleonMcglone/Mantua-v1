# 040 — Resolution integrity (S-022, S-024, S-025, S-026; S-023 verified)

**Status:** 🟢 code-complete · **Branch:** `040-resolution-integrity`

If a market resolves incorrectly because the provider missed an event, that
is a financial-market-integrity problem — on-chain resolution is permanent.
Phase B4 built the settlement pipeline with the right instincts (waiting is
the default, settling the exception); this task hardens it from "refuses
obviously bad data" to "proves, independently and durably, why every outcome
won".

## Gap analysis — what existed vs. each S-row

### S-023 — dual-source corroboration (verify, not build)

**Already there (DM-107 / B3-008).** `consensus.ts:corroborate` compares two
providers on team keys and derived winner: only `agreed` authorises
settlement; `disagreed` and `single-source` both hold. `planResolution`
enforces it whenever a secondary slate is supplied — including "a configured
secondary missing the game holds rather than silently falling back".
**Precisely what it gates:** only the resolve path, only when the cron passes
a secondary slate — and the cron passes `null` (vendor unchosen), so
production runs single-source; nothing recorded that fact anywhere. Task 040
does not change the corroboration logic; it makes the regime explicit
(`CorroborationPolicy`, stamped into every evidence bundle and review row)
and re-checks agreement a second time inside the criteria gate.

### S-024 — confidence state machine

**Before:** none. A held event was a transient `held[]` entry that evaporated
at the end of the sweep; a provider disagreement was logged and forgotten,
with no persisted record that an outcome was ever contested and no timeout on
"waiting for corroboration".
**After:** explicit states `PENDING_RECONCILIATION | VERIFIED | DISPUTED |
MANUAL_REVIEW | RESOLVED`, defined in ONE tested place
(`server/src/lib/sports/resolution-confidence.ts`, `LEGAL_TRANSITIONS` +
`nextConfidenceState`), persisted per (provider event, chain) in the new
`resolution_reviews` table (migration `0014`, append-only jsonb `history`).
One-way with escalation:

- corroborated final → `VERIFIED` → `RESOLVED` (on the landed tx, via a
  conditional SQL update so the table cannot skip the machine);
- sources disagree → `DISPUTED` → `MANUAL_REVIEW` — `DISPUTED` never
  auto-resolves: every further automated observation escalates, agreement
  included;
- single-source final under dual policy → `PENDING_RECONCILIATION` until
  corroboration arrives or `RECONCILIATION_TIMEOUT_SECONDS` (2h) escalates
  to `MANUAL_REVIEW`;
- single-source *policy* (no secondary configured) → `VERIFIED` via an
  explicit `policy_exempt_final` observation — recorded as an exemption,
  never faked as agreement;
- `MANUAL_REVIEW` and `RESOLVED` absorb everything automated; a verified
  outcome can still be disputed right up until the chain write lands.

`syncConfidenceReviews` (resolution-store.ts) advances rows from each pass's
`plan.assessments` (finals on FRESH slates only — delayed data moves
confidence in neither direction) and sweeps the timeout even on passes where
the feed is down. It runs in the cron's dry-run mode too, so disputes are
recorded even before a signer exists.

### S-025 — Mantua's own criteria gate

**Before:** `decideSettlement` refused delayed/unknown/score-less data, but
the decision to resolve was ultimately "the provider's status flag said
final"; `executeResolution` would submit whatever outcome the plan carried,
and `submitter.resolve(marketId, outcome)` was callable with loose values.
**After:** `assertResolutionCriteria`
(`server/src/lib/sports/resolution-criteria.ts`) re-derives every fact from
raw inputs and refuses unless ALL nine named criteria hold: `final_status`,
`feed_fresh` (S-022 breaker), `kickoff_elapsed` (kickoff passed + minimum
plausible game duration, 1h), `scores_consistent` (present, non-negative
integers, not tied — ties void, never resolve), `outcome_mapping` (the
market-local YES/NO re-derived independently from the scores and the
market's side — a tampered or bug-flipped outcome is caught here),
`corroborated` (or the recorded policy exemption), `confidence_verified`
(S-024 state ∈ {VERIFIED, RESOLVED}), `store_reconciled` (S-022 precheck),
`market_frozen` (freeze sweep completed first).

Structural hardening: passing mints a `ResolutionAuthorization` whose
constructor is module-private — `assertResolutionCriteria` is its only mint —
and `ResolutionSubmitter.resolve` now takes that authorization instead of
`(marketId, outcome)`. Both the live submitter (markets-onchain.ts) and every
test fake are type-forced through the gate; a rejection surfaces in the
sweep summary as `rejected[]` with every failed criterion, plus a loud
`logger.error` and a `market_resolution / rejected_other` audit row. Voids
remain exempt (B4-005: returning collateral cannot pick a wrong winner).

### S-022 — freshness/consistency monitoring

**Before:** the only staleness signal was the resilience layer's binary
`delayed` flag; no absolute age bound, no use of the ingest pipeline's own
`lastPolledAt` timestamps, no measurement surfaced anywhere.
**After** (`server/src/lib/sports/resolution-freshness.ts`):

- `feedLagMs` / `checkFeedFreshness` — lag measured against the slate's
  fetch timestamp; the stale-data circuit breaker refuses settlement when
  data is `delayed` OR older than `MAX_RESOLUTION_FEED_AGE_MS` (5 min). The
  cron demotes a non-fresh slate to `delayed` before planning (freezes still
  sweep — timestamp-driven, cannot be wrong; settlement holds), logs at
  error level, writes a `rejected_other` audit row, and reports
  `feed: {lagMs, fresh, reason}` per league in its response. The gate
  re-checks freshness a second time at submission, so a sweep that wedges
  between planning and executing still refuses.
- `reconcileWithStoredEvent` — the reconciliation precheck, wired into the
  criteria gate as `store_reconciled`: the ingest store's row for the event
  (loaded via `loadStoredEvents`) must not have gone dark
  (`lastPolledAt` within `STORE_POLL_MAX_AGE_MS`, 30 min) and a stored final
  must not contradict the live snapshot's winner.
- Alerting is loud structured logs + audit rows, per scope — no external
  alerting infra.

### S-026 — complete evidence persistence

**Before:** `resolutions.source_payload` stored `{providerEventId}` — the
payload column existed, the payload didn't. No per-source timestamps, no
verdict, no criteria record, no confidence trail.
**After:** every resolve persists a `resolution-evidence@1` bundle (built by
the gate, carried on the authorization, written into `source_payload`):

```
{ schema, providerEventId, marketId, marketOutcomeIndex, outcome,
  gameWinningOutcomeIndex, policy,
  sources: [ {role: primary|secondary|store, provider, retrievedAt,
              delayed, status, homeScore, awayScore, startsAt, home, away} ],
  consensus: <corroborate verdict> | {kind: "policy-exempt-single-source"},
  confidenceState, criteria: [{name, pass, detail} ×9], decidedAt }
```

plus the new `resolutions.confidence_state` column; the confidence *history*
(every transition with timestamp and reason) lives in
`resolution_reviews.history`. Voids persist a lighter source snapshot. The
S-026 test asserts a resolved row answers: which sources, what each said,
when each was retrieved, and which criteria passed.

## Schema / migration

- Migration `server/drizzle/migrations/0014_resolution_confidence.sql`
  (journal idx 13, tag `0014_resolution_confidence` — 0013/0015 belong to
  sibling branches): `resolution_reviews` table + `resolutions.confidence_state`,
  idempotent IF-NOT-EXISTS per the 0009 convention.
- Verified on scratch Postgres 16: full chain 0000→0014 applies via
  `drizzle-kit migrate`; re-running 0014 raw is a no-op. A DB-backed smoke
  exercised `syncConfidenceReviews` (insert, conditional update, jsonb
  history append, timeout `.returning()` sweep), `drizzleResolutionLog`
  (evidence + confidence write, VERIFIED→RESOLVED advance) and
  `loadStoredEvents` against that database.

## Tests

`resolution-confidence.test.ts` — exhaustive transition-table sweep (every
state × every observation checked against `LEGAL_TRANSITIONS`), the
one-way/escalation reachability proof (DISPUTED can never reach
VERIFIED/RESOLVED), legal paths, illegal moves, timeout, absorption, policy
mapping. `resolution-criteria.test.ts` — each criterion rejected
independently, multi-failure reporting, evidence completeness, freshness
breaker and reconciliation units. `resolution.test.ts` (extended) — executor
gate: DISPUTED blocks resolution even when today's slate agrees; the
stale-feed breaker trips at execution time; implausibly-early finals,
tampered outcomes, missing context, store contradictions all refuse with no
log row; `onRejected` audit hook; voids bypass; S-026 happy-path evidence on
recorded rows; assessment planning. All existing B4/B10 tests pass unchanged
in behaviour (signature updated: fakes take the authorization; executor
receives `nowSeconds`).

Gates: `npm run typecheck`, `npm run lint`, `npm test` (540/540 with CI stub
env), migration chain on scratch Postgres — all clean.

## Out of scope / notes

- The secondary provider stays unwired (DM-107 vendor unchosen); the moment
  one is passed to `planResolution`, policy flips to `dual-source` and the
  PENDING_RECONCILIATION / timeout path activates with no further change.
- Operator tooling for MANUAL_REVIEW rows (list/resolve UI) is not built
  here; the rows, indexes (`resolution_reviews_state_idx`) and audit trail
  they need are.
- Live-odds surfaces staleness via the existing `delayed` flag; the new lag
  numbers ride the cron response and logs (client surfaces untouched — out
  of this task's ownership).
