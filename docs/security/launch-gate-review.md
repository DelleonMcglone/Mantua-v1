# Launch Gate Security Review — Phase 10 (task 067, G-006 … G-010)

Date: 2026-09-13. Scope: the surfaces shipped after the 2026-09-06
sign-off addendum — the consumer trading layer (Phase 6, task 050), the
reliability spine (Phase 7, tasks 051–054), the agent core (Phase 8,
tasks 055–061), the portfolio and activity surfaces (Phase 9, tasks
062–066), and the legal acceptance record added here. Method: each
safety rail from `sign-off.md` §2 is traced to its enforcement point on
the new surfaces and to the test that proves it; then a headers pass, a
route-guard audit, a secret scan, and a dependency triage, each of which
now runs as a test so it cannot silently regress.

## 1. What is new since the sign-off

| Surface                                        | Routes / modules                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Consumer trade path                            | `POST /api/markets/trade/quote`, `POST /api/markets/trade/calldata`, `GET /api/markets/trade/status`, `POST /api/markets/fills` |
| Discovery, detail, positions                   | `GET /api/markets/discover`, `/api/markets/detail`, `/api/markets/positions`, `/api/markets/comments`                           |
| Platform status and the live stream            | `GET /api/status`, `GET /api/stream/live` (SSE), `GET /api/sports/slate`                                                        |
| Agent execution gate, policies, untrusted data | `server/src/lib/agent/*` (execution-gate, policy, untrusted, confirmation-store, trade-simulation)                              |
| Activity and portfolio economics               | `/api/activity`, `/api/portfolio/economics`                                                                                     |
| Legal acceptance                               | `GET/POST /api/legal/acceptance`                                                                                                |
| Operations                                     | `/api/ops/metrics`, `/api/resolution/*` (ops auth), the cron routes (cron secret)                                               |

## 2. Safety rails on the new surfaces

| Rail                      | Enforcement on the Phase 6–9 surfaces                                                                                                                                                                                                                                     | Evidence                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Kill switches             | `killSwitch` is mounted before every router (`app.ts`), so trade calldata, fills, agent actions, legal acceptance, and every other write refuse with `503 KILL_SWITCH_ACTIVE`; `/api/status` publishes `killSwitch` and the client renders "Trading paused" on the ticket | `middleware/kill-switch.test.ts`; `lib/platform-status.test.ts`; `client/e2e/errors.spec.ts` ("a platform pause disables Confirm") |
| Agent spending caps       | The consumer quote route reads price without consuming cap; only `calldata` (on Confirm) consumes it; the agent path clamps through `spending-cap.ts` and the execution gate                                                                                              | `routes/market-trade-cap-e2e.test.ts`; `lib/spending-cap.test.ts`; `lib/agent/execution-gate.test.ts`                              |
| Confirmation before spend | The ticket's Confirm is the only path to `calldata` + broadcast; the agent's execution modes require a structured confirmation and never arm on prose                                                                                                                     | `client/src/features/markets/trade-ticket-core.test.ts`; `lib/agent/confirmation-language.test.ts`, `confirmation-store.test.ts`   |
| Contract allowlist        | Agent execution targets stay inside `circle/allowed-targets.ts`; the consumer path's `to` is the market address the server resolved from the league + event id, never a client-supplied address                                                                           | `circle/allowed-targets.test.ts`; `routes/market-trade.test.ts`                                                                    |
| Rate limits               | `ipRateLimiter` global; `writeRateLimiter` on every consumer write including legal acceptance; the shared Redis store keeps limits consistent across instances                                                                                                            | `middleware/rate-limit-redis-store.test.ts`; `routes/legal.test.ts`                                                                |
| Audit log                 | Fills, agent actions, strategy transitions, and Terms acceptances are durable rows keyed by user; the activity spine reads them back rather than recomputing                                                                                                              | `lib/activity.test.ts`, `activity-e2e.test.ts`; `routes/legal.test.ts` (idempotent acceptance)                                     |
| Freeze integrity          | Unchanged: the hook and the service sweep freeze on the same clock; the consumer path surfaces `TRADING_HALTED` as copy and the quote route refuses a fee above the 0.70% ceiling                                                                                         | `client/src/features/markets/trade-errors.test.ts`, `market-trade-core.test.ts`; `client/e2e/errors.spec.ts`                       |
| Injection hardening       | Provider text is sanitized at the serializer; agent read tools treat fetched data as untrusted and the loop refuses instructions found in it                                                                                                                              | `lib/agent/untrusted.test.ts`, `injection-security.test.ts`; `lib/sports/public-slate.test.ts`                                     |
| Chain boundary            | Every trade status lookup and calldata carries `chainId: 8453`; the client's read transport is a fixed public list and the wallet signs only what the server built                                                                                                        | `routes/market-trade-status.test.ts`; `client/src/lib/privy/wallet-client.ts`                                                      |

No rail regressed. One rail widened: legal acceptance is a new write and
sits behind `requireAuth` + `writeRateLimiter` + the kill switch like
every other write.

## 3. Security headers (G-006)

