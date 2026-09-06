# 042 — Agent + hedging E2E (B10-005 / B10-006)

**Status:** ✅ done 2026-09-06
**Branch:** `042-agent-hedging-e2e`

The two remaining ⏸ E2E rows in Phase B10. Both are real end-to-end tests
that COMPOSE the shipped modules — one continuous journey per test where
each stage's output is the genuine input of the next — not unit re-tests of
individual links. The rule throughout: the shipped code runs for real; stubs
sit only at seams the code itself exposes for tests, and the code was not
changed to make anything pass (zero production-code edits in this task).

## B10-005 — Agent E2E (`server/src/lib/agent-e2e.test.ts`)

One journey plus three refusal legs, stage by stage:

| Stage | What runs for real | Assertion that proves it |
| ----- | ------------------ | ------------------------ |
| 1. NL → parse | `parseInstruction` (agent-nlp.ts, the P6-010 layer behind `POST /api/agent/instruction`), including its real `toIntent` mapping | "swap 25 USDC into EURC" → typed `{kind:"swap", tokenIn:"USDC", tokenOut:"EURC", amountIn:"25"}`; the model seam received the NL text as the user message with the `swap` tool on offer |
| 2. Preview | The parse payload IS the preview (the route is parser-only; the UI preview card renders the returned intent) | At preview time: zero cap checks, zero ledger ink, zero Circle polls, zero audit rows — nothing executed or spent |
| 3. Confirm gates execution | `createKillSwitchGate` (the real write-gate middleware), runtime flag via the real `createRuntimeKillSwitchFlag`/`parseKillSwitchFlagReply` path | Disengaged → the confirm POST passes (`next()`); engaged → 503 `KILL_SWITCH_ACTIVE` on both the parse POST and the confirm POST, with zero model calls and zero spend-seam calls |
| 4. Execute | `guardSpend` (C-019) wrapping the REAL `pollReceipt` state machine (circle/execute.ts) | Call order is exactly `check:25 → issue → record:25`; the poll walked QUEUED → SENT → CONFIRMED and only CONFIRMED resolved; `record` fired only after the confirmed receipt; ledger spent == 25 (the spend is recorded against the cap) |
| 5. Audit | `auditChatToolCall` (the seam the agent chat loop defers after every mutating tool call) → `logAudit` | One `agent_swap` success row with the acting wallet (lowercased), chain 8453, the parsed args, and `txHash` === the confirmed receipt's hash |

Refusal legs (same NL message, same composed chain):

- **Kill switch on** — refused at the gate with 503 before the model is
  consulted and before any spend seam is touched.
- **Cap exhausted** — `guardSpend` refuses at `check` (SafetyError
  `spending_cap_exceeded`), no issue, no record ink, Circle never polled;
  the failure is audited as a `failure` row with the cap reason.
- **SENT is not success** — a Circle transaction that broadcasts (hash at
  SENT) but never mines: the real `pollReceipt` times out
  (`CircleReceiptTimeoutError`, carrying the broadcast hash as
  pending-not-success), `record` never runs (no ink), and the audit row is a
  `failure` with no tx hash.

**Stubbed vs real.** Real: agent-nlp parse + intent mapping, guardSpend,
pollReceipt (the whole receipt state machine), the kill-switch middleware,
auditChatToolCall/logAudit. Stubbed, each at a seam the shipped code
exposes: the Anthropic client (`setAnthropicForTesting`), the daily-spend
ledger (`SpendGuardIo` running-ledger fake — check enforces against what
record accumulated, the unified-balance.test convention), the Circle
`TransactionFetcher` (the DI seam `pollReceipt` is parameterized on), the
drizzle `db.insert` entry point for audit-row capture (the agent-chat.test
convention), and pricing (the 25-USDC leg is priced 1:1; production uses
`tokenAmountUsdStrict`, which fails closed — covered by its own tests).

**Doc-vs-code differences (recorded honestly, code wins):**

