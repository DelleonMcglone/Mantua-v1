# Task 057 — Agent policies: the user's limits, enforced in code (Phase 8, A-003/A-012/A-038, D-109)

> Owner directive 2026-09-12 (Phase 8 🤖 AI Agent Core, "continue starting
> with phase 8"). Ledger: `docs/tasks/ai-agent-core.md`. Decision record:
> **D-109** in `docs/decisions/v2-open-decisions.md`.
>
> Gates: server typecheck ✅, lint ✅, **875 pass / 0 fail** (863 → 875); client
> typecheck ✅, lint ✅, 163 pass / 0 fail.

## Task description

`agent_policies` existed as a table nobody read or wrote. Phase 8 wants
user-defined policies (A-003), enforcement the agent cannot bypass
(A-012), and hedge policies with size, market, exposure, confidence,
cooldown and budget limits (A-038) — all independent of the LLM (A-041).

### What landed

**`server/src/lib/agent/policy.ts`** — one row per user, defaults when
absent, every value clamped by schema:

| Field                      | Default      | Enforced by                                                                                         |
| -------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| `status` active \| paused  | active       | Simulation blocker (A-025); hedge executor holds non-retryably; autonomous mode off when paused     |
| `autoTradeEnabled`         | false        | Turn context (`AGENT_MODE=autonomous` only)                                                         |
| `maxStakePerTradeUsd`      | 25           | Simulation blocker                                                                                  |
| `riskLevel`                | conservative | Prompt preset (read via `mantua_get_policy`)                                                        |
| `allowedLeagues`           | [] (all)     | Simulation blocker                                                                                  |
| `hedge.maxSizeUsd`         | 25           | Hedge executor clamp (below the strategy's own cap and the balance)                                 |
| `hedge.maxExposureUsd`     | 100          | Simulation blocker on buys (position after trade × effective price)                                 |
| `hedge.minConfidenceBps`   | 0            | Hedge executor hold (non-retryable) — mechanical triggers carry no confidence, so > 0 disables them |
| `hedge.cooldownMinutes`    | 0            | Hedge executor hold (retryable) from the user's last executed strategy                              |
| `hedge.dailyBudgetUsd`     | 100          | Hedge executor hold (retryable); today's executed hedges counted at their strategy caps             |
| `hedge.allowedMarketTypes` | [] (all)     | Hedge executor hold (non-retryable)                                                                 |

**Routes** — `GET /api/agent/policy`, `PATCH /api/agent/policy`
(`routes/agent-policy.ts`): the only write path, authenticated, write
rate-limited, audited as `agent_policy_update`.

**Agent** — `mantua_get_policy` (read-only); the simulation's policy
reader and the turn context's autonomous flag now come from
`readPolicy`; the simulation gains the exposure ceiling. There is no
write tool: a prompt cannot widen the limits (A-012).

**Hedge executor** — `executeTriggeredClose` runs `hedgePolicyGate`
after sizing and before the daily-cap ledger: paused / market type /
confidence hold non-retryably (the strategy stays `triggered`, recorded
for the dashboard); cooldown / budget hold retryably (the claim is
released, the cron re-fires); the size clamps to `hedge.maxSizeUsd`.
Injected through `ExecuteCloseDeps.hedgeContext` for tests.

**Client** — `AgentPolicyPanel` in Portfolio → Agent: active/paused,
max stake, risk level, leagues, unprompted-trades toggle, a summary of
the hedge limits. Optimistic save, revert on failure.

### Options weighed

| Option                                       | Verdict | Why                                                                                                                                       |
| -------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| An agent tool to edit the policy on request  | ✗       | A-012: the agent must not change its own caps. Consent-in-code for cap raises exists (C-010); widening limits by chat is the wrong shape. |
| Budget from receipts (exact USD moved today) | ✗       | Requires joining audit params per strategy on every tick; counting today's executed hedges at their caps is an honest upper bound.        |
| Enforce hedge limits in `evaluateStrategy`   | ✗       | Evaluation is pure over ticks; the limits need the user's history and wallet, which is the executor's context.                            |
| Store the hedge block as columns             | ✗       | The `config` jsonb was designed for exactly this; a typed zod schema over it keeps the migration count at zero.                           |

### Success criteria

- [x] The user can set status, per-trade stake, risk level, leagues, unprompted-trade permission and hedge limits; defaults apply without a row — A-003
- [x] The agent reads the policy and has no tool to change it; simulation and turn context enforce it — A-012
- [x] Hedge executions honor max size, permitted market types, max exposure (simulation), min confidence, cooldown, daily budget — A-038
- [x] Enforcement is code in the executor and the simulation, independent of the model — A-041
- [x] Policy writes are audited

### Tests

- `server/src/lib/agent/policy.test.ts` — view defaults and clamps, patch schema rejections, every gate branch (paused, market type, confidence, cooldown, budget, clamp).
- `server/src/routes/agent-policy.test.ts` — 400 envelope, in-range requests reach the lib.
- `server/src/lib/sports/strategy-execute.test.ts` — paused holds before the cap ledger; max size clamps below cap and balance.
- `server/src/lib/agent/trade-simulation.test.ts` — exposure ceiling blocks a buy.
