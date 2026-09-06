# Phase B7 — Trading Page

> Master: `docs/tasks/sports-pivot.md` — PHASE B7 (W3, 🔴 P0)
> Snapshot: 2026-09-05 · 7 ✅
> Snapshot: 2026-09-05 · 5 ✅ · 2 ⏸

## Success Criteria

- [ ] Split-screen trading: Swap modal left, Liquidity modal right, above the fold, side-by-side at ≥1024px (B7-001)
- [ ] Pool list renders full width directly beneath the split (B7-002)
- [x] Swap handles market outcome tokens and base tokens (USDC / EURC / cbBTC) — buy AND sell, with one-click Close from positions (B7-003)
- [x] Liquidity add/remove works on market pools and base pools (B7-004)
- [x] Routing follows DM-112: market pools route direct to their own v4 stack; base pairs via the Trading API (`getV4StackForHook` resolves the Dynamic Market Hook to its own stack) (B7-005)
- [x] Pool list columns: pair, hook badge, TVL, 24h volume, fee tier, market status (B7-006)
- [x] Filter/sort by sport, league, market status, TVL, with responsive vertical collapse (B7-007)

## Failure Conditions

- A market outcome token routes through the base-pair Trading API path (DM-112 violation)
- A liquidity action succeeds against a market pool that is not deployed
- The split falls below the fold at desktop width, or the pool list renders beside rather than beneath it
- Sell is missing while buy exists — outcome tokens must be exitable both ways (B7-003)
- A shared quote/calldata builder resolves the wrong v4 stack for a hooked market pool (B7-005)

## Edge Cases

- Market pools not yet deployed: liquidity actions surface the gated state rather than erroring opaquely (B7-004)
- The market-status column joins the pool list only when markets exist (B7-006)
- B7-007 was deferred P2; shipped 2026-09-05 — the sport/league/status filters render only while market pools exist (mirroring the B7-006 column rule)
- Below 1024px the side-by-side split collapses vertically (B7-001)

## Checklist

- [x] B7-001 — Split-screen: Swap modal left, Liquidity modal right, above the fold
- [x] B7-002 — Pool list full width directly beneath the split
- [x] B7-003 — Swap handles market outcome tokens and base tokens (USDC / EURC / cbBTC) — buy + sell both carry the slippage bound in the calldata (`marketSwapSqrtPriceLimit` → PoolSwapTest `sqrtPriceLimitX96`), and one-click Close pre-fills a full-balance sell from every positions surface (task 033)
- [x] B7-004 — Liquidity add/remove on market pools and base pools — market pools addressed by game+outcome through `/api/liquidity/add|remove/calldata`; key-addressed add builder + resolver route via `getV4StackForHook` to the DM stack (DM-112); undeployed stack → structured 409 `MARKET_POOLS_NOT_DEPLOYED`/`gated: true` (pinned by `lib/market-pool-liquidity.test.ts`, `routes/liquidity-add.test.ts`); client gate per B-016 in `MarketAddLiquidityPanel`. See docs/tasks/034-b7-liquidity-poollist.md
- [x] B7-005 — Routing split per DM-112 — `resolveSwapRoute` in `lib/swap-route.ts` decides market-pool vs universal-router (Trading API stays the no-hook base-pair fallback per 031); both failure conditions pinned by tests in `swap-route.test.ts` (task 033)
- [x] B7-006 — Pool list columns: pair, hook badge, TVL, 24h volume, fee tier, market status — fee tier promoted to its own column; market-status badge joins from new `GET /api/markets/pools` (markets carry poolId) ONLY when markets exist — absent, not empty, with none deployed (pinned by `market-pools.test.ts`). See docs/tasks/034-b7-liquidity-poollist.md
- [x] B7-007 — Filter/sort by sport, league, market status, TVL; responsive vertical collapse — sort dropdown (TVL/Volume/APR) always; sport/league/status dropdowns join only when market pools exist; all on the shared `components/ui/dropdown-menu` primitive (no bespoke dropdown); controls row wraps and fee/fees/APR columns fold below `md`. See docs/tasks/034-b7-liquidity-poollist.md
