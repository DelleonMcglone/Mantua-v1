# Phase B1 — Market Primitives

> Master: `docs/tasks/sports-pivot.md` — PHASE B1 (W1–W2, 🔴 P0)
> Snapshot: 2026-09-03 · 10 ✅

## Success Criteria

- [ ] `MarketFactory.sol` deploys a purpose-built YES/NO ERC-20 pair per market, USDC-collateralised 1:1 (B1-001, DM-102)
- [ ] `split`: 1 USDC in → 1 YES + 1 NO out; `merge`: 1 YES + 1 NO in → 1 USDC out; `redeem`: winning token 1:1 for USDC, losing token zero (B1-002, B1-003, B1-004)
- [ ] State machine `OPEN → FROZEN → RESOLVED → SETTLED`, plus `INVALID` for postponed/abandoned games (B1-005)
- [ ] Outcome tokens use the shared decimals utility and inherit the collateral's 6-decimal USDC scale (B1-006)
- [ ] Foundry tests prove split/merge round-trip, collateral solvency invariant, resolve-before-freeze rejection, and double-redeem rejection (B1-007)
- [ ] Fuzz harness holds the invariant: collateral can never fall below outstanding redeemable supply (B1-008)
- [ ] The YES/USDC v4 pool opens at market creation, seeded at the opening implied probability, with the hook slot taking `address(0)` until the Dynamic Market Hook lands (B1-009)
- [ ] One shared price ↔ probability module serves contracts-adjacent code, the UI, and the agent (B1-010, DM-101)

## Failure Conditions

- Collateral ever falls below outstanding redeemable supply — the invariant or fuzz catch fires
- A market resolves, or a position redeems, before the market is frozen
- A second redeem on the same position succeeds
- Split, merge, or redeem tests are red — the W1 gate is "split/merge/redeem tests green"
- A second price ↔ probability conversion appears outside the shared module
- A market pool seeds at anything other than the opening implied probability

## Edge Cases

- `INVALID` markets (postponed/abandoned): both sides redeem at cost — a distinct terminal path from a resolved winner (B1-005)
- Pools bootstrap with hook slot `address(0)` and must accept the Dynamic Market Hook later without reseeding (B1-009, B2-005)
- 6-decimal USDC vs probability bps: rounding stays inside the shared utility, never ad hoc at call sites (B1-006, B1-010)
- `redeemInvalid` is the cost-recovery path for voided games and pays regardless of which side would have won (B1-004)

## Checklist

- [x] B1-001 — `MarketFactory.sol` deploys a YES/NO ERC-20 pair per market, USDC-collateralised 1:1
- [x] B1-002 — `split(usdcAmount)`: 1 USDC in → 1 YES + 1 NO out
- [x] B1-003 — `merge(setAmount)`: 1 YES + 1 NO in → 1 USDC out
- [x] B1-004 — `redeem()`: winning token 1:1 for USDC, losing token zero
- [x] B1-005 — State machine `OPEN → FROZEN → RESOLVED → SETTLED`, plus `INVALID` for postponed/abandoned games
- [x] B1-006 — Outcome tokens use the shared decimals utility
- [x] B1-007 — Foundry tests: split/merge round-trip, collateral solvency invariant, resolve-before-freeze rejection, double-redeem rejection
- [x] B1-008 — Fuzz harness: collateral can never fall below outstanding redeemable supply
- [x] B1-009 — Pool bootstrap: open the YES/USDC v4 pool at market creation, seeded at opening implied probability
- [x] B1-010 — Price ↔ probability util: one shared module for contracts-adjacent code, UI, and agent
