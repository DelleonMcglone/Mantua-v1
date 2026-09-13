# Task 060 — Agent cards, Daily Brief, performance, funnel metrics (Phase 8, A-002/A-014/A-015/A-016/A-043/A-044)

> Owner directive 2026-09-12 (Phase 8 🤖 AI Agent Core, "continue starting
> with phase 8"). Ledger: `docs/tasks/ai-agent-core.md`. Decision records:
> D-114 (the confirm protocol the cards surface), D-109 (the policy the
> brief cites).
>
> Gates: server typecheck ✅, lint ✅, **894 pass / 0 fail** (891 → 894); client
> typecheck ✅, lint ✅, **167 pass / 0 fail** (163 → 167).

## Task description

The server side of the user-testing flow existed after task 055
(preview → the user's "confirm" → server-minted id → execution), but the
chat rendered simulations as raw JSON and the user had to type "confirm".
Phase 8 also asks for a Daily Brief card (A-014), performance tracking
(A-016), the Add Liquidity action (A-015), the minimum user-testing flow
end to end (A-043) and UX metrics (A-044).

### What landed

**Server**

- `lib/agent/performance.ts` — `computePerformance` (pure): per-market
  ledger from the agent's indexed fills and the markets' latest
  resolution — cost, proceeds, payout at par for the winning side (or a
  void refund), realized P&L, tokens held — and totals: wins / losses /
  voids, win rate, realized P&L, return on resolved cost, open cost at
  risk. `readAgentPerformance` feeds it from the database.
  `GET /api/agent/performance` and the `mantua_get_performance` tool.
- `mantua_daily_brief` — one structured read: wallet (USDC, cap, spent,
  remaining), open positions with mark and P&L, the track record, the
  policy's status and per-trade limit, and the live / upcoming markets
  worth a look from the canonical slate. The briefing workflow calls it
  first; the UI renders it as a card.
- **Funnel counters** (A-044) on the per-instance `Counters` already
  exposed by `/api/ops/metrics`: `agent.funnel.turn`, `.analyze`,
  `.simulate`, `.preview`, `.confirm_minted`, `.execute_ok`,
  `.refused.<code>`.

**Client**

- `features/agent/agent-cards.ts` — pure adapters (tested) from tool
  results to card rows: `simulationCard` (title, rows, blockers, whether
  Confirm may be offered), `analysisCard`, `dailyBriefCard`.
- `CircleAgentChat.tsx` cards for `mantua_simulate_trade` (the preview
  with a **Confirm trade** button), `mantua_preview_action` (Confirm),
  `mantua_execute_trade` / `mantua_sell_position` (success + tx),
  `mantua_analyze_market`, `mantua_daily_brief`, `mantua_get_performance`,
  `mantua_get_portfolio`, `mantua_search_markets`. The Confirm button
  sends the literal message "confirm" through the same path as typing —
  the user's own message remains the only consent the server reads
  (D-114). An **Add Liquidity** chip joins the action surface.

### The A-043 minimum flow, end to end

Find NFL market (`mantua_search_markets` card) → Analyze
(`mantua_analyze_market` card) → Request $10 YES → Preview
(`mantua_simulate_trade` card) → **Confirm** (button or typed) → Execute
(`mantua_execute_trade` success card with the tx) → Result
(`mantua_get_position` / portfolio). Every step is a typed tool result
the UI renders; every money movement is the server's decision.

### Options weighed

| Option                                        | Verdict | Why                                                                                                                                |
| --------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A dedicated confirm endpoint the button calls | ✗       | Would create a second consent channel; the button sending "confirm" keeps one rule (the user's message) and one audit shape.       |
| Client-side P&L from positions                | ✗       | Realized P&L needs fills + resolutions; the server has both and the number must match the portfolio's.                             |
| Product analytics vendor for the funnel       | ✗ (now) | Owner-gated vendor choice (TD-007 class); the counters are already on the ops endpoint and the alert policy can read them.         |
| A separate Daily Brief endpoint               | ✗       | The brief is the agent's own read; as a tool it can be composed into the narrated workflow and rendered as a card from the stream. |

### Success criteria

- [x] Trade, Swap, Add Liquidity, Send, Daily Brief and Create/Manage Agent are one-click actions in the chat — A-002, A-015
- [x] The Daily Brief renders as a card with wallet, positions, track record, policy and the markets worth a look — A-014
- [x] Realized P&L, win rate and a per-market ledger are available to the user and the agent — A-016
- [x] The minimum flow runs end to end with a Confirm button that carries the user's own consent — A-043
- [x] Funnel metrics count turns, analyses, simulations, previews, confirmations, executions and refusals — A-044

### Tests

- `server/src/lib/agent/performance.test.ts` — win / loss / void / open ledgers and totals, empty state, latest-resolution rule, no negative holdings.
- `client/src/features/agent/agent-cards.test.ts` — preview rows and confirm gating, analysis headline and action, brief rows.
