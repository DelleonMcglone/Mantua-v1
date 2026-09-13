# Task 061 — Agent loop test, hedge attribution, gate monitoring, audit typing (Phase 8, A-017/A-039/A-040/A-045/A-046)

> Owner directive 2026-09-12 (Phase 8 🤖 AI Agent Core, "continue starting
> with phase 8"). Ledger: `docs/tasks/ai-agent-core.md`. Closes the
> planned lanes; the two owner user tests remain owner-gated with the
> script below.
>
> Gates: server typecheck ✅, lint ✅, **899 pass / 0 fail** (894 → 899); client
> untouched.

## Task description

### A-017 — the agent loop test

`runAgentChat` gains an injectable dependency bag (`AgentLoopDeps`: model
client, wallet, user, session, history, persistence, policy, execution,
audit, confirmation store) whose defaults are the production readers and
writers — the route passes nothing and changes nothing. The loop test
(`lib/agent/agent-loop.test.ts`) drives the REAL loop with a scripted
model at the Anthropic seam and the REAL `executeTool` for the refusal
cases (the gate refuses before any wallet or chain I/O):

1. a money tool without the user's confirm is refused inside the loop,
   streamed as a tool error, fed back to the model as `is_error`, and the
   model gets its second round; both turns persist with the step;
2. a fabricated confirmation id is `CONFIRMATION_INVALID`;
3. the user's own "confirm" mints an id, the model reads it from the
   per-turn system context, and the executing tool receives the same id
   in its turn context; the preview is spent.

### A-039 — attribution

`computePerformance` joins each fill's tx hash to the audit action
recorded for it: `agent_market_trade` → `agent_chat`, `strategy_execute`
/ `strategy_close` → `hedge_strategy`, anything else → `user`. Every
market row carries its distinct sources and the totals count trades by
source, so "how much of my P&L did the hedge engine make" is one read.

### A-040 — monitoring

`evaluateAlerts` gains `agent_refusal_rate` (warn): once at least 10
executions were gated, more than half refused means the model is calling
money tools without the user's confirm or previews are drifting —
`docs/ops/incident-runbook.md` §12 is the runbook. Refusal codes are
listed in the detail.

### Audit typing

The hedge engine wrote `strategy_*` actions as plain strings past the
`AuditAction` union; the union now carries `strategy_arm`, `_disarm`,
`_auto_disarm`, `_trigger`, `_execute`, `_close` and the store's helper is
typed against it.

### A-045 / A-046 — owner user tests (owner-gated)

Run twice, on a deployment with `AGENT_MODE=user_testing` and a funded
agent wallet, recording the funnel counters from `/api/ops/metrics`
before and after:

1. Open the agent panel → **Trade** chip → the markets card renders.
2. "Analyze the Falcons" → the analysis card shows the estimate, the
   market price, evidence rows and risks.
3. "Buy $10 of Falcons YES" → the preview card shows tokens, price,
   impact, fee, position after, cap remaining, and a **Confirm trade**
   button; nothing has moved (`agent.funnel.execute_ok` unchanged).
4. Press **Confirm trade** (test 1) / type "confirm" (test 2) → the
   success card shows the tx; `mantua_get_position` shows the position;
   Portfolio → Agent shows it marked.
5. Type "maybe" to a fresh preview → nothing executes; the reply asks
   for "confirm".
6. Set the policy to **Paused** → a new preview is not executable and
   says why.

Record: time to first card, time from Confirm to the success card,
counter deltas, anything the user had to re-type. Those observations
are the A-044 baseline.

### Success criteria

- [x] The loop is tested end to end with the gate in the path — A-017
- [x] Fills are attributed to the chat agent, the hedge engine, or the user — A-039
- [x] The gate's refusal rate is monitored with a runbook — A-040
- [x] Strategy audit actions are typed
- [ ] Owner user tests 1 and 2 run and recorded — A-045, A-046 (owner)

### Tests

- `server/src/lib/agent/agent-loop.test.ts` — the three loop scenarios.
- `server/src/lib/agent/performance.test.ts` — attribution by audit action.
- `server/src/lib/alerts.test.ts` — the refusal-rate alert's floor, trigger and clear.