`server/src/middleware/security-headers.ts` sets on every response:
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy`
that denies camera, microphone, geolocation, and payment,
`Cross-Origin-Opener-Policy: same-origin`, HSTS (one year, subdomains)
when the request arrived over TLS, and `Cache-Control: no-store` on any
response to an authenticated request. `vercel.json` mirrors the static
subset on the hosted SPA.

**Content-Security-Policy ships in report-only mode.**
`server/src/lib/security/csp.ts` lists every third-party origin the SPA
loads (Privy and its Turnstile challenge, the WalletConnect relay, verify
and secure frames, Plaid Link, Google Fonts, the two public Base RPC
hosts), each with its reason, and renders the
`Content-Security-Policy-Report-Only` value that `vercel.json` carries; a
test keeps the two identical and forbids `'unsafe-eval'`, inline scripts,
and plugins. Violations post to `POST /api/csp-report`
(`routes/csp-report.ts`): no credentials by design, IP-limited, body
capped at 16 kB, reduced to one log line per violation, always 204. The
vendor host lists could not be re-fetched from this environment (egress
blocked), which is exactly why the policy is report-only: a clean report
window on staging (G-017) is the evidence to flip the header to
`Content-Security-Policy`. Until then a missing host costs a log line,
not a broken login.

## 4. Dependency audit (G-009)

`npm audit` on 2026-09-13: 17 high, 41 moderate, 9 low, 0 critical.
Applied: `express-rate-limit` 8.4.1 → 8.7.0, which removes the
`ip-address` advisory from the request path. Rejected: `npm audit fix`,
because it re-resolves 201 lockfile entries (a Privy SDK bump and a
transitive reshuffle across the Circle and Solana adapters) — that is a
dependency upgrade task, not a launch-gate fix.

| Advisory (high)                                                                                             | Reaches production?                                                                                 | Disposition                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ws` (memory disclosure / fragment DoS) via `@privy-io/react-auth`                                          | Browser bundle; `ws` is the Node implementation and is not used in the browser build                | Accept for launch; closes with the `@privy-io/react-auth` 3.42 upgrade in the SDK bump task |
| `axios` prototype pollution via `@coinbase/cdp-sdk`                                                         | Server, agent bridge only; requests are built from typed fields, never from user objects            | Accept; bump with the CDP SDK when its range allows                                         |
| Circle adapters (`@circle-fin/*`) via `@solana/web3.js`, `@coral-xyz/anchor`, `toml`                        | Server; the Solana adapter is never instantiated (Base only)                                        | Accept; no fix available upstream; tracked                                                  |
| `fast-uri`, `hono`, `js-cookie`, `socket.io-parser`, `nanoid`, `brace-expansion`, `browserslist`, `postcss` | Dev tooling or unused transitive paths (no Hono server, no socket.io, no cookie library in the app) | Accept; carried by the dependency upgrade task                                              |
| `vite` (Windows `server.fs.deny` bypass, `launch-editor` UNC)                                               | Dev server only, Windows only                                                                       | Accept; bump to 8.3 with the next tooling update                                            |

## 5. Route-guard audit and secret scan (G-007, G-008)

`routes/route-guards.test.ts` parses every `routes/*.ts` for `post`,
`patch`, `put`, and `delete` registrations and requires one of
`requireAuth`, `requireCronSecret`, `requireOpsAuth`,
`verifyCircleWebhook`, `verifyFiatWebhook`, or `freeAnalystQuota` ahead of
the handler. Allowlisted with a reason in the test: `/api/rpc` (a
read-only JSON-RPC proxy with its own method allowlist), and the Circle
and fiat webhooks (signature verified inside the handler against the raw
body, which is why they mount before `express.json()`).

`lib/security/secret-scan.test.ts` walks every tracked file for private
key blocks, cloud and API token prefixes, and secret-named variables
assigned 64-hex literals; the only allowlisted values are Anvil's
published test keys. It passed clean.

## 6. Finding: the lockfile could not install on Linux

`package-lock.json` was generated on macOS and carried only the
`darwin-arm64` optional native bindings for rolldown, esbuild,
lightningcss, and the Tailwind oxide. A Linux `npm ci` succeeded but Vite
could not start (`Cannot find native binding … linux-x64-gnu`), which is
why no browser suite could have run in CI before this task. Fixed by
adding the Linux bindings for the same package versions (including the
two nested esbuild copies) without re-resolving anything else; `npm ci`
on Linux is now clean and the browser suite runs on it. The Vercel build
sidestepped this with `npm install --no-package-lock`, which means
production builds were not pinned to the lockfile. `vercel.json` now
installs with `npm ci` (peer resolution comes from `.npmrc`), so the
first deploy after this change is the proof that the pin holds on
Vercel's Linux builders (G-004).

## 7. Residual risk and follow-ups

- Flip CSP from report-only to enforcing after a clean report window on
  staging (§3).
- The SDK bump task: `@privy-io/react-auth` 3.42, the CDP SDK, `vite` 8.3.
- The human audit and second-model review before the mainnet deploy
  (ledger G-018); the fork suites already run in CI (G-003).
- The browser suite scripts the chain; a funded run on staging (G-017) is
  the only proof of the wallet path end to end.