- The B10-005 phrase "parse → preview → confirm" does NOT describe the agent
  chat loop: `agent-chat.ts` is explicitly autonomous ("There is NO
  per-action confirmation — the daily spending cap … is the guardrail").
  The shipped preview/confirm surface is the parse layer: `POST
  /api/agent/instruction` (and the command bar's `POST /api/command/parse`)
  return the intent for the client's preview card + confirmation modal, and
  execution is a separate write request. The E2E follows that shipped
  contract: parse produces the payload, and the "without confirm, nothing
  executes" property is proven as the zero-spend-seam invariant at preview
  time plus the write-gate on the confirm request.
- The NL→intent step is the model choosing a tool call, not a deterministic
  parser — so the E2E's "parse" stage is the tool-call dispatch: the stubbed
  model emits the tool call it would, and the real dispatch/mapping code
  runs (exactly the honesty note the task briefing asked for).
- `guardSpend` is the C-019 sequence itself; the chat `trade_market`/swap
  tools call `checkSpendingCap`/`recordSpending` directly in the same
  check → issue → record order (their ordering is covered by their own
  tests). The E2E exercises the sequence through `guardSpend`, the named
  seam for it.

## B10-006 — Hedging E2E (`server/src/lib/sports/hedging-e2e.test.ts`)

One journey over a single armed strategy (stages 1–4), plus the failure and
freeze legs over their own armed strategies in the same journey world:

| Stage | What runs for real | Assertion that proves it |
| ----- | ------------------ | ------------------------ |
| 1. Arm | `parseStrategyDraft` → `previewLines` → `strategyConfigSchema` → `armStrategy` (real store, real audit row) | "take profit at 80% on the chiefs market, cap $100" → draft (8000 bps, $100, "chiefs"); preview promises "Nothing arms until you confirm" and nothing is armed at preview time; the confirmed STRUCTURED config arms with `strategy_arm` audited |
| 2. Trigger | `ticksFromSlates` + `overlayPoolTicks` + `evaluateStrategy` via `processStrategy` — the real evaluation pipeline | Provider seed 6000 bps → `hold` (no claim, no cap-ledger contact); the pool's own price at 8500 bps ≥ 8000 → trigger, with the shipped reason string (`take-profit: implied 8500bps >= 8000bps`) in the audit trail |
| 3. Claim-once | The REAL `claimTriggered` guarded update, raced by two concurrent engine sweeps over shared row state | Exactly one sweep reports `executed`; the other reports `skipped` ("claim lost"); exactly ONE `strategy_trigger` audit row; one trade-leg call total |
| 4. Execute under cap | The real `executeTriggeredClose`: strategy-cap clamp, daily-cap check, then the trade leg resolved by the REAL `pollReceipt` | 250-YES balance clamped to 100 YES (`capUsd` $100); the daily cap saw the CLAMPED $100 for the agent wallet, BEFORE the trade (`cap-check` precedes `trade`); the close resolved only at CONFIRMED; `engineExecuted` wrote `strategy_execute/executed` with the confirmed tx hash; row ends `executed` with both timestamps |
| — Cap-exhausted leg | Same pipeline, ledger with zero headroom | `held` → released with `countAttempt:false`: row back to `armed`, `executeAttempts` still 0, zero trade calls (the shipped semantics: the daily cap resets at UTC midnight, so a cap-hold is retryable and never consumes an attempt) |
| 5. Failure honesty | Fetcher stuck at SENT (broadcast hash, never mined); real pollReceipt → timeout; real `engineRelease` retry bound | Each SENT-stuck sweep counts one attempt (1, 2 → released/armed; first `triggeredAt` survives re-claims per the store's COALESCE); the 3rd (`MAX_EXECUTE_ATTEMPTS`) auto-disarms with `disarmedReason: "execute-failed"` — the shipped failure state — and `strategy_auto_disarm` reason `execute-failed after 3 attempts … did not reach a terminal state`; zero `executed` audit rows ever |
| 6. Disarm on freeze | The real freeze signal the engine consults: `ticksFromSlates` marks `frozen` when `startsAt <= now` or status in_progress/final — the same timestamp-driven clock as the contract's kickoff freeze | An event past kickoff with the price at 9000 bps (way past take-profit) → `disarm market-frozen` BEFORE trigger evaluation: no claim (`triggeredAt` null), zero pool-price reads, zero trade calls, zero cap-ledger activity; the disarmed row leaves `listArmed` entirely, so a later trigger finds nothing to fire |

**Stubbed vs real.** Real: strategies.ts (evaluation), strategy-engine.ts
(orchestration incl. `overlayPoolTicks`), strategy-store.ts (arm, the
guarded claim/release/executed/disarm updates AND their audit rows),
strategy-execute.ts (clamp + cap + trade orchestration), strategy-parse.ts,
`pollReceipt`. Stubbed at exposed seams: an in-memory drizzle-shaped DB that
evaluates the store's OWN `where` conditions (conjunctions of `=`/`<>` over
drizzle's expression tree, plus the `coalesce(col, now())` set fragment)
against shared rows — so the claim-once property proven is the store's real
guarded-update semantics, not a scripted answer; the `ExecuteCloseDeps`
seams (YES-token `balanceOf`, a daily-cap ledger fake per the SpendGuardIo
convention, and `agentMarketTrade` — whose fake resolves through the real
`pollReceipt`, so receipt honesty is the shipped state machine); the
`PoolPriceReader` seam for pool prices; provider slates as fixtures (the
engine's real input shape, built exactly like `cron-strategies.ts` builds
its tick: `listArmed` → `ticksFromSlates` → `overlayPoolTicks` →
`processStrategy`).

**Doc-vs-code differences:** none of substance. Two clarifications the code
settled: (a) "executes under cap" means the strategy `capUsd` CLAMPS the
size (balance vs cap, smaller wins) while the wallet's daily cap gates the
leg — clamp first, then gate, per `strategy-execute.ts`; a daily-cap block
HOLDS (retryable, uncounted), it does not refuse-and-count. (b) The freeze
signal the engine consults is the slate-derived tick
(`ticksFromSlates`/`overlayPoolTicks`), timestamp-driven like the on-chain
freeze — there is no separate market-metrics read in the engine path.
Strategy closes are sells: the shipped path checks daily-cap headroom but
records no spend (proceeds come IN) — the E2E asserts what the code does.

## Bugs found

None. (No production semantics were changed; both E2Es pass against the
shipped code as-is.)

## Tests + gates

- New: `server/src/lib/agent-e2e.test.ts` (4 tests),
  `server/src/lib/sports/hedging-e2e.test.ts` (4 tests).
- Gates from the worktree root: `npm run typecheck --workspace server`,
  `npm run lint --workspace server`, stub-env `npm test -w @mantua/server` —
  **675 pass / 0 fail** (667 before this task; +8, all new — nothing
  existing touched).

## Files

- `server/src/lib/agent-e2e.test.ts` — B10-005 journey + refusal legs.
- `server/src/lib/sports/hedging-e2e.test.ts` — B10-006 journey + failure/
  freeze legs.
- `docs/tasks/B10-e2e-and-ship.md` — B10-005/B10-006 flipped to ✅ with
  evidence; snapshot 9 ✅ · 1 ⏸ (B10-010 Ship remains the only ⏸).
- `docs/tasks/sports-pivot.md` — the two Phase B10 rows flipped to ✅.
