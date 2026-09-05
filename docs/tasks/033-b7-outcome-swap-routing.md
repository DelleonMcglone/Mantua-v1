# 033 — B7 outcome-token swaps + DM-112 routing split (B7-003 / B7-005)

**Status:** ✅ done 2026-09-05
**Branch:** `033-b7-outcome-swap-routing`

## Scope

Two B7 items from `docs/tasks/B7-trading-page.md`:

- **B7-003** — swap handles market outcome tokens AND base tokens, buy and
  sell, with one-click Close from positions. The failure condition "Sell is
  missing while buy exists" did not hold (sell already built end-to-end),
  but neither direction carried slippage protection **in the calldata** —
  the 031 principle. Both do now.
- **B7-005** — the DM-112 routing split made explicit and tested: one
  routing decision function, used by the market-trade builder and guarded
  in the token-swap route, with the B7 failure conditions as unit tests.

D-112 constraint respected: no new hardcoded chain assumptions — every new
code path keys off the existing per-chain config maps
(`MARKETS_BY_CHAIN` / `MARKETS_PERIPHERY_BY_CHAIN` /
`DYNAMIC_MARKET_BY_CHAIN` / the token registry).

## Routing table (DM-112)

Decided by `resolveSwapRoute(tokenIn, tokenOut, chainId)` in
`server/src/lib/swap-route.ts` — token **addresses** in, route out:

| Pair                                              | Route              | Stack + execution                                                                    | Entry points                                             |
| ------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| outcome (YES) token ↔ USDC (or anything)          | `market-pool`      | Dynamic Market PoolManager + market periphery PoolSwapTest (`getV4StackForHook`)      | `/api/markets/trade/calldata`, strategy executor, agent  |
| base pair — USDC / EURC / cbBTC, any combination  | `universal-router` | canonical PoolManager via UniversalRouter + Permit2 (task 031)                        | `/api/v4/swap/calldata`, agent swap                      |
| base pair, no-hook fallback                       | `universal-router` | Uniswap Trading API (`lib/uniswap.ts`) — documented fallback, same classification     | `/api/quote` + `/api/swap/calldata`                      |

Classification rule: both addresses in the chain's token registry ⇒
`universal-router`; anything else ⇒ `market-pool`. Outcome tokens are
minted per market by the MarketFactory and are never registry entries, so
the rule **fails safe**: a token the server cannot identify as a base token
can never reach the base-pair path (the B7 failure condition). The reverse
cross-over is blocked twice more:

- `buildMarketTrade` calls `assertSwapRoute("market-pool", input, output)`
  before quoting (throws `SwapRouteMismatchError` on a cross-over);
- `/api/v4/swap/calldata` refuses to encode a pool whose `PoolKey.hooks`
  is the Dynamic Market hook (`isMarketPoolHook` backstop) — a hooked
  market pool can never be built for the canonical UniversalRouter stack.

`getV4StackForHook` remains the single stack resolver: the DM hook address
resolves to the DM PoolManager + market periphery, everything else to the
canonical stack (pinned by test).

## What changed

- **`server/src/lib/swap-route.ts`** (new) — `resolveSwapRoute`,
  `assertSwapRoute` (+ `SwapRouteMismatchError`), `isMarketPoolHook`.
  Pure, config-driven, chain-agnostic.
- **`server/src/lib/sports/market-trade-build.ts`** —
  - `buildMarketTrade` takes optional `slippageBps` (default
    `DEFAULT_SLIPPAGE_BPS`, capped via `assertSlippageBounds`) and now
    encodes the slippage bound **into the calldata**: the market periphery
    router is v4-core's stock PoolSwapTest (no `amountOutMinimum` field),
    so the in-transaction lever is `SwapParams.sqrtPriceLimitX96`. The
    PoolManager will not execute past the bound; with exact-input
    semantics a pool that moved beyond tolerance yields a bounded partial
    fill (or nothing) and the unconsumed input stays with the sender.
  - `marketSwapSqrtPriceLimit` (pure) derives the bound: anchored on the
    trade's own projected landing price (2·p_eff − p_spot, integer Q192
    math + integer sqrt) so a healthy fill's own impact fits inside it,
    then shifted by ±slippageBps and clamped inside v4's legal range,
    strictly on the correct side of spot. `marketMinOut` (pure) computes
    the advisory quote-floor surfaced to the client. Both directions —
    buy and sell — get the identical protection. Fails closed if the
    pool's spot price can't be read (`readSlot0`).
  - `MarketsNotDeployedError` (typed) replaces the bare `Error` when
    `MARKETS_BY_CHAIN` / periphery / DM config is absent.
  - Response gains `sqrtPriceLimitX96` and `quote.amountOutMinimum`.
