# Phase B8 — Agent & Circle Agent Stack

> Master: `docs/tasks/sports-pivot.md` — PHASE B8 (W4, 🟠 P1)
> Snapshot: 2026-09-03 · 8 ✅ · 3 ⏸

## Success Criteria

- [ ] Circle Agent Wallets are verified against the DM-104 chain before any migration work starts (B8-001, DM-111)
- [ ] The Agent page is routed from the header with mode selection, funding UI, and a live activity log (B8-002)
- [ ] The intent parser handles `open_position`, `close_position`, `provide_liquidity`, `hedge`, `analyze_matchup`, `query_market`, with WNBA/NBA disambiguation (B8-003)
- [ ] Every confirmation modal is preceded by a structured preview card (B8-004)
- [ ] Agent actions cover open position, close position, add/remove market liquidity, and portfolio summary (B8-005)
- [ ] The contract allowlist is restricted to Mantua market contracts and pools, enforced inside both Circle execution paths (B8-006)
- [ ] The agent signs only with its own Circle developer-controlled wallet — the user's Privy keys never leave the client (B8-007)
- [ ] Matchup and market text entering LLM context is sanitized as data — control chars, angle brackets, length caps, https-only logos — and the analyst prompt frames slate strings as never-instructions (B8-008)
- [ ] The agent wallet is provisioned via the Circle Agent Stack and verified onchain (B8-009)
- [ ] Circle policies map onto the cap model: global limit and contract allowlist done; per-service caps and session TTLs tracked to completion (B8-010)
- [ ] The migration/coexistence plan vs the existing path is documented in `docs/architecture.md` — the current path IS Circle's wallet stack on Base, no migration (B8-011)

## Failure Conditions

- The agent can sign with, or move funds out of, the user's Privy wallet
- An execution path reaches a contract outside the allowlist
- Provider or market text inside LLM context is treated as instruction (prompt injection)
- The agent executes a trade without a balance or cap check, or without stating its quote and cost
- A Circle policy (global limit, per-service cap, contract allowlist, session TTL) is assumed enforced without being mapped to the cap model
- Migration work starts before Circle wallet support for the chain is verified (B8-001)

## Edge Cases

- Market contracts join the allowlist only at deploy; until then the list is tokens, v4 stacks, Permit2, and the commerce registry (B8-006)
- Analysis phrasing falls through to research rather than being forced into a trade intent (B8-003)
- The manual-trade sidebar is itself the structured preview for manual trades — side, amount, live quote, effective price, payout; the agent's equivalent lives in-conversation (B8-004)
- `getOrCreateAgentWallet` provisions the Circle DCW on Base and verifies onchain — the existing path already is the Circle stack per DM-111 (B8-009)

## Checklist

- [x] B8-001 — Verify Circle Agent Wallets support the DM-104 chain before migration work starts
- [x] B8-002 — Agent page: header "Agent" routes here; mode selection; funding UI; live activity log
- [x] B8-003 — Intent parser extension: `open_position`, `close_position`, `provide_liquidity`, `hedge`, `analyze_matchup`, `query_market`
- [ ] B8-004 — Structured preview card before every confirmation modal ⏸
- [ ] B8-005 — Agent actions: open position, close position, add/remove market liquidity, portfolio summary ⏸
- [x] B8-006 — Contract allowlist restricted to Mantua market contracts and pools
- [x] B8-007 — Agent never holds signing rights over the user's Privy wallet
- [x] B8-008 — Prompt-injection hardening: matchup and market text entering LLM context is data, not instruction
- [x] B8-009 — Provision agent wallet via Circle Agent Stack; verify onchain
- [ ] B8-010 — Map Circle policies (global limit, per-service cap, contract allowlist, session TTL) onto the existing cap model ⏸
- [x] B8-011 — Migration or coexistence plan vs. the existing path per DM-111; document in `docs/architecture.md`
