# Task 064 — The Activity timeline and the chainless-branding sweep (Phase 9, PF-018/PF-019/PF-020 client half)

> Owner directive 2026-09-12 ("continue with phase 9"). Ledger:
> `docs/tasks/portfolio-activity.md`. Renders the spine lane 062 built.
>
> Gates: client typecheck ✅, lint ✅, **173 pass / 0 fail** (167 → 173); server
> untouched.

## Task description

The client had no activity surface at all — the only transaction list
was per-asset inside the asset detail panel — and three consumer files
named the explorer or hard-coded its URL, with no test to catch the
next one.

### What landed

**`client/src/features/activity/`**

- `activity-core.ts` (pure, tested): the wire shape of `GET /api/activity`,
  the category filters (All, Trades, Liquidity, Transfers, Agent,
  Settlements) and the server kinds each maps to, day grouping with
  Today / Yesterday labels, coarse relative time, status tone and label,
  and the card's meta line (amount · asset · value · "by your agent").
- `use-activity.ts`: cursor-paged fetch, re-fetched from the top when the
  wallet or the filter changes, "Load more" via `nextBefore`.
- `ActivityFeed.tsx`: filter chips, day sections, cards with an
  activity-specific icon (trade, liquidity, transfer, agent, settlement),
  a status chip (pending pulses), the summary, the meta line, the time,
  and the verification link through the neutral `TxRow` — the label reads
  "Explorer", never a chain or vendor name (PF-018).
- An **Activity** tab in the portfolio card (`AssetsCard.tsx`).

**Chainless-branding sweep** (`chainless-branding.test.ts`): scans the
consumer feature and shell sources with comments stripped for
`basescan.org`, `BaseScan`, `Etherscan`, `on Base`, `Base Sepolia`,
`Base Mainnet`; two carve-outs are listed in the test (the bridge's
destination chains, the deposit surface's network line). It failed on
first run against the hard-coded explorer URL in the agent chat's burn
card; that link now goes through `getExplorerTxUrl`, and four
explorer-naming comments were reworded for consistency.

### Options weighed

| Option                                            | Verdict | Why                                                                                                                   |
| ------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| Render the timeline from `portfolio_transactions` | ✗       | Five DeFi actions, successes only, no pending state, no agent research; the spine exists for this.                    |
| A standalone Activity page                        | ✗       | The spec calls Activity a portfolio/account surface; the portfolio card's tabs are where the user already looks.      |
| Hide tx hashes entirely                           | ✗       | PF-018 asks for verification without branding; the neutral tx row gives the hash, copy and an unbranded link.         |
| Lint rule instead of a sweep test                 | ✗       | The strings are prose, not syntax; a test with an explicit allowlist documents the carve-outs where they are decided. |

### Success criteria

- [x] Activity renders as a chronological card/timeline with icons, status, amount, timestamp and verification — PF-019
- [x] Agent entries show research / simulation / recommendation / trade / hedge / swap / liquidity / transfer through their kind and category — PF-020
- [x] Verification links carry no chain branding; a sweep test guards it — PF-018

### Tests

- `client/src/features/activity/activity-core.test.ts` — filters and kind query, grouping, relative time, meta line, status tone.
- `client/src/features/activity/chainless-branding.test.ts` — the sweep.
