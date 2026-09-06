# 034 — B7 liquidity on market pools + pool-list columns (B7-004, B7-006, B7-007)

**Status:** ✅ done 2026-09-05 · **Branch:** `034-b7-liquidity-poollist`

Implements three B7 rows (docs/tasks/B7-trading-page.md), chain-agnostic per
D-112 — every contract reference resolves through the per-chain registries
(`MARKETS_BY_CHAIN` / `MARKETS_PERIPHERY_BY_CHAIN` / `DYNAMIC_MARKET_BY_CHAIN`),
which are empty until the launch-chain decision lands.

## B7-004 — liquidity add/remove on market pools and base pools

Audit finding: the remove stack was already key-addressed (currencies +
`hookAddress` → `getV4StackForHook`), but the add stack was symbol-addressed
(`tokenA`/`tokenB` registry symbols) — a market's YES token isn't a registry
symbol, so a market pool couldn't be expressed at all.

- `server/src/lib/market-pool-liquidity.ts` (new) — resolves a market pool
  for liquidity by game + outcome (the market-trade addressing convention):
  deployment gate → factory `marketOf` → `yesToken` → `planMarketPool` key →
  DM stack via `getV4StackForHook(dm.hook)`. Typed errors:
  `MarketLiquidityGatedError` (`MARKET_POOLS_NOT_DEPLOYED`) and
  `MarketLiquidityNotFoundError` (`NO_MARKET`). The gate runs BEFORE any RPC.
- `server/src/lib/v4-add-liquidity.ts` — refactored into a key-addressed core
  `buildAddLiquidityCalldataForKey` (exact PoolKey + amounts in currency
  order); the symbol wrapper delegates to it. `to` resolves through
  `getV4StackForHook(key.hooks)` — same DM-112 routing contract as remove.
- `POST /api/liquidity/add/calldata` — accepts a second body shape
  `{ market: { providerEventId, outcomeIndex }, amountYesRaw, amountUsdcRaw,
  … }` (schema `marketCalldataSchema`). Deployed path: slot0 via the DM
  StateView, calldata to the DM PositionManager, Permit2 batch against it.
  `POST /api/liquidity/add/record` accepts a `marketId`-keyed record variant
  (portfolio-transaction + audit only; no `pools`/`positions` rows exist for
  market pools).
- `POST /api/liquidity/remove/calldata` — optional `market` field; when
  present the route gates FIRST and then resolves by the DM hook (ignoring
  the client `hookAddress`), so an undeployed stack can never degrade into a
  "position not found" probe on the wrong PositionManager.
- **Gated state (named B7 failure condition):** with the registries empty,
  add and remove against a market pool return HTTP 409
  `{ code: "MARKET_POOLS_NOT_DEPLOYED", gated: true }` — never success,
  never an opaque error. A configured-but-unseeded pool returns
  `MARKET_POOL_NOT_LIVE` (also `gated: true`).
- Client: `AddLiquidityForm` ctx is now a union (`AddLiquidityContext`) —
  a market target renders `MarketAddLiquidityPanel.tsx` (new): gated state
  as a polite `role="status"` EmptyState + disabled CTA per B-016; a gated
  server response renders the same copy with `role="alert"`. Deployed mode:
  YES/USDC amount inputs → `useAddLiquidity.executeMarket` (approvals on the
  server-returned currency addresses, Permit2 multicall to the DM
  PositionManager). Entry points: market-pool rows in the pool list, or any
  route push of `{ kind: "add-liquidity", ctx: { market } }`.

Evidence: `server/src/lib/market-pool-liquidity.test.ts` (gate fires typed +
pre-RPC; fake DM deployment injected → key-addressed builder routes to the DM
PositionManager, no-hook key stays canonical),
`server/src/routes/liquidity-add.test.ts` (add → 409 gated; remove with
`market` → 409 gated; malformed market body → 400; base-pair path unchanged).

## B7-006 — pool list columns

- `GET /api/markets/pools` (new route `server/src/routes/market-pools.ts`,
  mounted in `app.ts`) — the pool↔market linkage: one row per market with a
  seeded pool (`markets.poolId` set), carrying lifecycle `state`, v4
  `poolId`, game/label context, and league/sport slugs. Returns
  `marketsDeployed` so the client gates without an RPC. Best-effort: DB
  failure → empty join, the list still renders.
- `LiquidityListPage.tsx` — columns now: Pool (pair + hook badge), TVL,
  Volume (24H), **Fee Tier** (promoted from the pair-cell subline to its own
  column), Fees (24H), APR, and **Market** (status badge Open / Frozen /
  Resolved / Settled / Void). The market column and the "Markets" category
  join ONLY when market pools exist (`showMarketStatusColumn`) — with no
  markets the column is absent, not empty (the B7-006 edge case; true today
  with the registries empty). Market rows link into the B7-004 add surface
  via `onSelectMarketPool` (wired in both App.tsx mounts).
- Pure join/label helpers in `market-pools.ts` + `use-market-pools.ts`
  fetch hook; tested in `market-pools.test.ts` (column absent on empty/null,
  lowercased poolId join, status label/tone mapping).

## B7-007 — filter/sort + responsive collapse (done, not deferred)

- Sort dropdown (TVL / Volume / APR, descending; header shows ↓ on the
  active metric) — always available.
- Sport / League / Status filter dropdowns — derived from live market rows
  and rendered only when market pools exist (dead filters are worse than the
  column's absent-not-empty rule). An active market filter narrows to
  matching market rows.
- All dropdowns use the SHARED `components/ui/dropdown-menu` primitive via
  one `FilterDropdown` helper — no second bespoke dropdown (the design
  wave's named failure mode).
- Responsive vertical collapse: the controls row wraps (`flex-wrap`), and
  below `md` the Fee Tier / Fees / APR columns fold away leaving
  Pool · TVL · Volume (· Market).

## Gates (all clean)

- `npm run typecheck` — clean, both workspaces.
- `npm run lint` — clean, 0 warnings.
- `npm test -w @mantua/server` (stub env) — 420 tests, 419 pass, 1 skipped
  (pre-existing), 0 fail.
- `npm test -w @mantua/client` — 124 pass, 0 fail.

## Out of scope / notes

- Market-pool TVL/volume aren't indexed yet — market rows show zeros there
  (like local pools) until an indexer lands.
- Remove-flow client UI needs no market wiring yet: market positions can't
  exist while the stack is gated; the server route already accepts and gates
  the `market` flag for when they can.
- Files owned by the sibling 033 branch (market-trade, SwapPanel, use-swap,
  AssetsCard, markets client features) untouched; `assertUsdcCollateral` is
  imported read-only from `lib/sports/market-trade-build.ts`.
