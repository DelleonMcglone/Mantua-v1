# Launch Gate Ledger — Phase 10 (task 067, D-117)

> One list of what stands between `main` and a public launch, with the
> artifact that closes each row. Rows the repository can close are ✅ with
> evidence; rows only the owner can close (a deploy, a funded run, a
> counsel review, a written acceptance) stay 🟡 and name what they wait
> on. Nothing here is marked done on a promise. Source rows: roadmap
> Phase 9 (P9-001 … P9-013), its "Launch gate" and "Public launch gate"
> lists, B10-010, TD-005, and the open sign-off items.

| ID    | Gate                                                                                                                                                | Status | Evidence / what closes it                                                                                                                                                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-001 | Browser E2E: the real client in Chromium through Discover → Trade → Executed, the error copy, the pause, the logged-out ticket, and the legal pages | ✅     | `client/e2e/*.spec.ts` (10 specs, `npm run e2e`): Privy shimmed by Vite alias (`e2e/privy-shim.tsx`), the API and the chain scripted per spec (`e2e/harness.ts`, `e2e/fixtures.ts`, `e2e/rpc-mock.ts`). Asserts the hook's exact fee lines, "Trade executed", and no chain vocabulary on the ticket.                |
| G-002 | The browser suite runs in CI on every PR                                                                                                            | ✅     | `.github/workflows/e2e.yml` (`npm ci` → `playwright install chromium` → `npm run e2e`, traces uploaded on failure). `package-lock.json` now carries the Linux native bindings so a Linux `npm ci` can run Vite (see the review, §6).                                                                                |
| G-003 | Base Mainnet fork environment for chain-backed writes in CI (P9-002)                                                                                | ✅     | `.github/workflows/contracts.yml` runs the gating fork suites (`HookBaseline`, `FullLifecycleE2E`) on every contracts PR and push to `main` against a Base Mainnet fork (public RPC, `BASE_RPC_URL` secret optional); latest `main` run #8 (2026-09-12) green. The per-hook E2Es run advisory on chain drift.       |
| G-004 | Hosting provisioned per D-004 (P9-004)                                                                                                              | 🟡     | Owner: confirm the production Vercel project, the Neon database, and the Upstash store are provisioned and the env set per `docs/ops/incident-runbook.md` §7–§9. `vercel.json` carries the production headers (G-006), the report-only CSP, and now installs from the lockfile (`npm ci`).                          |
| G-005 | CI/CD to staging and production (P9-005)                                                                                                            | 🟡     | Owner: connect the repository to the Vercel project (staging branch auto-deploy). The CI gates a deploy must pass are `ci.yml` + `e2e.yml`.                                                                                                                                                                         |
| G-006 | Security headers on every API and hosted response                                                                                                   | ✅     | `server/src/middleware/security-headers.ts` (first middleware in `app.ts`) + `security-headers.test.ts`; `vercel.json` `headers` for the SPA. CSP deferred with reasons (review §3).                                                                                                                                |
| G-007 | Every mutating route carries an auth, cron-secret, signature, or quota guard                                                                        | ✅     | `server/src/routes/route-guards.test.ts` — static audit over every `routes/*.ts`; the three unguarded routes are allowlisted with the reason in the test (RPC proxy, two provider webhooks that verify a signature inside the handler).                                                                             |
| G-008 | No secret in any tracked file                                                                                                                       | ✅     | `server/src/lib/security/secret-scan.ts` + `secret-scan.test.ts` walks the repository on every test run; allowlists only the public Anvil keys.                                                                                                                                                                     |
| G-009 | Dependency audit: compatible fixes applied, the rest triaged in writing                                                                             | ✅     | `express-rate-limit` 8.4.1 → 8.7.0 (drops the `ip-address` advisory). The remaining advisories are triaged in `docs/security/launch-gate-review.md` §4; `npm audit fix` was rejected because it rewrites 201 lockfile entries (D-117).                                                                              |
| G-010 | Safety rails re-verified on the Phase 6–9 surfaces; sign-off addendum recorded                                                                      | ✅     | `docs/security/launch-gate-review.md` §2; `docs/security/sign-off.md` addendum of 2026-09-13.                                                                                                                                                                                                                       |
| G-011 | Hooks + markets deployed and verified on Base Mainnet (P9-013, H-009, D-112)                                                                        | 🟡     | Dynamic Market hook stack + market periphery deployed, BaseScan-verified, and wired into the server registries 2026-09-23 (H-009, PRs #78/#79; `verify:hooks` ✅). Remaining: the markets settlement layer (`DeployMarkets.s.sol` — MarketFactory + Resolver), then the Stable Protection / Dynamic Fee pool hooks. |
| G-012 | Terms of Use describe the shipped product                                                                                                           | ✅     | `client/src/components/legal/TermsPage.tsx` + `TermsProductSections.tsx` (fee model, review window, in-play, voids, pauses, sponsored transactions, bank rails, custodied agent wallet); mirrored in `docs/legal/TERMS-OF-SERVICE-DRAFT.md` with `[REVIEW]` markers. `client/e2e/legal.spec.ts` asserts the copy.   |
| G-013 | Privacy Policy discloses every data flow the product has                                                                                            | ✅     | `PrivacyPage.tsx` (bank connection data, agent wallet + actions, AI processing, retention rows); `docs/legal/PRIVACY-POLICY-DRAFT.md`.                                                                                                                                                                              |
| G-014 | Terms acceptance recorded per user and version; asked once before the first trade                                                                   | ✅     | `legal_acceptances` (migration 0021), `server/src/routes/legal.ts` + test, `client/src/features/legal/` + `TicketTermsGate.tsx`; `client/e2e/trade.spec.ts` proves the one-time gate and the returning-user path. A new version re-asks once (`legal-core.test.ts`).                                                |
| G-015 | Counsel review of the Terms and the Privacy Policy (P9-009 "reviewed")                                                                              | 🟡     | Owner: send both drafts to counsel; resolve every `[REVIEW]` marker; bump `TERMS_VERSION` / `PRIVACY_VERSION` (`server/src/lib/legal.ts`, `client/src/lib/legal-version.ts`) when the text changes so users are re-asked.                                                                                           |
| G-016 | Incident runbook carries a rehearsal script                                                                                                         | ✅     | `docs/ops/incident-runbook.md` §13 — a timed kill-switch drill with a log template, and `npm run drill:kill-switch -w @mantua/server -- --target <host>` (`server/src/scripts/kill-switch-drill.ts`) which does the polling, timing, and write-up; rules in `lib/ops/drill-core.ts` + test.                         |
| G-017 | Staging rehearsal: kill-switch drill run, dogfood ≥ 2 weeks with zero critical incidents, 10+ funded transactions (P9-007, P9-008)                  | 🟡     | Owner: run §13 on staging and file the log; dogfood per P9-007; the funded run per P9-008 after G-011. Each leaves an artifact (the drill log, the incident record, the fills table).                                                                                                                               |
| G-018 | Sign-off items outside the repository: M-01 written acceptance, L-03 note, human audit                                                              | 🟡     | Owner: the acceptances named in `docs/security/sign-off.md` §1 and A7; the second-model / human audit before G-011. (The fork suites the A7 addendum asked for run green in CI — G-003.)                                                                                                                            |

## Reading the ledger

- ✅ 12 rows close inside the repository and are proven by a test, a CI
  job, or a document that a reader can check.
- 🟡 6 rows need an action only the owner can take. None is blocked on
  code; each names the artifact that flips it.
- The launch order that follows from the dependencies: G-015 (counsel)
  and G-004/G-005 (hosting, CI/CD) can run now; G-011 (deploy) after
  G-018's audit items; G-017 (drill, dogfood, funded run) after G-011;
  G-003 whenever an RPC secret exists.

## Mapping to the owner's Launch Gate rows (L-001 … L-018)

The owner's master list (`mantua-v1-task-list.md`, 2026-09-16) numbers
the launch gate L-001 … L-018; this ledger's G rows were derived before
that list existed and are not 1:1. The correspondence:

| Owner row     | Ledger rows          | Note                                                                  |
| ------------- | -------------------- | --------------------------------------------------------------------- |
| L-001         | G-001, G-002         | browser suite + CI                                                    |
| L-002         | G-003                | fork suites in CI                                                     |
| L-003         | G-006 … G-010, G-018 | headers, guards, secret scan, triage, review; acceptances owner-gated |
| L-004         | G-012 … G-015        | Terms / Privacy / acceptance; counsel review owner-gated              |
| L-005         | G-016                | runbook + drill runner                                                |
| L-006         | G-004, G-005         | hosting and CI/CD, owner-gated                                        |
| L-007, L-008  | G-017                | dogfood + funded run, bundled here                                    |
| L-009         | —                    | load/chaos sign-off; R-008's spike run is owner-gated                 |
| L-010         | —                    | fee model observed in production telemetry, after G-011               |
| L-011, L-012  | —                    | soft and public launch                                                |
| L-013 … L-016 | —                    | activity proofs, closed in Phase 9 (tasks 062–066)                    |
| L-017         | —                    | the Launch Standard loop, after G-011 and G-017                       |
| L-018         | G-011                | mainnet deployments                                                   |
