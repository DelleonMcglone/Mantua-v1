# 035 — B9-005 execution engine: price + game-state ticks, capped execution

**Status:** ✅ done 2026-09-05
**Branch:** `035-b9-execution-engine`

## Scope

Closes B9-005 (`docs/tasks/B9-automated-hedging.md`): *"Execution engine:
evaluate on price and game-state ticks, execute inside the agent wallet's
policy caps."* The row was ⏸ because a large part of the engine already
shipped with B9-002/006/007 and C-015/C-019 — this task closes the gaps
that made the shipped engine unsafe to call done, and states the split
honestly below.

## Already shipped before this task (verified in code, not re-built)

- **Pure evaluation core** (`strategies.ts`): take-profit/stop and
  delta-hedge decisions with the B9-007 safety precedence (kill switch →
  expiry → freeze/resolution → only then triggers), and `ticksFromSlates`
  building **game-state ticks** — `frozen` on kickoff-time/`in_progress`/
  `final` (the same clock as the contract freeze), `resolved` on
  `final`/void, no ticks at all from a delayed slate.
- **Capped execute leg** (`strategy-execute.ts`): agent-wallet-only closes
  through the shared `agentMarketTrade` path (byte-identical to the user's
  button), sized as the agent balance **clamped by the strategy's own
  `capUsd`**, gated by the wallet's daily spending cap (C-019), and
  receipt-confirmed via the `circle_executions` durable ledger with the
  poll/webhook finalizer race (C-015).
- **Lifecycle + audit** (`strategy-store.ts`, B9-006): every transition
  writes a `mantua_audit_log` row; unparseable configs auto-disarm; the
  cron entrypoint (`cron-strategies.ts`) is cron-secret-gated and honors
  `STRATEGIES_KILL_SWITCH`.

## What this task added (the actual B9-005 delta)

1. **Price ticks now see the pool's own price** (`strategy-engine.ts:
   overlayPoolTicks`). The tick previously evaluated only the provider's
   line; once a pool trades, its price *is* the market (the board already
   knew this via `withLiveOdds` — the engine did not). The overlay reads
   `chainHomeProbabilityBps` per event (probing `LIVE_ODDS_CHAINS` in
   order — chain-agnostic per D-112), restricted to events that are still
   live and referenced by at least one armed strategy. Failure taxonomy is
   deliberate: **no pool → the provider seed stands** (it is the opening
   pool price by construction); **read failed → the price is dropped**
   so evaluation holds — nothing ever fires on a possibly-stale line.
2. **Concurrent-tick claim** (`claimTriggered`): armed→triggered is now an
   atomic guarded UPDATE (the agent-intents `executing` precedent) taken
   **before** any money moves; the claim loser skips execution entirely.
   Previously the trade executed while the row was still `armed`, so two
   overlapping crons could double-close one strategy.
3. **No stuck states, bounded retries** (`engineRelease` +
   `hedge_strategies.execute_attempts`, migration 0011): a close held by
   the daily cap used to land in `triggered` forever (the code comment
   promised a retry the sweep could never deliver). Now: cap-holds release
   the claim back to `armed` **without** counting an attempt (the cap
   resets at UTC midnight); failures release **with** a counted attempt
   and auto-disarm (`execute-failed`) at `MAX_EXECUTE_ATTEMPTS = 3`; an
   unexpected executor throw also releases (counted) instead of leaving
   the row claimed. Non-retryable waits — user-wallet position, no agent
   wallet, delta-hedge rebalance — stay `triggered` with a `held` audit
   row: recorded for the dashboard, the close is the user's to click
   (the B9 edge case).
4. **Timestamps exactly once**: `triggeredAt`/`executedAt` are COALESCEd so
   the first transition's time survives release/re-claim and the
   poll/webhook race; `engineExecuted` is guarded (`status != executed`)
   and audits only when its write actually won.
5. **Testable orchestration**: the per-strategy pipeline (parse →
   evaluate → claim → execute → settle/release) moved out of the route
   into `strategy-engine.ts` with injectable deps; `cron-strategies.ts` is
   now a thin loop that also isolates one strategy's infrastructure
   failure from the rest of the sweep.

## Explicitly still out of scope (unchanged posture)

- **Delta-hedge rebalance execution** stays recorded-and-waiting
  (`held`, non-retryable) — evaluation and band sizing shipped with
  B9-003; the multi-market rebalance trade itself is future work.
- **In-game (post-kickoff) strategies**: by design a strategy disarms at
  the freeze tick, so score-change ticks can never reach a live strategy;
  scores therefore do not feed evaluation.
- B9-008 market-maker mode stays deferred P3.

## Tests (all in the repo's injected-deps mock style)

- `strategies.test.ts`: trigger-crossing truth table per type (equality
  fires, one bp inside holds, tp-only never fires downward, stop-only
  never fires upward); `ticksFromSlates` game-state table (scheduled /
  kickoff-time / in_progress / final / void / delayed / missing price).
- `strategy-engine.test.ts`: pool-price overlay (replace + complement,
  seed-stands on no-pool, price-dropped on failed read, no reads for
  frozen/unreferenced events, no input mutation); claim-before-execute
  ordering; claim-lost → no execution; webhook-finalized → no second
  record; cap-hold releases uncounted; failure releases counted;
  retry-bound disarm; executor-throw releases; freeze/kill-switch/
  unparseable-config disarm with no claim (B9-007 still holds);
  `releaseDisposition` bounds.
- `strategy-execute.test.ts`: both caps bind — strategy cap clamps the
  leg before the daily cap sees it (tighter wins); held/retryable
  taxonomy (cap → retryable, user-wallet position / rebalance → not);
  failure surfaces the error for the engine's bounded retry; cap-ledger
  outage still rethrows (not a strategy decision).

Gates: `npm run typecheck`, `npm run lint`, stub-env
`npm test -w @mantua/server` (442 tests, 0 fail) — all clean.
