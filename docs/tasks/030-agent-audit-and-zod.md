# 030 — Chat-tool audit rows + cap-schema zod fix

**Status:** ✅ done 2026-09-05
**Branch:** `030-agent-audit-and-zod`

## Scope

Two safety follow-ups recorded in `024-cap-clamp-gateway-guard.md`:

1. Chat-tool executions wrote no `mantua_audit_log` rows — the same swap via
   `routes/agent-swap.ts` audits, but the identical action through
   `lib/agent-chat.ts`'s tool executor did not, so an incident
   reconstruction would miss every chat-driven action.
2. `routes/agent-wallets.ts`'s cap schema still permitted `dailyCapUsd: 0`
   (`.nonnegative()`), which the C-010 library clamp (`assertValidDailyCap`)
   now rejects — a `0` PATCH surfaced the raw clamp error instead of a 400.

## Fix 1 — audit rows for chat-driven mutating tool calls

`server/src/lib/agent-chat.ts` gains a single audit seam the chat loop
defers (fire-and-forget, `deferBackground`) after EVERY tool call, success
or throw:

- `auditActionForToolCall(name, args)` maps each MUTATING tool to an
  `AuditAction` consistent with its route/loop equivalent, and returns
  `null` for read-only tools (no row). The mixed read/write tools audit
  only their mutating sub-actions (`gateway` deposit/deposit_base/spend
  but not balance; `manage_wallet` set_cap but not info).
- `auditChatToolCall(entry)` writes one `logAudit` row: action per the map,
  outcome `success`/`failure` (failure rows carry the thrown tool error as
  `reason`), the agent wallet address, the active chain id, the result
  `txHash` when present, and `params: { tool, args }`. Args contain no
  secrets, but the serialized args are capped at 2 000 chars
  (`argsTruncated`) so a model can't ink unbounded json.
- An UNATTESTED cap raise (the C-010 structured refusal — returned, not
  thrown) is recorded as `rejected_other` with a reason, not as a success.

| Chat tool | Audit action | Notes |
| --- | --- | --- |
| swap | `agent_swap` | same as `routes/agent-swap.ts` |
| send | `agent_send` | same as `routes/agent-send.ts` |
| trade_market | `agent_market_trade` | new enum member (no prior audit anywhere) |
| bridge | `agent_bridge` | lib also audits; chat row records the tool boundary |
| gateway (deposit / deposit_base / spend) | `agent_gateway` | new enum member; `balance` writes no row |
| add_liquidity | `agent_add_liquidity` | same as `routes/agent-liquidity.ts` |
| remove_liquidity | `agent_remove_liquidity` | same as `routes/agent-liquidity.ts` |
| create_pool | `create_pool` | reuses `routes/pool-create.ts`'s action |
| create_job / fund_job / settle_job | `agent_commerce` | lib also audits; see bridge note |
| manage_wallet (set_cap) | `agent_wallet_cap_update` | unattested raise → `rejected_other` |
| read-only tools (get_portfolio, get_swap_quote, get_signals, get_market_data, inspect_*, …) | — | no row |

`db/schema/safety.ts`: `AuditAction` gains `agent_market_trade` and
`agent_gateway` (the only genuinely missing members; both fit the
`varchar(32)` column).

Known duplication, accepted: bridge/commerce (and x402, which is not in the
chat map) already audit inside their lib layer, so those chat calls produce
a lib row AND a chat row. The chat row is the tool boundary as the model saw
it (args + outcome); the lib row is the money movement.

## Fix 2 — cap schema `.positive()`

`routes/agent-wallets.ts`: `updateCapSchema` tightened from
`.nonnegative()` to `.positive()` (max `HARD_DAILY_CAP_USD` unchanged), so
`dailyCapUsd: 0` fails validation at the boundary with the standard
`{ error, code: "BAD_REQUEST", details }` envelope instead of reaching the
library clamp.

## Tests

- `server/src/lib/agent-chat.test.ts` — the tool→action map (mutating and
  read-only), one success row per mutating call (action/outcome/wallet/
  chain/txHash/params), failure row with reason on a thrown tool error, no
  row for read-only calls, gateway/trade_market/set_cap specifics, the
  `rejected_other` cap-raise refusal, and the params size cap. Seam-free
  style: `db.insert` stubbed to record rows, like `x402-buyer.test.ts`.
- `server/src/routes/agent-wallets.test.ts` — real router on an ephemeral
  express app (style of `x402-service.test.ts`): `dailyCapUsd: 0`, `-1`,
  and `50001` all 400 `BAD_REQUEST`; an in-range value gets past validation
  (reaches the lib layer, proven via a stubbed empty user lookup → 409).

## Gates

`npm run typecheck -w @mantua/server`, `npm run lint -w @mantua/server`,
and stub-env `npm test -w @mantua/server` (368 pass / 0 fail) all clean.
Root typecheck/lint fail only inside `client/` because this worktree's
`client/node_modules` symlink resolves to empty stub directories (client
deps not installed in the source checkout) — pre-existing and unrelated;
no client file is touched here.
