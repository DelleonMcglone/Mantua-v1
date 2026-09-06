# 044 — Resolution engine (D-104: P-005 / P-010)

**Status:** ✅ done 2026-09-06
**Branch:** `044-resolution-engine`

D-104 closed the resolution-engine decision; this task ships its four server
clauses. The S-022…S-026 machinery from task 040 stays the only path to an
automated on-chain resolution — 044 adds the routing fix, the mandatory
dispute window, the audited manual-override path, and the P-010 ops
verifiability surface. No client files, no contracts, no other lanes' files
touched.

## D-104 clause → what shipped

### 1. "No direct provider instantiation" — the ESPN bypass fix

`cron-resolution.ts` instantiated `new EspnProvider()` and settled finals
off the D-102 prototyping-only fallback even where Sportradar was
configured — and off a DIFFERENT provider than the ingest store the S-022
`store_reconciled` precheck compares against (`loadStoredEvents` filters by
`slate.provider`, and the ingest cron already routed through
`providerFor`). Settlement now routes through the same canonical selection
as every other consumer:

- `resolutionProviderFor(league)` (exported from `cron-resolution.ts` so
  tests pin the routing) delegates to `providerFor(league)` — Sportradar
  where configured AND covering the league, ESPN only as the configured
  fallback.
- The primary/secondary disagreement-detection contract is unchanged:
  `planResolution(primary, secondary, …)` still receives `null` as the
  secondary (DM-107's corroboration vendor remains unchosen), so the
  single-source policy exemption keeps being recorded explicitly. Nothing
  silently promotes ESPN to "secondary".
- The `?dates=` backfill window is an ESPN-adapter capability
  (`EspnProvider.getSlate(league, dates?)`) the `SportsDataProvider`
  interface does not carry. `resolutionSlateFor` passes it structurally
  (adapters that don't take it ignore it) and logs a loud warning when a
  backfill is requested against a non-ESPN league instead of pretending it
  happened.

Tests: `routes/cron-resolution-provider.test.ts` (key configured → NFL is
sportradar, WNBA is the espn fallback) and
`cron-resolution-provider-fallback.test.ts` (no key → espn everywhere).
Each runs in its own process so the env-module cache sees its world.

### 2. Dispute window

`RESOLUTION_DISPUTE_WINDOW_SECONDS` (env.ts, zod, int ≥ 0, **default
900**). `resolutionDisputeWindowIssues` is the circleCredentialIssues-style
startup check: a zero window warns in dev and fails the production boot via
the shared `loadEnv` issues machinery.

**Semantics as shipped** (executor: `executeResolution`, port:
`DisputeWindowGate`; persistence: `resolution_reviews` — the game's pending
row, shared by both markets of the pair):

- The window opens on the **first pass a resolve submission clears the full
  S-025 criteria gate** — after `assertResolutionCriteria` passes, before
  any submit. `dispute_window_opens_at` / `_closes_at` are stamped on the
  review row (guarded `WHERE opens_at IS NULL`, so a concurrent pass cannot
  shorten an open window). That pass submits nothing and writes no
  resolutions ink — only the audit row.
- A later pass submits **only if** the window has elapsed AND the outcome
  still clears the gate (which re-checks freshness, scores, confidence —
  so "still VERIFIED" is enforced by the same nine criteria, this pass) AND
  no operator hold is set.
- An **operator hold** (§3) parks the outcome indefinitely, elapsed or not.
- A **DISPUTED** escalation cancels the window: `syncConfidenceReviews`
  nulls both window columns on the DISPUTED transition. DISPUTED never
  auto-relaxes (S-024), so "re-opens after re-verification" means: once a
  human resolves the dispute and the outcome verifies again, the next pass
  opens a fresh window rather than inheriting one that ran down while the
  outcome was contested.
- **Voids are window-exempt** (B4-005: returning collateral cannot pick a
  wrong winner) — a cancelled game's markets void immediately.
- A **zero window** opens-and-submits in the same pass (the open is still
  recorded), so dev/test loops don't need two sweeps.
- Freezes are untouched: the game is already final when the gate passes
  (D-103 freeze-on-final), and the idempotent in-line freeze sweep still
  runs before the window check. **No kickoff-time assumptions were added.**
- The landed resolve stamps the window it waited out onto the
  `resolutions` row (`dispute_window_opens_at/_closes_at`), per D-104's
  "recorded on the resolutions row".

**Audit rows** (`market_resolution`): window open (`pending`), operator
hold blocking a pass (`rejected_other`, with the hold note), and
elapsed-submit (`pending`, immediately before the submit; the resolutions
row is the success record). `awaiting` passes are counted in the sweep
summary (`windowsOpened` / `awaitingWindow` / `heldByOperator`) but write
no ink.

### 3. Manual override + operator hold (`server/src/routes/resolution-ops.ts`)

New internal router, mounted in `app.ts`, authenticated with
`requireCronSecret` — the exact posture of every cron/admin internal route
(Bearer `CRON_SECRET`; 503 when unset). Dependency-injected
(`createResolutionOpsRouter`) so tests fake the store/submitter/log seams.

- `POST /api/ops/resolution/hold` / `release` — mandatory `note`
  (zod-trimmed, non-empty), per-event + chain. Hold sets
  `operator_hold_at/_note` on the review row (404 when no review exists);
  release distinguishes "no row" (404) from "no hold" (409). Both write a
  success audit row carrying the note.
- `POST /api/ops/resolution/override` — `{marketId, action: resolve|void,
  outcome? (required for resolve), note}`. Refuses: no signer (503
  `RESOLUTION_DISABLED`), unknown market (404), market not OPEN/FROZEN
  (409 `MARKET_NOT_RESOLVABLE` — RESOLVED/SETTLED/INVALID would
  double-resolve). Executes through the SAME submitter machinery as the
  sweep — `liveResolutionSubmitter` (the address-routed Resolver signer),
  in-line idempotent freeze first, then resolve/void — and records through
  `drizzleResolutionLog`: method **`manual`**, the note, the tx hash, and a
  `manual-override` evidence bundle. A manual resolve also advances the
  game's review to RESOLVED (`markManuallyResolved` — the human act the
  absorbing DISPUTED/MANUAL_REVIEW states wait for, history-appended); a
  manual void stays confidence-exempt like the automated pipeline. Success
  and failure both audit (`success` with txHash / `failure` with the
  revert, no resolutions ink without a landed tx).

**`methodFor` extended honestly:** `manual` for any operator override
(resolve or void — the deliberate human act is the fact worth indexing),
`void` for automated voids, `auto` otherwise.

**The S-025 mint invariant, restated:** `ResolutionAuthorization` now has
exactly TWO mints, both in `resolution-criteria.ts`:
`assertResolutionCriteria` (evidence = the full nine-criteria bundle) and
`authorizeManualOverride` (D-104's audited exception — throws on an empty
note, mints with `criteria: []` and an evidence bundle that says plainly
nothing was checked). The class is generic over the evidence type so each
caller sees the exact bundle it was given; `submitter.resolve` still
accepts no loose `(marketId, outcome)` anywhere.

### 4. Ops verifiability surface (P-010)

`GET /api/ops/resolution` (same auth): every settlement row — txHash,
signer, method, confidence state, note, dispute-window stamps, a BaseScan
link built from `basescan.ts`'s `BASESCAN_WEB`, and a compact
`sourcePayloadSummary` (schema/kind, policy, consensus kind, criteria
passed/total) — plus the pending review queue (state, policy, window,
operator hold, timestamps) and the configured window seconds. Internal ops
only; the public UI stays chainless (the MarketDetail explorer-link removal
is another lane's job and was not touched).

## Migration

**Yes — `0016_resolution_dispute_window.sql`** (the reserved 0016 lane;
hand-written idempotent SQL + `meta/_journal.json` append, per house
convention — drizzle-kit generate is unusable in this repo):

- `resolution_reviews`: `dispute_window_opens_at`, `dispute_window_closes_at`,
  `operator_hold_at` (timestamptz), `operator_hold_note` (text);
- `resolutions`: `dispute_window_opens_at`, `dispute_window_closes_at`.

Verified on a scratch Postgres 16 via psql: full 0000→0016 chain applied
clean, 0016 re-applied idempotently (IF NOT EXISTS notices, no errors),
columns present with the right types. The real drizzle-backed store was
then smoked against that database: guarded window open (re-open cannot
shorten), hold/release (`ok`/`not_found`/`no_hold`), pending listing, and
`markManuallyResolved` history append all exercised the real SQL.

## Seams stubbed in tests (+28 tests; suite 675 → 703, only added)

- `resolution-dispute-window.test.ts` (8): `executeResolution` with the
  `DisputeWindowGate` port faked in-memory (mirroring the drizzle gate's
  contract) — open-no-ink, awaiting, hold-parks-elapsed,
  elapsed-submit-with-window-on-record, DISPUTED-refused-at-gate (window
  never consulted), zero-window same-pass, void exemption, legacy no-gate
  contract. Submitter/log are the existing resolution.test fakes.
- `resolution-ops.test.ts` (15): real router on an ephemeral express app
  (market-trade.test convention), real `requireCronSecret` with a stubbed
  `CRON_SECRET`; store/submitter/log faked at the factory seams; audit rows
  captured by stubbing `db.insert` (agent-chat.test convention). Covers
  auth, mandatory-note 400s, 404/409 refusals, the full manual resolve and
  void journeys, submit-failure (502, failure audit, no record ink), the
  GET surface shape (BaseScan link, window stamps, payload summary, hold),
  the `authorizeManualOverride` mint (empty-note throw, honest evidence),
  and `summarizeSourcePayload`.
- `cron-resolution-provider(.fallback).test.ts` (3): provider routing per
  clause 1, one process per env world.
- `env-dispute-window.test.ts` (2): the 900 default and the zero-window
  startup issue.

Real code under test throughout: `planResolution`,
`assertResolutionCriteria` (both mints), `executeResolution` including the
window branch, the router bodies, `requireCronSecret`, `providerFor`.

## Doc-vs-code differences (code wins, recorded honestly)

- **D-104 says** "the window's open/close timestamps are recorded on the
  `resolutions` row" — but a resolutions row exists only after a tx hash
  (B4-006: "no state in which the log claims something the chain has not
  done"). The window therefore LIVES on the game's `resolution_reviews`
  row (the pending row; both pair markets share one game outcome) and is
  additionally stamped onto the resolutions row when the resolve lands.
- **"Re-opens after re-verification"** (dispute cancelling the window):
  the shipped S-024 machine has no automated DISPUTED→VERIFIED edge —
  DISPUTED only escalates to MANUAL_REVIEW. Cancellation nulls the window
  columns so that whenever a human re-verifies, the next pass opens a
  fresh window; no automated re-verification path was invented.
- **"Window opens when the ResolutionAuthorization is minted"**: exact —
  the gate branch runs immediately after `assertResolutionCriteria`
  returns `ok`. The minted authorization of the opening pass is discarded
  (nothing may submit it); the elapsing pass re-mints through the same
  gate, which is strictly stronger than caching the old authorization.
- **`?dates=` backfill** remains ESPN-only (the interface has no dates
  parameter); requesting it for a Sportradar-served league warns and
  sweeps the current slate instead — surfaced, not silent.
- **P-010's "remove the public MarketDetail explorer link"** is a client
  change owned by another lane; this task shipped only the internal
  surface half of P-010.

## Gates

- `npm run typecheck --workspace server` ✅
- `npm run lint --workspace server` ✅ (`--max-warnings 0`)
- Stub-env server suite: **703 pass / 0 fail** (675 on main; only added)
- Migration chain verified on scratch Postgres 16 incl. idempotent
  re-apply (above)
