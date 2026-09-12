# Task 055 — Agent execution gate: modes, simulation, confirmation (Phase 8, A-009/A-025 … A-035, A-047)

> Owner directive 2026-09-12 (Phase 8 🤖 AI Agent Core, "continue starting
> with phase 8"; mid-lane: "agent has direct access to x402 marketplace to
> buy data"). Ledger: `docs/tasks/ai-agent-core.md`. Decision record:
> **D-114** in `docs/decisions/v2-open-decisions.md`.
>
> Gates: server typecheck ✅, lint ✅, **856 pass / 0 fail** (825 → 856);
> client typecheck ✅, lint ✅, 163 pass / 0 fail (copy only).

## Task description

The chat agent was autonomous by design: the system prompt said "execute
AUTONOMOUSLY. Do NOT ask for confirmation", the route said "no confirmation
— the daily spending cap is the guardrail", and `trade_market` went
balance → cap → chain in one tool call. Phase 8 rows A-025 … A-035 require
the opposite posture for user testing: a mandatory simulation, an explicit
confirmation with a server-issued artifact, a fresh re-check at execution,
a server-side mode switch, and a chain of validation the LLM cannot skip.

### What landed

**`server/src/lib/agent/`** — five pure modules, all unit-tested:

| Module                     | Rows                              | What it decides                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-mode.ts`            | A-028                             | `AGENT_MODE` ∈ disabled / simulation / user_testing (default) / autonomous → `{enabled, writesAllowed, confirmationRequired, summary}`.                                                                                                                                                                                                                                                           |
| `confirmation-language.ts` | A-032                             | `messageConfirmsAction`: explicit patterns accept; "maybe", "looks good", "interesting", a question mark, a negation anywhere → not confirmed. Same idiom as `messageAuthorizesForce`.                                                                                                                                                                                                            |
| `trade-simulation.ts`      | A-009, A-025, A-030               | `simulateMarketTrade` over injected readers → `TradeSimulation`: `executable` + `blockers`, market tradability (open/closed/halted/no_market/not_deployed), estimate (in/out/min/effective price/impact vs implied), hook fee, resulting position + exposure, wallet policy (balance, cap, remaining today), market policy (per-trade limit, league). `materialDrift` for the execution re-check. |
| `confirmation-store.ts`    | A-031                             | One pending preview per session (10 min); `mint` turns the user's confirm into a single-use 5-minute confirmation bound to the preview and clears the preview; `take` consumes. Upstash when configured (`mantua:agent:`), memory otherwise. `argsHash` canonicalises the execution arguments.                                                                                                    |
| `execution-gate.ts`        | A-026, A-029, A-031, A-033, A-035 | `buildTurnContext` (pre-model: mints iff the user's own message confirms a pending preview) · `turnContextPrompt` (the system block the model reads) · `authorizeExecution` (mode → id present → id is this turn's → single-use take → tool match → args-hash match → fresh simulation without drift) · `ExecutionRefusedError` codes.                                                            |

**Wiring** (`server/src/lib/agent-chat.ts`, `routes/agent-chat.ts`, `env.ts`):

- New tools `mantua_simulate_trade`, `mantua_execute_trade`,
  `mantua_sell_position`, `mantua_preview_action`; `trade_market` removed.
  Every money-moving tool's schema carries `confirmationId`
  (`withConfirmationId`).
- `executeTool` runs the gate before any money-moving body; market
  executions pass a fresh simulation built from the production readers
  (`quoteMarketTrade`, on-chain balances, `spending-cap.ts`, the
  `agent_policies` row, the event's league, the latest `market_prices`
  row) and refuse on parameter mismatch against the confirmed simulation.
- `runAgentChat` computes the turn context before the model call (reading
  `agent_policies.auto_trade_enabled` for autonomous mode) and sends it as
  a second per-turn system block; the prompt's autonomy paragraph is
  replaced by the four-step protocol.
- `AGENT_MODE=disabled` → 503 `AGENT_DISABLED` at the route.
- `sharedKvClient` exported from `shared-cache.ts` so the confirmation
  store shares the Upstash client (a confirmation minted on one instance
  is honored on another).

**x402 exemption (owner directive, D-114 §3).** `call_paid_service` is not
a money tool for the gate: the agent has direct marketplace access to buy
data, bounded in code by `X402_MAX_CALL_USD` and `X402_DAILY_CAP_USD` from
its own buyer wallet, audited per call. The prompt says so explicitly.

**A-047.** The `set_cap` bypass was closed in task 024 (C-010); the stale
"critical hole" row and the "acts autonomously" correction in
`docs/architecture.md` are rewritten to the shipped state. The unfixed
sibling (`tokenAmountUsd` fails open to $0 on a price-feed outage) stays
listed as open.

### Options weighed

| Option                                                | Verdict     | Why                                                                                                                                                                  |
| ----------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model asks "confirm?" and decides the user agreed     | ✗           | The model would be both proposer and judge; a prompt-injected "the user already confirmed" would pass.                                                               |
| Client confirm modal as the control                   | ✗ (UX only) | The agent path is server-signed; a client gate is bypassable. The modal is lane 060's rendering of the same server state.                                            |
| Server-minted id from the user's own words, pre-model | ✓           | The id exists only if the user's raw message confirms a pending preview; the model can echo it, not create it; single-use; args-hash bound; re-simulated for trades. |
| Gate x402 purchases too                               | ✗           | Owner directive; the agent's own pre-capped spend; a confirm per $0.01 lookup breaks the analyst loop.                                                               |
| Confirmation store in process memory only             | ✗           | One Vercel instance mints, another executes. Upstash when configured, with the memory fallback for dev/tests.                                                        |

### Success criteria

- [x] A money-moving tool call without a confirmation id is refused; with an invented id is refused; with this turn's id but a different tool or different arguments is refused; the id is consumed on first use whatever the outcome — A-026, A-031, A-033
- [x] "maybe", "looks good", "interesting", questions and negations never mint a confirmation — A-032
- [x] `mantua_simulate_trade` returns executable status, estimate, impact, fees, minimum received, resulting exposure, wallet-policy and market-policy results — A-009, A-025
- [x] Execution re-simulates and refuses on material change — A-030
- [x] `AGENT_MODE` disabled / simulation / user_testing / autonomous, server-side; simulation mode never executes even with a valid id; autonomous also needs the user's policy flag — A-028, A-029
- [x] LLM → structured tool call → gate → wallet policy + cap → tx construction → contract allowlist → chain, with the gate before the tool body — A-035
- [x] x402 `call_paid_service` passes the gate untouched (direct marketplace access) — D-114 §3
- [x] Stale `set_cap` "critical hole" doc corrected; C-010 verified — A-047
- [x] Route, prompt, client copy and architecture no longer describe the agent as acting without confirmation

### Tests

- `server/src/lib/agent/confirmation-language.test.ts` — accept/reject vectors.
- `server/src/lib/agent/trade-simulation.test.ts` — verdicts (closed market, balance, cap, paused, per-trade limit, league), sells uncapped, drift rules and tolerances.
- `server/src/lib/agent/confirmation-store.test.ts` — memory and fake-Redis backends: replace, expiry, single use, namespacing, `argsHash` canonicalisation.
- `server/src/lib/agent/execution-gate.test.ts` — mode table, money-call classification (x402 exempt), turn-context minting, every refusal code, drift refusal then success, simulation mode, autonomous mode.

### Left for later lanes

- ~~056~~ (landed) — `mantua_search_markets` / `mantua_get_market` / `mantua_get_position` / `mantua_get_portfolio` with market positions (A-020 … A-024), the A-019 separation doc.
- ~~057~~ (landed) — `agent_policies` writes and UI (A-003, A-012, A-038), D-109.
- ~~058~~ (landed) — prompt-injection sanitisation at the x402 / explorer / DefiLlama boundaries + adversarial tests (A-034, A-036).
- 059 — `sports_intelligence` / `mantua_analyze_market` (A-004, A-005, A-013, A-022), skills reset (A-001).
- 060 — preview + confirm cards, Daily Brief card, performance and funnel metrics (A-002, A-014, A-016, A-043, A-044).
- 061 — agent loop test through `runAgentChat` with the gate (A-017), audit action cleanup, the ledger's owner rows (A-045, A-046).
