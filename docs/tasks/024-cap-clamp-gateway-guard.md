# 024 — Cap clamp + Gateway spend guard (C-010)

**Status:** ✅ done 2026-09-04
**Branch:** `024-cap-clamp-gateway-guard`

## Scope

Closes C-010 (safety rails wired to Circle wallets). The C-wave landed the
rails; two verified residual holes remained. Both are fixed here.

## Fix 1 — the `set_cap` self-raise hole

The safety audit's #1 finding: the agent-chat `manage_wallet` tool passed a
raw model-supplied number to `updateAgentWalletCap` with only a `typeof`
check — the agent could raise its own daily cap ($100 → $50,000) with no
user assent. Two layers now close it:

- **Library clamp (defense in depth)** —
  `server/src/lib/agent-wallet.ts`: `updateAgentWalletCap` now runs
  `assertValidDailyCap` before any write: finite, strictly positive,
  ≤ `HARD_DAILY_CAP_USD` ($50k, `lib/constants.ts`). Out-of-range values
  throw `InvalidDailyCapError`. The HTTP route keeps its zod bound
  (`routes/agent-wallets.ts`); this layer catches every caller that does
  not pass through it. Note: the route's zod schema still permits `0`
  (`nonnegative()`), which the clamp now rejects — a `dailyCapUsd: 0`
  PATCH surfaces the clamp error instead of writing a zero cap. Tightening
  the route schema to `.positive()` is a one-line follow-up outside this
  branch's ownership.
- **Tool-boundary attestation** — `server/src/lib/agent-chat.ts`
  (`manage_wallet` / `set_cap`): a cap **raise** is honored only when the
  user's CURRENT message itself attests it — same code-level mechanism as
  the swap `force` override (`lib/force-attestation.ts`). The new
  `messageAttestsCapRaise(message, newCapUsd)` (in `lib/agent-wallet.ts`)
  requires the message to (a) mention the cap/limit and (b) contain the
  exact new amount ("raise my daily cap to $500", "5k" shorthand OK).
  Lowering is always allowed. An unattested raise returns a structured
  refusal (`status: "cap_raise_rejected"` with current/requested amounts)
  telling the model to ask the user to confirm in their own words. The
  tool description tells the model about the contract up front.

## Fix 2 — the Gateway spend-recording gap

C-019's one exception: `spendUnifiedBalance`
(`server/src/lib/unified-balance.ts`) called `checkSpendingCap` for
third-party spends but never recorded them — N sequential spends each
passed a cap none of them consumed ("checks a counter it never
increments"). The path now routes through the same `guardSpend` sequence
(`lib/spending-cap.ts`: check → issue → record) as every other money path,
via a new exported seam `guardGatewaySpend`:

- recipient == agent's own address (case-insensitive): treasury move,
  bypasses the cap entirely — unchanged.
- recipient != self: `guardSpend` prices the spend (USDC ≈ USD, failing
  CLOSED on unparseable amounts), checks headroom, issues the burn via
  `kit.spend`, then inks the daily ledger — so the next spend sees this
  one's headroom reduction.
- The early read-only `checkSpendingCap` before delegate registration is
  kept so an over-cap spend still fails fast without registering a
  delegate.

## Tests

- `server/src/lib/agent-wallet.test.ts` — `assertValidDailyCap` bounds
  (accepts (0, $50k], rejects NaN/±Infinity/0/negative/above-ceiling) and
  `messageAttestsCapRaise` raise-vs-lower attestation paths (attested
  phrasings incl. `$`, thousands separators, decimals, `5k`; rejects
  generic consent, missing amount, amount outside cap context, mismatched
  amount, time-like tokens).
- `server/src/lib/unified-balance.test.ts` — `guardGatewaySpend` with a
  stateful ledger io (mocked like `spending-cap.test.ts`): proves the
  second spend sees the first spend's headroom reduction, check → issue →
  record ordering, self-recipient bypass, and fail-closed pricing.

## Rails verification (report-only)

| Rail | Where | Evidence |
| --- | --- | --- |
| Per-wallet caps on agent execution paths | lib layer, before each Circle execution | `agent-swap.ts:109/146`, `agent-send.ts:87/132`, `agent-bridge.ts:147/176`, `agent-liquidity.ts:255/310`, `agent-commerce.ts:197/215`, `agent-chat.ts` trade_market `1011/1020`, `sports/strategy-execute.ts:121`, `unified-balance.ts` (this branch) |
| Kill switch | `middleware/kill-switch.ts:138`, mounted `app.ts:65`; write methods + enumerated money crons (`/api/cron/rebalance,intents,strategies`) | every agent execution enters via a gated route (e.g. `routes/agent-chat.ts:28` POST) |
| Rate limiting on agent routes | `middleware/rate-limit.ts` limiters on every `routes/agent-*.ts` | e.g. `agent-chat.ts:30`, `agent-swap.ts:36/59`, `agent-send.ts:25`, `agent-unified-balance.ts:60/116`, `agent-wallets.ts`, `agent-portfolio.ts:13`, `agent-query.ts:38`, `agent-instruction.ts:26`, `agent-liquidity.ts:49/128` |
| Audit rows on agent actions | `lib/audit.ts` `logAudit` | routes `agent-swap/send/liquidity/wallets/instruction`, loops `agent-rebalance/intents/commerce/bridge`, `x402-buyer` |

**Residual observation (not fixed here):** chat-tool executions
(`POST /api/agent/chat` → `lib/agent-chat.ts` `executeTool`) do not write
`mantua_audit_log` rows — the same swap via `routes/agent-swap.ts` does.
Chat messages are persisted (`chat_messages`), but a chat-initiated swap
leaves no audit-ledger row. Worth its own task.
