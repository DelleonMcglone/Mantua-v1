# Task 070 — Agent Extended (Phase 13, AE-001 … AE-014)

> Numbering follows the owner's master list of 2026-09-16
> (`docs/tasks/mantua-v1-task-list.md`), where Phase 13 is "Agent
> Extended — Social Posting, Reputation + AI Customer Support".

**Branch:** `claude/agent-extended-social-reputation-dzi0fj`
**Prompt history:** `docs/promptHistory/2026-09-18-agent-extended.md`
**Decision:** D-107 (social platform) — recorded in
`docs/decisions/v2-open-decisions.md` and `docs/architecture.md`.

## Description

Three capabilities that make an agent a public actor rather than a private
tool, built on one shared foundation:

1. **Reputation** (AE-011 … AE-014). A canonical, append-only performance
   ledger per agent wallet, derived from chain-verified fills, market
   resolutions and the audit trail — never from a table anyone can edit.
   Every entry is labelled with how it came to be: **simulated**
   (no capital moved), **user-confirmed** (the user pressed confirm) or
   **autonomous** (the engine or the autonomous mode acted under a
   pre-armed policy). Realised P&L, unrealised P&L, ROI, win/loss,
   drawdown, exposure and risk metrics are computed from that ledger and
   nothing else, and a digest over the entries lets any reader prove that
   nothing was removed between two views.
2. **Social posting** (AE-001 … AE-006). An agent may claim a public
   handle and post to the platform's X account: market updates,
   explain-the-move posts, and price-as-signal forecasts, all composed
   from templates over live data, all passed through a compliance lint
   and a cadence gate, and all recorded so the public page shows the
   agent's voice beside its record.
3. **AI customer support** (AE-007 … AE-010). A read-only support agent
   with a knowledge base, account-aware context for signed-in users,
   deterministic troubleshooting flows, and a human escalation path that
   opens a ticket.

The structural decision the phase rests on: **the ledger is derived, not
declared.** A performance number that could be typed is a performance
number that could be edited. Everything public reads from records the
chain and the resolver wrote.

## Success criteria

1. `GET /api/agents/:handle` answers without authentication with the
   agent's profile, ledger totals, per-market rows, and recent posts, and
   a losing market can never be excluded from it. (AE-005, AE-012)
2. Every ledger entry carries `mode ∈ {simulated, user_confirmed,
autonomous}` and the totals are broken down by mode. Capital-at-risk
   metrics count only real fills; simulated entries are reported
   separately and never blended into P&L. (AE-013)
3. The ledger module exposes no filter by outcome, the fills table gains
   a database trigger that refuses UPDATE and DELETE, and the public
   response carries a digest over all entries. (AE-014)
4. Realised P&L, unrealised P&L, ROI on capital deployed, win/loss/void
   counts, maximum drawdown, current exposure and a risk block (largest
   stake share, largest loss, profit factor, average stake) are computed
   by pure functions with unit tests. (AE-011)
5. A user can claim a handle, choose which templates the agent may post,
   set a cadence, preview what would be posted, and approve or reject
   each preview. (AE-001, AE-006)
6. A scheduled tick composes market-update, explain-the-move and
   price-signal posts for notable markets, lints them, respects the
   cadence, posts them through the X API and records every attempt.
   (AE-002, AE-003, AE-004)
7. Every post passes the compliance lint: no unsubstantiated performance
   claims, no forbidden words, a required disclaimer, and only ledger
   figures may appear as performance figures. (AE-006)
8. The X API credentials live only in server env; absent, posting is a
   recorded dry run. The OAuth 1.0a signature is verified against the
   published reference vector. (AE-001)
9. `POST /api/support/chat` streams answers grounded in the knowledge
   base and, for a signed-in user, in their own account context;
   `POST /api/support/message` gives the same answer as one JSON body for
   non-web channels. (AE-007, AE-008)
10. Troubleshooting flows for the common failures are deterministic
    code, not model improvisation, and a support turn can open a human
    ticket with a transcript summary. (AE-009, AE-010)

## Failure conditions

- Any performance figure that is stored rather than derived.
- A public ledger response missing a resolved-loss market the wallet
  traded.
- A simulated entry counted in realised P&L, ROI or drawdown.
- An X credential, or the account password, anywhere in the repository
  or reachable from the browser.
- A post leaving the process without passing the lint and the cadence
  gate.
- The support agent able to call any money-moving tool.
- A new dependency for OAuth signing or SSE.

## Edge cases

| Case                                            | Behaviour                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Handle unknown                                  | 404 `AGENT_NOT_FOUND`; nothing about other agents is revealed.                              |
| Profile exists but is private                   | 404, same as unknown — the handle namespace does not leak.                                  |
| Fill with no audit row                          | Mode `user_confirmed` is never assumed; the entry is labelled `unattributed` and counted.   |
| Autonomous-mode fill carrying a confirmation id | `user_confirmed` — the press wins over the mode flag.                                       |
| Hedge-engine fill                               | `autonomous` (armed in advance, fired by a tick).                                           |
| Voided market                                   | Counted as a void, realised P&L zero; never a win.                                          |
| No X credentials                                | The tick records each post as `dry_run` with the full text; nothing leaves the server.      |
| X returns 429 or 5xx                            | The post is recorded `failed` with the status; the tick continues with the next profile.    |
| Post text fails the lint                        | Recorded `rejected` with the violations; never sent.                                        |
| Cadence exhausted                               | Skipped silently for this tick; the next tick re-evaluates.                                 |
| User rejects a preview                          | Recorded `rejected` by user; that market/template pair is not re-offered for 24 h.          |
| Support question about another user's account   | Account tools only ever read the caller's own records; there is no lookup by address.       |
| Support asked to trade or move money            | The agent has no such tool; it explains where the user can do it themselves.                |
| Escalation with no webhook configured           | The ticket row is still written and its id returned; the log line is the operator's signal. |

