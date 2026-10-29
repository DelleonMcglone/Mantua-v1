# Task 078 — Agent trade recovery: a lost confirmation never fills twice

Owner request, 2026-10-29 (prompt history: `2026-10-29-agent-trade-recovery.md`).

The question was whether recovery checks the original transaction before
retrying when a trade submits but its confirmation is lost. For trades the
user signs it did (the pending register and `/api/markets/trade/status`).
For trades the agent places from chat it did not: the swap was never
persisted before the receipt wait, a 60-second poll timeout threw with
nothing on the ledger, the webhook finalizer saw an unknown execution and
only warned, and a retry minted a brand-new Circle transaction.

## Delivery

- **Pending before the wait.** The chat execute path now passes a ledger
  to `agentMarketTrade`, so the swap is persisted to `circle_executions`
  as `kind: "agent_trade"` at Circle-create time with the trade's identity
  (`providerEventId`, `outcomeIndex`, `direction`, `amountRaw`), the agent
  address, chain and confirmation id. `market-agent-trade.ts` adds the
  market id and the quoted output to every ledger payload and lets the
  caller name the audit action.
- **Finalization for the new kind** (`lib/circle/finalize-agent-trade.ts`):
  a confirmed buy records the spend, the timeline entry and the forecast
  "filled" row; a confirmed sell records the timeline entry; a reverted
  trade records only the audit failure. Whichever path wins the claim
  (poll or webhook) applies it exactly once — the chat path skips its own
  writes when the webhook finalized first.
- **Timeout is pending, not failure.** The execute tool returns
  `{ status: "pending", circleTxId, txHash }` with an instruction to tell
  the user the trade is still confirming and not to execute it again.
- **Duplicate guard** (`lib/sports/agent-trade-guard.ts`): before executing,
  the same trade submitted by the same agent wallet within the last ten
  minutes and still pending or already confirmed is refused with a typed
  `ExecutionRefusedError` (`DUPLICATE_PENDING` / `DUPLICATE_RECENT`) whose
  message the agent relays. A failed execution never blocks a retry.

## Tests

`agent-trade-guard.test.ts` (pure duplicate decision and copy),
`finalize-agent-trade.test.ts` (plans for buy, sell, revert, missing hash,
malformed payload, non-terminal state).

## Not changed

The user-signed path, strategy closes and combo trades (already durable).
The ten-minute window is a product choice — an identical add-to-position
inside it needs a different amount or a short wait.
