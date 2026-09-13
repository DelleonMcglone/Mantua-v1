# Task 063 — Position economics: LP basis and P&L, potential payout, settled history (Phase 9, PF-002/PF-003/PF-007/PF-012)

> Owner directive 2026-09-12 ("continue with phase 9"). Ledger:
> `docs/tasks/portfolio-activity.md`. The server half of four surface rows;
> lane 065 renders them.
>
> Gates: server typecheck ✅, lint ✅, **913 pass / 0 fail** (907 → 913); client
> untouched.

## Task description

The portfolio marked positions live but could not answer the money
questions the spec lists: what an LP position cost, what it has earned,
what a market position pays if it wins, and what resolved markets
realized. Realized P&L existed for the agent only.

### What landed

**`server/src/lib/lp-economics.ts`** (pure, tested) — for one liquidity
position: current value at live prices (the on-chain amounts), accrued
fees, deposited basis (Σ USD of the add-liquidity ledger rows carrying
the position's tokenId), P&L and P&L %, and the pool share in bps when
the pool's liquidity is known. Unknowns are `null`, never zero: a
position Mantua did not open has no basis and says so; share is null
without pool liquidity. Totals count basis-less positions separately.

**`server/src/lib/agent/performance.ts`** — `readAgentPerformance` is
now `readWalletPerformance` (any address; the agent alias stays), plus
`settledHistory` (pure): resolved markets only, joined to their labels,
league, resolution time and whether the win was redeemed.

**`server/src/lib/sports/market-positions.ts`** — every position row
carries `potentialPayoutRaw` (par payout if the held side wins).

**Routes** (`routes/portfolio-economics.ts`, DI, tested):

- `GET /api/portfolio/economics` — `lp[]` with the fields above,
  `lpTotals`, and `realized` (market realized P&L, win rate, resolved
  count, open cost, trades by source, `lpCollectedUsd: null` — collected
  LP fees have no ledger yet and are not claimed).
- `GET /api/portfolio/settled` — `rows[]` (cost, proceeds, payout,
  realized P&L, tokens held, label, league, resolvedAt, redeemed) and
  the totals.

### Options weighed

| Option                                            | Verdict | Why                                                                                                                           |
| ------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Basis from current amounts × historical price     | ✗       | Fabricates a cost; the ledger recorded the USD value at deposit time and that is the basis.                                   |
| Claim realized LP earnings from accrued fees      | ✗       | Accrued is uncollected; the sweep collects on-chain with no ledger row yet — reported as null until a collect ledger exists.  |
| A second realized-P&L computation for users       | ✗       | The agent's `computePerformance` is address-scoped; one computation keeps the agent's number equal to the portfolio's.        |
| Pool share via a pool-id hash of the position key | ✓ later | Wired as an injectable `poolLiquidity` reader defaulting to null; the pool-key hash lands with the LP detail view (lane 065). |

### Success criteria

- [x] LP positions report deposited, current value, fees earned, P&L and share (share when pool liquidity is known) — PF-002 (server)
- [x] Market positions carry potential payout — PF-003 (server)
- [x] Realized market earnings and win rate are readable for the user's wallet — PF-007 (server)
- [x] Settled-position history with realized P&L and claim status — PF-012 (server)
- [x] Unknowns are null, never zero

### Tests

- `server/src/lib/lp-economics.test.ts` — valuation, basis, P&L, share, null rules, totals, ledger folding.
- `server/src/routes/portfolio-economics.test.ts` — both routes through the real router with faked readers.
- `server/src/lib/agent/performance.test.ts` — unchanged, still the arithmetic behind both.
