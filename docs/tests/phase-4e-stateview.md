# Phase 4e — StateView (live slot0)

This slice replaces the price-at-mint approximation with a live read of
`StateView.getSlot0` on Base mainnet. Two consumers:

- `POST /api/liquidity/remove/calldata` — server reads slot0 from the
  position's PoolKey before computing slippage bounds.
- `POST /api/liquidity/add/calldata` — `sqrtPriceX96` is now optional
  in the request; when omitted the server reads slot0. Pool-create
  flow keeps passing the freshly-initialized price to skip the RPC.

A read-only `GET /api/pool-state?tokenA=…&tokenB=…&fee=…` route is
exposed for clients that need to probe a pool's live state without
building calldata.

## Setup

Same as `phase-4-liquidity.md`, plus:

- Set `BASE_RPC_URL` in `server/.env` to a paid endpoint
  (Alchemy / QuickNode). The default `https://mainnet.base.org` is
  fine for dev but rate-limits aggressively.

## Live remove (live price)

After Phase 4d's "Add liquidity" step:

- [ ] Open **Positions** → **Remove** on the open position. Modal opens
      without the previous "no price reference" gate.
- [ ] Set 50% / 50 bps → **Remove** → confirm → wallet signs.
- [ ] Server log shows a single `eth_call` to `0xa3c0…7a71` (StateView)
      between request receipt and response.
- [ ] DB: `portfolio_transactions.params.isFullExit=false`. Position
      row's `liquidity` decremented.
- [ ] Move the price (run a swap on the same pool from another tab),
      then remove again. The new slippage bounds reflect the post-swap
      price — verify by inspecting `amount0Min/amount1Min` in the
      response.

## Pool-state probe

- [ ] `curl 'http://localhost:3001/api/pool-state?tokenA=ETH&tokenB=USDC&fee=500'`
      returns `{ exists: true, sqrtPriceX96, tick }` for a live pool.
- [ ] Same query against an uninitialized pair (e.g. `tokenA=LINK&tokenB=EURC`)
      returns `{ exists: false }`.
- [ ] Bad fee tier (e.g. `fee=123`) returns 400 with `BAD_REQUEST`.

## Add without client-supplied price

- [ ] On a Mantua-created pool, call
      `POST /api/liquidity/add/calldata` without `sqrtPriceX96` in the
      body — response includes `sqrtPriceX96` matching the on-chain
      slot0 and the rest of the calldata is unchanged.
- [ ] Same call against an uninitialized pool returns 400 with
      `POOL_NOT_INITIALIZED`.

## Existing-pool add UI (PoolDetailPage)

Built on top of the StateView server slice — `client/src/features/liquidity/defillama-translator.ts` maps a DefiLlama row to `{ tokenA, tokenB, fee }` and `use-pool-state.ts` probes `/api/pool-state` to confirm the v4 pool exists before enabling the button.

- [ ] Open **Liquidity** → click any DefiLlama-listed pool with both tokens in Mantua's supported set (e.g. `WETH-USDC` 0.05%). Detail page renders; Add button briefly shows "Checking pool…" then becomes enabled.
- [ ] Click **Add liquidity** → AddLiquidityForm opens with the correct tokens + fee tier. No `sqrtPriceX96` is sent to `/api/liquidity/add/calldata`; the server resolves it and echoes `sqrtPriceX96` in the response (verify via DevTools → Network).
- [ ] Approve & add → on success, navigate to **Positions** and confirm the new row.
- [ ] DB: `portfolio_transactions.params.sqrtPriceX96` is the server-resolved live price (matches the slot0 from `/api/pool-state` queried in step 1).
- [ ] Open a pool whose pair isn't in Mantua's supported tokens (e.g. an exotic pair). Add button stays disabled with hint "Pair not in Mantua's supported token set yet."
- [ ] Open a pool with a missing/odd `feeTier` value (DefiLlama returns `null` for some v2 pools). Add button stays disabled (same hint).
- [ ] Open a pool whose v4 equivalent isn't initialized — Add button disabled with hint "No v4 pool at this fee tier — create one from the Liquidity tab."
- [ ] Pool-create flow still works end-to-end: PoolCreateForm → AddLiquidityForm passes `sqrtPriceX96` from the create result, the server echoes it back, and no extra RPC round-trip is incurred (server log shows zero `eth_call` for the calldata route in that path).

## What this slice deliberately does NOT cover

- Permit2 batch approvals — still pending (next 4e slice).
- Subgraph indexing for pre-Mantua positions — still pending.
- "Create pool" CTA from the disabled-because-uninitialized state. Today the user has to navigate to **New pool** themselves; a one-click hand-off is a reasonable polish item but not load-bearing.
