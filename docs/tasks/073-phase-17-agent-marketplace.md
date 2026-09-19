# Task 073 — Agent Marketplace + Agent-Native Services (Phase 17, MP-001 … MP-011)

> Numbering follows the owner's master list of 2026-09-16
> (`docs/tasks/mantua-v1-task-list.md`), where Phase 17 is "Circle Agent
> Marketplace + Agent-Native Services". Task number **073** is the next
> sequential execution slot — `072-prediction-market-combos.md` is the
> Phase 16 doc (PR #60); the Phase 17 brief's "task 072" predates that
> collision check and is superseded here so the sequence stays one-per-phase.

**Branch:** `docs/phase-17-marketplace` (docs/ledger); Phase 17's code waves
run as their own branches — the foundation wave merged as PR #61
(`feat/x402-paywall-trading`, squash `3b2c329`), the remaining service
routes and the OpenAPI publication run in parallel PRs staged behind it.
**Prompt history:** `docs/promptHistory/2026-09-19-phase-17-marketplace.md`
(Phase 17 spec thread).
**Decisions:** D-012 (legal review before fee collection — the counsel
gate), D-106 (x402 scope, non-goals, build gate — open questions (b) and
(c) resolved by this phase), D-110 (custody boundaries the x402 surfaces
must not cross); the four owner-locked forks below.

## Description

Phase 17 makes Mantua an x402 **seller** at marketplace scale: six machine
services (seven catalog rows — trading is one family with two endpoints;
MP-008 does not exist in the owner's phase list) that any external agent
buys per request in USDC on Base Mainnet, with no API keys, no accounts,
and no Privy identity. One catalog module (`server/src/lib/x402/catalog.ts`)
is the single pricing source of truth; one dual-rail paywall
(`server/src/middleware/x402-paywall.ts`) offers Circle Gateway
nanopayments and vanilla onchain x402 in a single 402 `accepts` array; thin
route handlers wrap the existing libraries — zero new engines. Every
settled payment writes one `agent_x402_sale` audit row, the seller-side
mirror of the buyer's `agent_x402` discipline.

The phase rests on the D-106 precondition: **every new x402 surface ships
with roadmap rows and tests** (the two pre-Phase-17 surfaces had neither),
and on a packaging + ledger track that makes the phase submittable to
Circle's Agent Marketplace: the offerings doc, the seller runbook, this
task document, the roadmap section, and the env documentation.

**The four owner-locked forks (2026-09-19, not reopened):**

1. **Advisory + calldata trading.** The trading service returns quotes,
   analysis, and execution-ready calldata; callers execute with their own
   wallets. No custody of external funds — no call into `circle/execute.ts`
   anywhere on the paid routes.
2. **Dual-rail payments.** Gateway nanopayments + vanilla onchain x402 in
   one 402 `accepts` array, per Circle's become-a-seller guide.
3. **Sports intelligence = allowlist + payment.** The payer-address
   allowlist is checked pre-settlement — a refused payer is never charged —
   and an empty allowlist keeps the service dark.
4. **Build now, gate go-live.** All seller surfaces ship env-gated dark;
   flipping the env on and submitting the marketplace intake form wait for
   counsel sign-off on the D-012 seller-revenue posture.

## Success criteria

1. Every cataloged service returns `402` with a `PAYMENT-REQUIRED` header
   offering **both rails in one `accepts` array** when unpaid, and serves
   only after a settled payment. (MP-004, MP-005 … MP-011)
2. The sports-intelligence service refuses an un-allowlisted payer
   pre-settlement (`403 x402_payer_not_authorized`) with zero facilitator
   settlement calls; an empty/absent allowlist keeps it dark. (MP-011)
3. Seller surfaces are **dark by default**: with `X402_SELLER_ADDRESS`
   unset or a service absent from `X402_SELLER_SERVICES`, the service
   reports 503 and serves nothing. (MP-004)
4. Trading stays advisory + calldata: the calldata response carries quote +
   cap state, no path calls into `circle/execute.ts`, and a cap-blocked
   payer gets a typed `cap_blocked` with no calldata. (MP-007)
5. C-019 caps bind external callers: the spend ledger keys to the **payer**
   address, refused checks leave no `recordSpending` ink, and seller paths
   never read the buyer-side cap env vars. (MP-007)
6. The kill switch covers paid routes — an engaged runtime flag 503s the
   paid services like any other money path. (MP-004)
7. OpenAPI parity: a test fails CI whenever a served spec drifts from the
   catalog on path, method, or price; the specs and the service index are
   served unpaid. (MP-003)
8. Seller earnings are visible: exactly one `agent_x402_sale` audit row per
   settled payment with payer, service, and price. (MP-004)
9. The packaging/ledger deliverables exist and agree with the code: the
   offerings doc's endpoints/prices match the catalog exactly, the seller
   runbook covers prerequisites → intake → screening → health checks →
   earnings → go-live with the counsel gate stated, the roadmap carries a
   row per new surface, D-106's open questions (b)/(c) are resolved in the
   record, and every seller env var is documented in `server/.env.example`
   with dark-by-default comments. (MP-002, MP-003)
10. Baseline holds: typecheck, lint, and both test suites green in CI on
    every PR in the phase.

## Failure conditions

- Any paid route returning resource data without a settled payment.
- Any paid route requiring Privy identity (payment IS the auth).
- Any service duplicating engine logic instead of wrapping the existing
  libraries.
- Any seller path reading buyer-side cap env vars
  (`X402_MAX_CALL_USD` / `X402_DAILY_CAP_USD`).
- The sports-intelligence service settling before the allowlist check.
- A price hardcoded in a handler (prices live only in the catalog).
- A documented endpoint or price drifting from `catalog.ts` — the offerings
  doc is regenerated from the catalog, never paraphrased.
- The seller env flipped or the intake form submitted without the counsel
  sign-off recorded in the D-106 record.

## Edge cases

| Case                                                  | Behaviour                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `X402_SELLER_ADDRESS` unset                           | 503 dark — the whole seller side is off (graceful-dark pattern).                                                                       |
| Service id missing from `X402_SELLER_SERVICES`        | 503 dark for that service; the rest serve (unset list = all dark).                                                                     |
| Sports-intel payer not on the allowlist               | `403 x402_payer_not_authorized` **before** settlement — never charged, not even a verify call.                                         |
| Payer past the C-019 daily cap                        | Typed `cap_blocked` after payment — a definitive answer to a purchased request; no ledger ink on a refused check.                      |
| Betting closed / trading halted on a paid market call | `BETTING_CLOSED` (409) / `TRADING_HALTED` (503) pass through unchanged.                                                                |
| Unknown market                                        | `NO_MARKET` (404).                                                                                                                     |
| Sub-cent price                                        | Supported by the Gateway rail (batch-settled offchain).                                                                                |
| Both rails offered to one client                      | The single 402 `accepts` array carries Gateway + vanilla rows; the client's accepted row routes settlement to the right facilitator.   |
| Catalog price changed but spec stale                  | CI fails on OpenAPI parity — the listing prerequisite cannot rot silently.                                                             |
| Gateway balance accumulating                          | Withdraw via `GatewayClient` (`docs/marketplace/become-a-seller.md`); vanilla-rail sales settle directly onchain, nothing to withdraw. |
| Kill switch engaged                                   | Paid routes 503 `KILL_SWITCH_ACTIVE` with the rest of the money paths.                                                                 |
| External caller with no Privy session                 | Served — payment is the identity; `settledPayer` keys the cap ledger.                                                                  |

## Implementation checklist

### Foundation (MP-001, MP-004, MP-007) — PR #61, merged

- [x] Requirements review (MP-001) — done in the Phase 17 research; the
      requirements are enforced by the verification bar above.
- [x] `server/src/lib/x402/catalog.ts` (+ test) — the seven catalog rows
      (six families), the single pricing source of truth.
- [x] `server/src/middleware/x402-paywall.ts` (+ test) — the dual-rail
      factory: one 402 offering both rails, dark gates on
      `X402_SELLER_ADDRESS` / `X402_SELLER_SERVICES`, the pre-settlement
      allowlist gate for `allowlist+payment` services, and the
      `agent_x402_sale` audit row on settle.
- [x] `server/src/routes/x402-trading.ts` (+ test) — MP-007 quote +
      calldata; `guardSpend` keyed to the settled payer; typed refusals
      pass through; no `circle/execute.ts` anywhere.
- [x] Env wiring in `server/src/env.ts`: `X402_SELLER_SERVICES`,
      `X402_GATEWAY_FACILITATOR_URL` (default mainnet facilitator),
      `X402_SPORTS_INTEL_ALLOWLIST` (all fail-closed).

### Packaging + ledger (MP-002, MP-003) — this branch (`docs/phase-17-marketplace`)

- [x] `docs/marketplace/offerings.md` (MP-002) — six families × endpoint ×
      price × spec URL with listing copy, read from the catalog; the legacy
      $0.01 analyst brief listed as the first-generation surface.
- [x] `docs/marketplace/become-a-seller.md` (MP-003) — prerequisites
      (dedicated payout wallet options, Node 22.6+, facilitator config),
      the intake-form field list, sanctions screening, post-approval
      health checks, `GatewayClient` earnings/withdraw commands, the
      counsel gate, and the operator to-dos (Actions `CRON_SECRET` unset;
      stale `test-mantua.vercel.app` deployment).
- [x] This task document, the roadmap Phase 17 section (a row per new
      surface — the D-106 precondition), the D-106 record update, and the
      `X402_*` seller vars in `server/.env.example` (dark-by-default
      comments, closing the env-doc drift gap).

### Remaining services (MP-005, MP-006, MP-009, MP-010, MP-011) — parallel PR

- [ ] `server/src/routes/x402-services.ts` (+ test) — discovery,
      intelligence, portfolio-exposure, hedging, and sports-intelligence
      handlers as thin wrappers over the existing libraries.
- [ ] OpenAPI publication: unpaid `GET /api/x402/openapi/:serviceId.json`
      specs, the unpaid `GET /api/x402/v1/services.json` index, and the
      catalog↔spec parity test (MP-003's listing prerequisite).

### Go-live (human, counsel-gated — not a code item)

- [ ] Counsel sign-off on the D-012 seller-revenue posture, recorded in
      D-106; then the env flip + intake-form submission per
      `docs/marketplace/become-a-seller.md`.

## Notes

- **Task-number correction.** The brief and spec name this document
  "task 072"; 072 was taken by the Phase 16 combos doc (PR #60) before the
  spec froze. The sequence stays one-per-phase: this is task 073. The
  master task list's phase numbering (Phase 17 = MP rows) is unaffected.
- **Parallelism.** This branch is docs/ledger only (plus
  `server/.env.example`): it cannot collide with the services PR, which
  lands the MP-005–011 handlers, or the OpenAPI PR staged behind it. The
  checklist above marks each surface's landing spot; statuses here read
  against `origin/main` at `3b2c329` plus the in-flight PRs.
- **Six, not seven.** The catalog has seven rows; trading-quote and
  trading-calldata are one family (MP-007). MP-008 does not exist in the
  owner's phase list — the offerings doc lists six families.
- **Pricing.** Default prices are owner-adjustable until the counsel-gated
  go-live; after that they are contract terms. Price changes are one-line
  diffs in the catalog, and the parity test keeps the served specs honest.
