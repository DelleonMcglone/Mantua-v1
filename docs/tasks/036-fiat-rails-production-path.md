# 036 — Fiat rails production path (F-002/F-003/F-004/F-006/F-009)

**Status:** 🟢 code-complete / mock- and sandbox-tested — awaiting commercial credentials
**Branch:** `036-fiat-rails-production-path`

Production-path code for the Phase 2 fiat rails (D-101: Zero Hash is the
regulated counterparty for USD↔USDC + KYC/AML; Plaid links the bank). The
sandbox stub's honesty gap — "live provider records and webhook idempotency
must be persisted before FIAT_RAILS_MODE=live" — is closed. What remains is
strictly commercial/operator work (Plaid dashboard keys; Zero Hash platform
agreement).

## What's built

### F-006 — durable transfers + one-way state machine

- New tables (`server/src/db/schema/fiat.ts`, migration
  `0011_fiat_transfers.sql`, idempotent IF-NOT-EXISTS per the 0009
  convention):
  - `fiat_bank_links` — provider references only (Plaid item id, Zero Hash
    participant code / external-account id) + display-safe metadata
    (institution name, last-4 mask). **Never** account/routing numbers or
    Plaid access tokens — the D-101 boundary.
  - `fiat_transfers` — the durable deposit/withdraw ledger for BOTH modes.
    Sandbox transfers persist here too; the process-local Map is gone.
  - `fiat_webhook_events` — raw webhook deliveries, unique on
    (provider, event id) → redelivery is a storage-level no-op.
- State machine in `server/src/lib/fiat-transfers.ts` — the SINGLE source of
  truth (`FIAT_TRANSFER_PRIOR_STATUSES`): `pending → processing →
complete`, with `failed`/`canceled` reachable from pending/processing and
  all three terminal states absorbing. Both stores (Postgres
  `dbFiatStore`, in-memory test store in `server/src/lib/fiat-store.ts`)
  derive their guards from that one map; the Postgres transition is a
  conditional UPDATE so poll/webhook races settle at the row level.
  `applyFiatTransition` (lib/fiat-rails.ts) is the one seam through which a
  status changes, and it writes the `fiat_transfer` audit row (new
  `AuditAction` member) on every applied change.
- Sandbox pendings auto-complete via a lazy tick on the next state read
  (`completeStaleSandboxPendings`, ~1.2 s), preserving the stub's UX.

### F-002 — real Plaid integration

- `plaid` SDK exact-pinned (`47.0.0`) in `@mantua/server`;
  `react-plaid-link` exact-pinned (`5.0.0`) in `@mantua/client`.
- Server (`server/src/lib/plaid-fiat.ts`):
  - `POST /api/fiat/link-token` — mints a Link token for the authed user
    (opaque `client_user_id`, product `auth`).
  - `POST /api/fiat/exchange` — receives Link's short-lived public token,
    exchanges it server-side, and mints the Zero Hash processor token via
    `/processor/token/create` (SDK enum `zero_hash`;
    `ZERO_HASH_PLAID_PROCESSOR_ID` overrides if onboarding issues a
    platform-specific id). **The Plaid access token exists only as a local
    variable inside `exchangePublicToken`** — used for `accountsGet` +
    `processorTokenCreate`, then dropped; never returned, persisted, or
    logged. The D-101 boundary is documented in code at that exact spot.
  - Both routes 503 gracefully (`FIAT_RAILS_UNAVAILABLE`) when
    `PLAID_CLIENT_ID`/`PLAID_SECRET` are absent, Circle-style.
- Client: `FiatRailsTab` runs real Plaid Link when the server reports
  `plaidReady`, and falls back to the deterministic sandbox bank-link button
  otherwise — same button, same product words.
- Note: because the access token is deliberately not persisted, the item
  cannot be re-accessed later (e.g. `itemRemove`, balance refresh). That is
  the strictest reading of D-101; if Balance/Identity products later require
  a stored token, that needs its own decision (encrypted KMS storage), not a
  quiet code change.

### F-003/F-004 — Zero Hash adapter + orchestration

- `server/src/lib/zerohash.ts` — typed client with HMAC request signing
  implemented from Zero Hash's public docs (fetched 2026-09-05):
  - https://docs.zerohash.com/docs/authentication and the code recipe at
    https://docs.zerohash.com/recipes/rest-api-authentication-1 —
    headers `X-SCX-API-KEY/-SIGNED/-TIMESTAMP/-PASSPHRASE`; signature
    `Base64(HMAC-SHA256(b64decode(secret), timestamp+METHOD+path+body))`;
    compact-JSON body, literal `{}` for GET; cert host
    `api.cert.zerohash.com`, production `api.zerohash.com`.
  - Endpoint wrappers (participants, external accounts from processor
    tokens, ACH/RTP payments, `/fund/rfq` conversion, USDC withdrawal
    requests) follow the public reference pages cited in the module; exact
    field lists get confirmed against the versioned reference once the
    platform agreement grants API access — they're typed as loose envelopes
    for that reason.
