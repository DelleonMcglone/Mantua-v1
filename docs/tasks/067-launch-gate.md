# Task 067 — Launch Gate: E2E, Security, Legal (Phase 10, G-001 … G-018)

> Owner directive 2026-09-13 ("Please begin Phase 10: Launch Gate (E2E,
> Security, Legal)"). Ledger: `docs/tasks/launch-gate.md`. Decision
> record: **D-117** in `docs/decisions/v2-open-decisions.md`. Prompt
> record: `docs/promptHistory/2026-09-13-launch-gate.md`.

## Task description

Phases 4–9 shipped the market, the hook, the consumer layer, reliability,
the agent core, and the portfolio. The roadmap defines a launch gate in
three places (the Phase 9 table, the "Launch gate" and "Public launch
gate" lists) and B10-010 waits on "production live end to end". This task
turns those into one ledger and closes every row that can be closed from
inside the repository: a browser E2E suite in CI, a security pass over
the surfaces the sign-off predates, and legal documents that describe the
product as shipped with recorded acceptance.

## Success criteria

- [x] A Playwright suite drives the real client in Chromium through
      Discover → Trade → Executed → Exit, the error copy, the status
      banner, and the legal pages, and runs in CI on every PR (G-001, G-002).
- [x] The API sends a fixed set of security headers on every response,
      tested (G-006).
- [x] A static test proves every mutating route carries an auth,
      cron-secret, or signature guard, with allowlisted exceptions that
      name their reason (G-007).
- [x] A repository secret scan runs as a test and passes (G-008).
- [x] Dependency audit: semver-compatible fixes applied; remaining
      advisories triaged in writing (G-009).
- [x] `docs/security/launch-gate-review.md` re-verifies each safety rail
      on the Phase 6–9 surfaces and `sign-off.md` carries the 2026-09-13 addendum
      (G-010).
- [x] Terms and Privacy pages (and the counsel drafts) describe the fee
      model, the dispute window, in-play trading, sponsored transactions,
      agent autonomy, the custodied agent wallet, and bank rails (G-012,
      G-013).
- [x] Terms acceptance is recorded per user and version; the ticket asks
      once before the first trade (G-014).
- [x] The incident runbook carries a rehearsal script the owner can run
      (G-016).
- [x] Roadmap Phase 9 rows and the Definition of Done reflect the real
      state; every owner-gated row names its artifact (G-003 … G-005,
      G-011, G-015, G-017, G-018).

## Failure conditions

- The browser suite passes without exercising the real components (a
  mocked component tree is not the client).
- A mutating route ships without a guard and the audit test is silent.
- A header is added that breaks the SPA or the auth iframe.
- A legal page claims something the product does not do, or omits a
  data flow the product has (bank data, AI processing).
- An owner-gated row is marked ✅.

## Edge cases

- The browser suite must not need a Privy app id, a database, or a chain.
- A user who accepted an older Terms version is asked again once.
- The secret scan must not flag public well-known keys used by test
  tooling, and must flag a real key pattern in any tracked file.
- The route-guard audit must see routes registered through factories
  (`createXRouter`) as well as top-level `router.post`.

## Implementation checklist

- [x] Task doc, prompt history, D-117, ledger.
- [x] `security-headers.ts` + test; `route-guards.test.ts`;
      `secret-scan.test.ts`; `express-rate-limit` bump; `vercel.json`
      headers.
- [x] `legal_acceptances` schema + migration 0021 + `lib/legal.ts` +
      `routes/legal.ts` + tests; client `use-legal-acceptance.ts` +
      `TicketTermsGate.tsx`; Terms / Privacy pages and drafts refreshed.
- [x] `client/e2e/`: config, Privy shim + Vite alias, fixtures, specs;
      `e2e.yml` workflow; `npm run e2e`.
- [x] `docs/security/launch-gate-review.md`, sign-off addendum A2,
      runbook drill, roadmap + DoD reconciliation.

## Outcome (2026-09-13)

- Browser suite: 10 specs green locally (Chromium 1194 via
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE`) and wired into CI (`e2e.yml`).
- Unit suites: server 937, client 240, all green; lint and typecheck
  clean; the changed files are Prettier-formatted (the repository-wide
  `format:check` was already red on `main` for 99 untouched files).
- Ledger: 11 rows ✅, 7 rows 🟡 owner-gated (`docs/tasks/launch-gate.md`).
- Found and fixed on the way: the lockfile carried only macOS native
  bindings, so no Linux `npm ci` could start Vite (review §6).

## Slice 2 (2026-09-13, same day) — closing what the first pass left open

- [x] G-003 corrected: `contracts.yml` already runs the gating fork suites
      on a Base Mainnet fork on every contracts PR and on `main` (run #8
      green, 2026-09-12); the ledger, roadmap P9-002, and sign-off B4 now
      say so. Ledger: 12 ✅ / 6 🟡.
- [x] CSP in report-only mode: `server/src/lib/security/csp.ts` (per-host
      allowlist with reasons, builder) + test that pins `vercel.json`'s
      header to the builder and forbids eval / inline scripts / plugins;
      `POST /api/csp-report` (`routes/csp-report.ts`, both browser content
      types, 16 kB cap, one log line per violation, always 204) + tests;
      route-guard allowlist entry with reason.
- [x] Vercel installs from the lockfile (`npm ci`) now that the Linux
      bindings are present.
- [x] Kill-switch drill runner: `lib/ops/drill-core.ts` (classify, judge,
      render — tested) + `scripts/kill-switch-drill.ts`
      (`npm run drill:kill-switch`); runbook §13 names it.
