# Task 065 — The portfolio surfaces (Phase 9, PF-001 … PF-005, PF-007 … PF-010, PF-012 client half)

> Owner directive 2026-09-12 ("continue with phase 9"). Ledger:
> `docs/tasks/portfolio-activity.md`. Renders what lanes 062 and 063
> compute.
>
> Gates: client typecheck ✅, lint ✅, **178 pass / 0 fail** (173 → 178); server
> untouched.

## Task description

The ten portfolio surfaces from the spec, on the portfolio card and the
profile page, fed only by server computations — no client arithmetic
over prices, no placeholders.

### What landed

**`portfolio-core.ts`** (pure, tested): market positions grouped by game
with summed value and payout, the per-position payout line, the
cross-account holdings aggregate (with the sources that could not be
read named rather than counted as zero), and the settled-history lines.

**Hooks**: `use-market-positions` (any address — the user's or the
agent's), `use-portfolio-economics` (economics + settled).

| Surface                            | Where                           | What it shows                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §1 Assets (PF-001)                 | Assets tab header               | "Everything you hold": wallet + agent wallet + unified balance + market positions + liquidity, with a "not counted" note for any source that failed to load                                            |
| §2 / §9 Liquidity (PF-002, PF-009) | Positions tab + profile         | `LpEconomicsSection`: per position deposited, value, fees, P&L (%), share; totals; positions without a basis counted separately                                                                        |
| §3 Market positions (PF-003)       | Positions tab + profile         | grouped by game with league, group value and "pays up to"; each row: side, tokens, mark, entry, unrealized P&L, "pays $X if it wins", Close                                                            |
| §4 Agent (PF-004)                  | Agent tab                       | `AgentStatusStrip`: Active / Paused, per-trade ceiling, leagues, unprompted-trades permission, track record (realized P&L, win rate, open at risk); the policy panel; recent actions from the timeline |
| §5 Agent positions (PF-005)        | Agent tab                       | the agent wallet's market positions (same section, agent address) + LP positions                                                                                                                       |
| §6 Unified balance (PF-006)        | Unified tab                     | unchanged (C-008)                                                                                                                                                                                      |
| §7 Earnings (PF-007)               | Earnings tab + economics footer | accrued LP fees (B6) + "Markets realized" P&L / win rate; LP fees collected stated as not tracked                                                                                                      |
| §8 User wallet (PF-008)            | Profile + Activity tab          | wallet, assets, and the timeline as the transaction record                                                                                                                                             |
| §10 Hedging (PF-010)               | Strategies section              | each executed strategy shows its hedge entry: value and market                                                                                                                                         |
| Settled history (PF-012)           | Positions tab + profile         | `SettledPositionsSection`: W/L/void, cost · sold · paid · realized, claimed / claimable                                                                                                                |

### Options weighed

| Option                                             | Verdict | Why                                                                                                        |
| -------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| Compute the holdings total client-side from prices | ✗       | Every USD figure comes from a server read; the client only sums what the server valued.                    |
| Hide sources that failed to load                   | ✗       | A silently smaller total is a wrong total; "not counted: …" says what is missing.                          |
| A separate agent-positions endpoint                | ✗       | `GET /api/markets/positions?address=` already serves any address; the section takes the agent's.           |
| Hedge values from the strategies route             | ✗       | The timeline entry (062) already links each hedge to its strategy with its value; one read, no new column. |

### Success criteria

- [x] Every spec surface (§1 – §10) renders from real server data — PF-001 … PF-010
- [x] Settled history renders with realized P&L and claim status — PF-012
- [x] Unknowns read as "unknown" / "not counted", never as zero

### Tests

- `client/src/features/portfolio/portfolio-core.test.ts` — grouping, payout line, holdings aggregate and missing sources, USD summing, settled lines.