- **`server/src/lib/v4-onchain-swap.ts`** — `buildPoolSwapTestCalldata`
  accepts an optional `sqrtPriceLimitX96` (extremes remain the default
  for callers that enforce slippage elsewhere);
  `MIN_SQRT_PRICE_LIMIT`/`MAX_SQRT_PRICE_LIMIT` exported.
- **`server/src/routes/market-trade.ts`** — accepts `slippageBps`
  (0..`MAX_SLIPPAGE_BPS`, zod-capped like the 031 route); maps
  `MarketsNotDeployedError` → **503 `MARKETS_NOT_DEPLOYED`** (the B7 edge
  case: empty `MARKETS_BY_CHAIN` surfaces the gated state, never an
  opaque 502).
- **`server/src/routes/v4-swap.ts`** — the `isMarketPoolHook` backstop
  before `buildUniversalRouterSwap` (see routing table).
- **Client (B7-003 sell + one-click Close):**
  - `features/markets/market-trade-core.ts` (new, pure):
    `rawToHuman6` (digit-exact raw→human conversion — float division
    could round a full-balance sell above the wallet's holdings) and
    `closePositionDetail` (the Close deep-link payload for open YES rows).
  - `use-market-trade.ts` — quote type carries
    `amountOutMinimum`/`sqrtPriceLimitX96`; the pre-trade approval is now
    **bounded to the trade amount** (was MaxUint — the 031/C-022
    principle applied to the market router).
  - `LeaguePage.tsx` — sidebar accepts `initialAmount` (Close pre-fill),
    Max fills the exact raw balance, quote lines show the min-received
    floor, CTA reads "Sell" in sell mode; B-016 ARIA roles on the
    quoting/progress/result messages (`role="status"`), the error
    (`role="alert"`), and the CTA (`aria-live="polite"`). Explorer link
    now built via `getExplorerTxUrl` (chainless copy, D-112).
  - One-click **Close** from every positions surface: profile
    (`MarketPositionsSection`), the portfolio card
    (`AssetsCard` positions tab now renders the market positions section),
    and the market detail's Positions tab (`MarketDetail.tsx`). Each Close
    dispatches `mantua:close-position` with the raw balance; `App.tsx`
    routes to the league page with the sidebar on **Sell** pre-filled with
    the **full held balance**. MarketDetail's positions display also fixed
    to render the balance at 6dp (was showing raw units).

## Tests (node:test)

- `server/src/lib/swap-route.test.ts` — every registry pair (both
  directions) → `universal-router`; **an outcome token never routes
  through the base-pair path** (B7 failure condition, either side +
  outcome↔outcome); `assertSwapRoute` cross-over throws;
  `isMarketPoolHook` false-with-empty-config (graceful gating) and
  case-insensitive with an injected synthetic DM deployment;
  `getV4StackForHook` resolves the DM hook to the DM PoolManager +
  market periphery and **never the canonical stack** (B7-005 failure
  condition), zero address → canonical even with DM deployed.
- `server/src/lib/sports/market-trade-build.test.ts` — `marketMinOut`
  math + slippage cap; `marketSwapSqrtPriceLimit`: ~sqrt(1±slip) at zero
  impact, strict side-of-spot at slip=0, impact-anchoring
  (sqrt(0.98·0.995) case pinned), monotonic in tolerance, degenerate
  quotes fall to the direction's extreme, clamped in v4's range, rejects
  bad inputs; `buildMarketTrade` with empty config throws typed
  `MarketsNotDeployedError`.
- `server/src/routes/market-trade.test.ts` — 503 `MARKETS_NOT_DEPLOYED`
  while markets are undeployed (not an opaque 502); `slippageBps` >
  `MAX_SLIPPAGE_BPS` → 400 before any build work; exactly the cap passes
  validation; wallet still required (401).
- `client/src/features/markets/market-trade-core.test.ts` —
  `rawToHuman6` exact digits, round-trip at 6dp, no float round-up,
  rejects negatives; `closePositionDetail` open-YES-only gating.

## Verification (this worktree — no live RPC/signer)

- `npm run typecheck`, `npm run lint` — clean.
- Stub env `npm test -w @mantua/server` — 435 pass / 0 fail (1
  pre-existing skip). `npm test -w @mantua/client` — 122 pass.
- Not verifiable until the Base markets deployment lands: an actual
  market swap through the DM periphery PoolSwapTest with the new
  `sqrtPriceLimitX96` (both a full fill inside tolerance and a bounded
  partial fill when the pool is moved past it). The gating tests pin
  today's behavior; the fork rehearsal should exercise the bound the way
  031's did for the router min-out.
