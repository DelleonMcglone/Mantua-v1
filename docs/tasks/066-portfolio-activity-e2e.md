# Task 066 — End-to-end: portfolio and activity composed, valuation decided (Phase 9, PF-011/PF-013/PF-021)

> Owner directive 2026-09-12 ("continue with phase 9"). Ledger:
> `docs/tasks/portfolio-activity.md`. Decision record: **D-116** in
> `docs/decisions/v2-open-decisions.md`.
>
> Gates: server typecheck ✅, lint ✅, **920 pass / 0 fail** (913 → 920); client
> typecheck ✅, lint ✅, **184 pass / 0 fail** (178 → 184).

## Task description

The last three rows: prove the surfaces compose over one real user, prove
the timeline receives every kind of money movement through the shipped
writers, and decide how assets are valued.

### What landed

**PF-021 — `server/src/lib/activity-e2e.test.ts`.** One in-memory store
that speaks the drizzle chains the writers use, driven through the REAL
code: the fills router records a verified user trade → `market_buy`;
the agent's trade writer → `market_buy` by the agent; `engineExecuted`
→ `hedge` linked to its strategy; `settleResolvedPositions` → one
`settlement` per settled position; the send writer (what `recordPendingExecution`
calls) → a `pending` send that the finalizer's transition moves to
`completed` with its hash, exactly once. The feed then lists all five in order.

**PF-013 — `client/src/features/portfolio/portfolio-e2e.test.ts`.** One
user with assets, an LP position, market positions, an active agent and
a hedge, expressed in the routes' exact wire shapes (typed against the
hooks): the holdings aggregate counts five sources, the LP economics
carry basis / fees / P&L / share, market positions group by game with
payout for both the user and the agent, the executed strategy resolves
to its hedge entry, settled history shows the realized result and claim
status, and the timeline carries the trade, the hedge and the
settlement.

**PF-011 — valuation (D-116).** Market positions are marked at the live
pool price; assets are priced Pyth-first with a DefiLlama fallback until
Phase 13's CoinGecko migration; the lenient `$0` fallback is no longer
silent — it counts `pricing.fallback_zero`, logs, and raises the
`pricing_zero` alert (warn) on `/api/ops/alerts`. Cap enforcement keeps
the strict, fail-closed helpers. The stale "CoinGecko" comment on the
portfolio history builder now names the actual feed.

### Options weighed

| Option                                          | Verdict  | Why                                                                                                                   |
| ----------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| Browser end-to-end for the portfolio            | ✗ (L-01) | Playwright is Phase 10's launch-gate suite; the composition here proves the data contract, which is what drifts.      |
| Make the pricing fallback fail closed for reads | ✗        | A dead feed would blank the portfolio; a visible $0 with an alert degrades honestly (C-019 keeps enforcement strict). |
| Switch to CoinGecko now                         | ✗        | AN-001 (paid plan, key) is a Phase 13 owner decision; D-116 records the current sources and the migration path.       |

### Success criteria

- [x] Every section renders real data for a user with assets + LP + market positions + an active agent + a hedge — PF-013
- [x] User trade → activity; agent trade → activity; hedge → activity; settle → settlement — PF-021
- [x] Live prices everywhere, never hardcoded; a zero valuation is observable — PF-011

### Tests

- `server/src/lib/activity-e2e.test.ts` — the five legs and the feed.
- `client/src/features/portfolio/portfolio-e2e.test.ts` — the composed user.
- `server/src/lib/alerts.test.ts` — the `pricing_zero` alert.