- Orchestration (`server/src/lib/fiat-rails.ts`): deposit = ensure
  participant → external account (created at bank-link time) → ACH debit →
  USD→USDC conversion → USDC delivered to the **user's own wallet address**
  (never the agent wallet); withdraw = reverse. Every provider call carries
  the row's idempotency key; every state change goes through
  `applyFiatTransition` (row + audit).
- **D-112 (chain-agnostic):** the destination network is
  `FIAT_USDC_NETWORK` config (default `BASE`; Zero Hash asset
  `USDC.<network>`), never code. Whether Zero Hash can deliver USDC on Arc
  is an OPEN question for the D-112 decision window — noted, not resolved.

### Webhooks

- `POST /api/fiat/webhook` (`server/src/routes/fiat-webhook.ts`), mounted
  before `express.json()` so the HMAC verifies over raw bytes.
  Verify-then-process per Zero Hash's documented scheme
  (https://docs.zerohash.com/reference/webhook-security):
  `x-zh-hook-signature` = hex HMAC-SHA256(body+timestamp), ±5-minute replay
  window. No `ZERO_HASH_WEBHOOK_SECRET` → 503 (fail closed); unsigned/bad → 401. (Zero Hash also offers an RSA variant — adopt if onboarding
  provisions an RSA key instead.)
- Idempotent by provider event id (unique (provider, event_id)); events map
  to state-machine transitions in `server/src/lib/fiat-webhook.ts`
  (settled/posted → complete; returned → failed+retry; rejected/failed →
  failed+contact_support; canceled → canceled). Out-of-order/late events are
  absorbed by the one-way machine (verified live: a `returned` event after
  `complete` acks with `applied:false` and the row stays `complete`).
- Plaid webhooks: not required for the processor-token flow (no long-lived
  item is kept). If Identity/Balance later need item webhooks, add a sibling
  route with Plaid's JWT verification.

### F-009 — E2E

- Sandbox UI flow (connect → deposit → complete → withdraw) still works
  end-to-end, now durably: lib-level flow covered by
  `fiat-rails.test.ts` against the in-memory store, and the full HTTP
  webhook path was smoke-verified against a live server + scratch Postgres
  (401 unauth, 401 unsigned, 200 applied, 200 deduped redelivery, one-way
  guard on late events, audit rows written).
- `npm run fiat:e2e -w @mantua/server`
  (`server/src/scripts/fiat-e2e.ts`) — credential-gated like
  `circle:e2e`: SKIPs cleanly (exit 0) without creds; with Plaid sandbox
  keys it runs sandbox link (ins_109508) → exchange → processor token; with
  Zero Hash cert creds it continues participant → external account → cert
  ACH debit → poll to terminal; with a real DATABASE_URL it verifies the
  `fiat_transfers` + `fiat_transfer` audit rows.

### F-005 hardening — chainless copy

All user-facing fiat copy says "Deposit dollars"/"Withdraw dollars" with
pending/processing/complete/needs-attention/canceled states; the activity
list keeps its B-016 `aria-live="polite"` region and `role="status"`/
`role="alert"` markers. Chainlessness is enforced by tests on both sides
(`fiat-transfers.test.ts` server, `fiat-status.test.ts` client): no
wallet/bridge/gas/chain/network words in any fiat message.

### Spending-cap reasoning (deliberate non-change)

The P1-001 spending cap is untouched: fiat **deposits are inflows** (they
add to the user's balance), and **withdrawals move the user's own fiat
balance** back to their own linked bank — neither is an agent spend from a
capped wallet. The Circle agent wallet is never a fiat destination and
cannot initiate a user withdrawal (D-101).

## Environment variables

| Variable                                                          | Required for | Notes                                                                                |
| ----------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `FIAT_RAILS_MODE`                                                 | all          | `disabled` (default, prod-safe) / `sandbox` / `live` (fails closed without ZH creds) |
| `PLAID_CLIENT_ID` / `PLAID_SECRET`                                | F-002        | absent → link-token/exchange routes 503; sandbox button still works                  |
| `PLAID_ENV`                                                       | F-002        | `sandbox` (default) / `development` / `production`                                   |
| `ZERO_HASH_API_KEY` / `ZERO_HASH_SECRET` / `ZERO_HASH_PASSPHRASE` | F-003/4      | issued after the platform agreement; secret is the base64 HMAC key                   |
| `ZERO_HASH_PLATFORM_CODE`                                         | F-003/4      | platform participant code from onboarding                                            |
| `ZERO_HASH_ENV`                                                   | F-003/4      | `sandbox` → cert host (default); `production`                                        |
| `ZERO_HASH_PLAID_PROCESSOR_ID`                                    | F-002        | optional override; SDK default is the `zero_hash` processor enum                     |
| `ZERO_HASH_WEBHOOK_SECRET`                                        | webhooks     | absent → `/api/fiat/webhook` 503s (fail closed)                                      |
| `FIAT_USDC_NETWORK`                                               | D-112        | destination network for delivered USDC, default `BASE` — config, not code            |

## Exactly what remains (operator/commercial)

1. **Zero Hash platform agreement** (F-001 — stays 🟡): execute the
   commercial agreement, complete platform onboarding, obtain
   cert (sandbox) then production API credentials + platform code +
   webhook secret, and confirm **Base-USDC (and, per D-112, Arc-USDC)
   delivery support**. Then: fill the `ZERO_HASH_*` vars and run
   `npm run fiat:e2e -w @mantua/server` against cert.
2. **Plaid keys**: create/confirm the Plaid team, enable the **Zero Hash
   integration** (Dashboard → Integrations) and the Auth/Balance/Identity/
   Identity Match products, copy sandbox keys (Dashboard → Team Settings →
   Keys) into `PLAID_CLIENT_ID`/`PLAID_SECRET`; production keys need
   Plaid's production request process.
3. **Webhook registration**: point Zero Hash notifications at
   `https://<host>/api/fiat/webhook` during onboarding; record the HMAC
   secret as `ZERO_HASH_WEBHOOK_SECRET` (or switch the verifier to their
   RSA variant if that's what they provision).
4. Verify the endpoint field names against the versioned Zero Hash
   reference once API access exists (the wrappers isolate every provider
   call in `lib/zerohash.ts`, so any renames are one-file fixes), then flip
   `FIAT_RAILS_MODE=live`.

## Per-F-row status

| Row                                  | Status                                                                               | What flips it fully ✅                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| F-001 provider agreement             | 🟡 operator                                                                          | Zero Hash platform agreement executed + credentials issued                 |
| F-002 Plaid bank link                | 🟢 code-complete, mock-tested (real Link flow, server-side exchange, D-101 boundary) | Plaid dashboard keys + ZH integration enabled → `fiat:e2e` Plaid leg green |
| F-003 Zero Hash adapter              | 🟢 code-complete, mock-tested (documented HMAC signing verified by fixed vectors)    | cert credentials → field names confirmed against the versioned reference   |
| F-004 orchestration + webhooks       | 🟢 code-complete; webhook path live-verified against scratch Postgres                | cert webhook deliveries observed end-to-end                                |
| F-006 durable ledger + state machine | ✅ (tables migrated + verified on scratch Postgres; one-way machine tested)          | —                                                                          |
| F-009 E2E                            | 🟢 sandbox-ready (`fiat:e2e` gated, SKIPs cleanly)                                   | run with Plaid sandbox + ZH cert creds                                     |

## Verification record (2026-09-05)

- `npm run typecheck`, `npm run lint` (repo-wide, --max-warnings 0): green.
- `npm test -w @mantua/server` with CI stub env: 432 pass / 0 fail.
- `npm test -w @mantua/client`: 120 pass / 0 fail.
- Migration chain 0000→0011 applied to a scratch Postgres 16 with psql,
  `ON_ERROR_STOP=1`; 0011 re-applied cleanly (idempotent).
- Live-server webhook smoke (scratch DB): 401 unauth state read, 401
  unsigned webhook, 200 `applied:true` signed settle, 200 `deduped:true`
  redelivery, `applied:false` on a late regression event, `fiat_transfer`
  audit row present.
- `npm run fiat:e2e -w @mantua/server` without creds: SKIPPED, exit 0.

## Known repo quirk (pre-existing, not touched)

`0010_circle_executions_webhook_events.sql` exists on disk but was never
added to `meta/_journal.json`, so `drizzle-kit migrate` skips it (the psql
chain above applies it fine). This task appends only its own `0011` journal
entry; back-filling 0010's entry needs care on databases that already got
those tables via `drizzle push` (its DDL is not IF-NOT-EXISTS) — flagged
for a separate fix.

## npm workspace note

`plaid@47`'s type declarations are generated against axios ≥1.20
(`AxiosResponse` gained a 4th generic); the repo hoists axios 1.16 for
`@coinbase/cdp-sdk`. A scoped root `overrides` entry
(`plaid → axios@1.20.0`) nests the right axios under plaid so its types
resolve — without it every Plaid call type-checks as `any` and typed lint
fails.
