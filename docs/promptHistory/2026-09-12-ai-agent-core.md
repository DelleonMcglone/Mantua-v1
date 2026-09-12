# Prompt History — AI Agent Core (Phase 8, task 055 onward)

**Date:** 2026-09-12
**Branch:** `claude/phase-8-agent-core` (stacked on `claude/xenodochial-hypatia-de2279`)
**Task:** Phase 8 A-001 … A-047; lane 055 (execution gate: modes, simulation, confirmation).

## Original prompt (owner)

> Now you have the complete task list, continue starting with phase 8.
> _(attached: Mantua Official Build Task List — Phase 8 "AI Agent Core
> (Circle Agent)", rows A-001 … A-047, two already ✅: A-018 agent E2E and
> A-042 hedging E2E)_

Mid-lane directives, in order:

> ensure the repo is currently up to date

> _(Circle email)_ … the platform default SCA version changes to
> `circle_6900_singleowner_v4` on September 14 … explicitly set the
> `scaConfiguration.scaCore` field to `circle_6900_singleowner_v3` in the
> Create Wallets API to preserve existing addresses …

> agent has direct access to x402 marketplace to buy data

## Refined prompt (as executed)

1. Survey the existing agent stack against every A-row (tool inventory,
   audit, confirmation seam, hedging engine, policies table, client
   surfaces, prompt-injection handling, env), then plan lanes by shared
   code.
2. **055 — the execution gate.** Replace "execute AUTONOMOUSLY" with a
   server-side protocol: `AGENT_MODE` (disabled / simulation /
   user_testing / autonomous); `mantua_simulate_trade` as the mandatory
   pre-trade check (executable status, estimate, impact, fees, minimum
   received, resulting exposure, wallet-policy and market-policy results);
   `mantua_preview_action` for every other money-moving tool; consent
   decided in code from the user's own message (hedges, questions and
   negations never confirm); a server-minted single-use confirmation id
   bound to the preview; execution refused on a missing, invented, reused,
   expired or mismatched id and on material drift of a fresh simulation.
   x402 paid data is exempt by owner directive — the agent's own
   pre-capped spend from its buyer wallet. Record as D-114; correct the
   stale A-047 doc rows; tests for every module and refusal code.
3. Pin the Circle SCA version at wallet creation (own commit) because
   Gateway spends rely on same-address-across-chains.

## Outcome

- Lane 055 landed: `server/src/lib/agent/` (five modules + four test
  files), wiring in `agent-chat.ts` / `routes/agent-chat.ts` / `env.ts`,
  D-114, task doc `docs/tasks/055-agent-execution-gate.md`, ledger
  `docs/tasks/ai-agent-core.md` (18 ✅ · 20 🟡 · 9 ⬜), runbook §12.
- Circle SCA pin: `CIRCLE_SCA_CORE` (default v3) at `createWallets`,
  runbook §11.
- Lane 056 landed: `mantua_search_markets` / `mantua_get_market` /
  `mantua_get_position` / `mantua_get_portfolio`, positions computation
  lifted to `lib/sports/market-positions.ts`, A-019 five-layer section;
  ledger 23 ✅ · 16 🟡 · 8 ⬜.
- Lane 057 landed: `lib/agent/policy.ts` (defaults, clamps, `hedgePolicyGate`),
  `GET/PATCH /api/agent/policy`, the hedge executor's per-user gate, the
  simulation's exposure ceiling, `mantua_get_policy`, the Portfolio → Agent
  policy panel, D-109; ledger 27 ✅ · 12 🟡 · 8 ⬜.
- Lane 058 landed: the untrusted-data boundary (`lib/agent/untrusted.ts`) in the
  tool loop + the A-036 adversarial suite; ledger 29 ✅ · 11 🟡 · 7 ⬜.
- Lane 059 landed: `sports_intelligence` (`lib/agent/sports-intelligence.ts` +
  `analyzeMarket`), `mantua_analyze_market`, the prompt's built-in skills list
  (A-001); ledger 34 ✅ · 9 🟡 · 4 ⬜.
- Next lanes: 058
  prompt-injection hardening; 059 `sports_intelligence`; 060 client cards
  - metrics; 061 loop test + cleanup.
