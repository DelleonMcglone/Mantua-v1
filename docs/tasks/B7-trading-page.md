# Phase B7 — Trading Page

> Master: `docs/tasks/sports-pivot.md` — PHASE B7 (W3, 🔴 P0)
> Snapshot: 2026-09-03 · 2 ✅ · 4 ⏸ · 1 ⬜

## Success Criteria

- [ ] Split-screen trading: Swap modal left, Liquidity modal right, above the fold, side-by-side at ≥1024px (B7-001)
- [ ] Pool list renders full width directly beneath the split (B7-002)
- [ ] Swap handles market outcome tokens and base tokens (USDC / EURC / cbBTC) — buy AND sell, with one-click Close from positions (B7-003)
- [ ] Liquidity add/remove works on market pools and base pools (B7-004)
- [ ] Routing follows DM-112: market pools route direct to their own v4 stack; base pairs via the Trading API (`getV4StackForHook` resolves the Dynamic Market Hook to its own stack) (B7-005)
- [ ] Pool list columns: pair, hook badge, TVL, 24h volume, fee tier, market status (B7-006)
- [ ] Filter/sort by sport, league, market status, TVL, with responsive vertical collapse (B7-007)

## Failure Conditions

- A market outcome token routes through the base-pair Trading API path (DM-112 violation)
- A liquidity action succeeds against a market pool that is not deployed
- The split falls below the fold at desktop width, or the pool list renders beside rather than beneath it
- Sell is missing while buy exists — outcome tokens must be exitable both ways (B7-003)
- A shared quote/calldata builder resolves the wrong v4 stack for a hooked market pool (B7-005)

## Edge Cases

- Market pools not yet deployed: liquidity actions surface the gated state rather than erroring opaquely (B7-004)
- The market-status column joins the pool list only when markets exist (B7-006)
- B7-007 is deferred P2 — its absence is not a regression while the ⬜ stands
- Below 1024px the side-by-side split collapses vertically (B7-001)

## Checklist

- [x] B7-001 — Split-screen: Swap modal left, Liquidity modal right, above the fold
- [x] B7-002 — Pool list full width directly beneath the split
- [ ] B7-003 — Swap handles market outcome tokens and base tokens (USDC / EURC / cbBTC) ⏸
- [ ] B7-004 — Liquidity add/remove on market pools and base pools ⏸
- [ ] B7-005 — Routing split per DM-112 ⏸
- [ ] B7-006 — Pool list columns: pair, hook badge, TVL, 24h volume, fee tier, market status ⏸
- [ ] B7-007 — Filter/sort by sport, league, market status, TVL; responsive vertical collapse ⬜
