# Task 062 — The unified Activity spine (Phase 9, PF-014 … PF-017, PF-020, PF-021 server half)

> Owner directive 2026-09-12 ("continue with phase 9"). Ledger:
> `docs/tasks/portfolio-activity.md`. Decision record: **D-115** in
> `docs/decisions/v2-open-decisions.md`.
>
> Gates: server typecheck ✅, lint ✅, **907 pass / 0 fail** (899 → 907); client
> untouched.

## Task description

The task list assumed an inherited Activity system to preserve
(PF-014). The reconnaissance found the `activity` table created in
migration 0009 with **no writer and no reader**; the de-facto history
was `portfolio_transactions` (five DeFi actions, successes only) and the
compliance `mantua_audit_log`. Sports buys and sells landed only in
`market_fills`, redeems and settlements stamped `market_positions`,
hedges reached the audit log, fiat lived in `fiat_transfers`. Nothing
put them in one timeline.

### What landed

**Model** (`server/src/db/schema/activity.ts`, migration `0020_activity_spine`):
the table gains `status` (pending | completed | failed), `actor` (user |
agent | system), `chain_id`, `market_id`, `pool_id`, `position_ref`,
`asset`, `amount_raw`, `value_usd`, `updated_at`; `kind` widens; a
`(tx_hash, kind)` unique index makes replays and double finalization
write one row (PF-016).

**Writer** (`server/src/lib/activity.ts`): eighteen typed kinds —
market_buy, market_sell, redeem, settlement, swap, liquidity_add,
liquidity_remove, send, bridge, deposit, withdraw, gateway_deposit,
gateway_spend, hedge, agent_research, agent_simulation,
agent_recommendation, resolution — each with a category (trade,
liquidity, transfer, agent, settlement) for the timeline's icons
(PF-019, PF-020). `recordActivity` is best-effort and idempotent;
`transitionActivity` moves only `pending` rows, to completed or failed,
exactly once (PF-017); `kindForAction` maps the audit vocabulary;
`summarizeActivity` writes the one line the card shows.

**Fan-out** — every write site keeps its ledger row and adds a timeline
entry:

| Site                                                                                                 | Kind(s)                                                                             | Actor / status                          |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------- |
| `routes/market-fills.ts` (verified fill)                                                             | market_buy / market_sell                                                            | user, completed                         |
| `routes/market-redeem.ts` (verified redeem)                                                          | redeem                                                                              | user, completed                         |
| `routes/swap.ts`, `liquidity-add.ts`, `liquidity-remove.ts`                                          | swap, liquidity_add, liquidity_remove                                               | user, completed / failed by outcome     |
| `lib/agent-swap.ts`, `lib/agent-liquidity.ts`                                                        | swap, liquidity_add, liquidity_remove                                               | agent                                   |
| `lib/agent-chat.ts` — `mantua_execute_trade` / `_sell_position`                                      | market_buy / market_sell                                                            | agent                                   |
| `lib/agent-chat.ts` — `mantua_analyze_market`, `mantua_simulate_trade`                               | agent_research (+ agent_recommendation when an edge is suggested), agent_simulation | agent                                   |
| `lib/agent-chat.ts` — gateway, bridge                                                                | gateway_deposit / gateway_spend, bridge                                             | agent                                   |
| `lib/circle/finalize.ts` `recordPendingExecution` → `routes/circle-webhook.ts` / `lib/agent-send.ts` | send                                                                                | agent: **pending → completed / failed** |
| `lib/sports/strategy-store.ts` `engineExecuted`                                                      | hedge (linked to its strategy via `position_ref`)                                   | agent                                   |
| `lib/sports/markets-onchain.ts` `settleResolvedPositions`                                            | settlement (one per settled position)                                               | system                                  |
| `lib/fiat-store.ts` (Postgres store) terminal transition                                             | deposit / withdraw                                                                  | user, completed / failed                |

**Read** — `GET /api/activity` (`routes/activity.ts`): the user's id,
their connected wallet and their agent wallet in one feed, newest first,
cursor-paged (`before`), filterable by `kind` and `actor`; DTOs carry
the category and a numeric value. The client renders the verification
link from `txHash` with no chain branding (PF-018, lane 064).

### Options weighed

| Option                                             | Verdict | Why                                                                                                                                               |
| -------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Derive the timeline at read time from the ledgers  | ✗       | Seven tables with seven vocabularies and no pending state; a read-time union cannot represent "pending" or attribute a hedge to its position.     |
| Replace `portfolio_transactions`                   | ✗       | It backs `/api/portfolio` today; the spine is added beside it and a later lane can retire it once the portfolio reads activity.                   |
| Write activity from the audit log (trigger / tail) | ✗       | The audit log records attempts, including refused ones, with thirteen outcome strings; the timeline wants landed actions with one status machine. |
| Pending rows keyed by tx hash                      | ✗       | A Circle send has no hash until mined; pending is keyed by the Circle tx id and gains the hash on completion.                                     |

### Success criteria

- [x] One `activity` table records sports buys/sells, agent trades, agent hedges, liquidity add/remove, swaps, deposits, withdrawals, settlements and agent actions — PF-014, PF-015
- [x] Each entry carries tx hash, kind, asset/outcome, amount, value, timestamp, status, market/pool, user/agent attribution and related position — PF-016
- [x] Pending / Completed / Failed with a one-way machine, applied to Circle sends — PF-017
- [x] Agent activity says whether it was research, simulation, recommendation, trade, hedge, swap, liquidity or transfer — PF-020
- [x] A user trade, an agent trade, a hedge and a settlement each write an entry (server half of PF-021; the end-to-end test lands with lane 066)
- [x] `GET /api/activity` serves the feed

### Tests

- `server/src/lib/activity.test.ts` — kinds and categories, the audit-vocabulary map, the status machine, summaries.
- `server/src/routes/activity.test.ts` — the feed spans user id, user wallet and agent wallet; filters and cursor; unknown kind refused; DTO shape.
- Existing suites unchanged: every fan-out is best-effort and sits beside the ledger writes the suites already cover.