## Implementation checklist

### Ledger (AE-011 … AE-014)

- [x] `server/src/lib/agent/execution-mode.ts` (+ test) — the pure mapping
      from an audit row to a ledger mode.
- [x] `auditChatToolCall` records `mode` in the audit params so the
      mapping has something to read.
- [x] `server/src/lib/agent/ledger.ts` (+ test) — entries from fills,
      simulations from activity, digest, totals by mode.
- [x] `server/src/lib/agent/ledger-metrics.ts` (+ test) — drawdown, ROI,
      exposure, risk block.
- [x] `server/src/lib/agent/ledger-read.ts` — the database reader;
      `ledger-types.ts` holds the shapes the route and client name.
- [x] Migration `0022_agent_extended.sql` — the immutability trigger on
      `market_fills`, plus the three new tables below.
- [x] `docs/tasks/mantua-v1-task-list.md` untouched (owner's verbatim copy);
      `v2-roadmap.md` carries the status.

### Social (AE-001 … AE-006)

- [x] `server/src/db/schema/social.ts` — `agent_social_profiles`,
      `social_posts`, `support_tickets`.
- [x] `server/src/lib/social/oauth1.ts` (+ test against the reference
      vector) and `x-client.ts` (+ test over a `fetch` seam).
- [x] `server/src/lib/social/compliance.ts` (+ test).
- [x] `server/src/lib/social/posting-policy.ts` (+ test) — schema,
      defaults, cadence gate.
- [x] `server/src/lib/social/explain-move.ts` (+ test) — AE-003.
- [x] `server/src/lib/social/price-signal.ts` (+ test) — AE-004.
- [x] `server/src/lib/social/templates.ts` (+ test) — AE-002 wording.
- [x] `server/src/lib/social/profile-store.ts` (profile rows),
      `post-store.ts` (the post record), `post-decision.ts` (approve /
      reject), `candidates.ts` + `candidate-queries.ts` (markets worth a
      post), `tick-deps.ts` (production wiring), `post-run-types.ts`.
- [x] `server/src/lib/social/post-run.ts` (+ test) — one tick, deps
      injected.
- [x] `server/src/routes/agent-social.ts` (+ test) — profile, policy,
      previews, approve/reject.
- [x] `server/src/routes/agents-public.ts` (+ test) — the public page.
- [x] `server/src/routes/cron-social-posts.ts` and
      `.github/workflows/social-posts.yml`.
- [x] Env: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
      `X_ACCESS_TOKEN_SECRET`, `X_ACCOUNT_HANDLE`, `PUBLIC_APP_URL`.

### Support (AE-007 … AE-010)

- [x] `server/src/lib/support/knowledge.ts` (+ test).
- [x] `server/src/lib/support/troubleshoot.ts` (+ test) and
      `troubleshoot-flows.ts`.
- [x] `server/src/lib/support/account-context.ts`.
- [x] `server/src/lib/support/escalation.ts` (+ test).
- [x] `server/src/lib/support/support-chat.ts` (+ test with a scripted
      Anthropic client), `support-exec.ts` (tool executor and production
      I/O), `support-tools.ts` (prompt and tool surface).
- [x] `server/src/routes/support-chat.ts` (+ test).

### Client

- [x] `client/src/lib/chat-stream.ts` — one SSE POST helper; the analyst
      and agent stream clients become thin wrappers.
- [x] `client/src/features/reputation/` — `reputation-core.ts` (+ test),
      `reputation-types.ts`, `PublicAgentPage.tsx`, `PublicAgentSections.tsx`,
      `PublicAgentTables.tsx`.
- [x] `client/src/features/social/` — `social-core.ts` (+ test),
      `SocialPanel.tsx`, `SocialForms.tsx`, `SocialPostsSection.tsx`.
- [x] `client/src/features/support/` — `support-stream.ts`,
      `SupportPanel.tsx`, `SupportTurn.tsx`.
- [x] `App.tsx` routes: `agent-public` (URL `/agents/:handle`), `social`,
      `support`; profile entry points; header Help entry.

### Docs

- [x] `docs/architecture.md` (section + D-107), `README.md`,
      `docs/tasks/v2-roadmap.md`, `docs/decisions/v2-open-decisions.md`.
- [x] `server/src/routes/route-guards.test.ts` — the two public support
      routes allowlisted with their reason (G-007).
- [x] Lint, typecheck, both unit suites, the formatter. Server: 599 pass
      (+77 over the baseline; the same 44 env-dependent files fail without
      a `.env`, exactly as on `main`). Client: 322 pass.

## Notes

- **The credentials shared in the task prompt were not used and must be
  rotated.** An X login (username + password) cannot drive the X API,
  which needs a developer app's consumer key/secret and a user access
  token/secret; and a password pasted into a task tracker should be
  treated as disclosed. Nothing from that message is stored anywhere in
  this repository.
- **Review process.** The owner's process asks for an o3 pre-review and
  a Gemini code review; neither model is reachable from this session. The
  task document was self-reviewed against the edge-case table and the
  code was reviewed with the repository's code-review pass instead. Both
  external reviews remain open items for the owner.
- **No new dependency.** OAuth 1.0a is HMAC-SHA1 over a canonical string,
  done with `node:crypto`; the X call is one `fetch`; SSE reuses
  `lib/sse-core.ts`.
