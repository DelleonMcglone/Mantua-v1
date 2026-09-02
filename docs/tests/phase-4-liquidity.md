# Phase 4 — Liquidity E2E Test Plan

P4-010. Run after `npm install` + Privy login + a funded wallet (small amounts of two supported tokens, e.g. 0.05 ETH and 200 USDC).

## Setup

1. `server/.env` populated with `UNISWAP_TRADING_API_KEY`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `DATABASE_URL` pointing to a real Postgres.
2. `client/.env.local` populated with `VITE_PRIVY_APP_ID`, `VITE_API_BASE_URL=http://localhost:3001`, `VITE_BASE_RPC_URL` (Alchemy / QuickNode recommended).
3. `npm run db:generate -w @mantua/server && npm run db:migrate -w @mantua/server`.
4. `npm run dev` at the root → Vite on `https://localhost:5173`, Express on `http://localhost:3001`.
5. Log in via Privy. Confirm header shows the wallet address.

## Phase 4a — Pool list + detail (P4-001 + P4-002)

- [ ] Switch to **Liquidity** tab — pool list loads from DefiLlama with TVL / Vol 24h / APY columns; sorted by TVL desc.
- [ ] Click any pool — detail page renders header (back arrow + symbol + fee tier), 4 stat cells (TVL, APY, Vol 24h, Vol 7d), chart, underlying-token BaseScan links.
- [ ] Toggle range (7D / 30D / 90D / 1Y / ALL) — chart re-fetches and re-renders smoothly.
- [ ] Toggle metric (TVL / APY) — chart switches series.
- [ ] Theme toggle in header — chart text/border colors flip with the rest of the UI.
- [ ] Click back arrow → returns to list.

## Phase 4b — Pool create (P4-003)

- [ ] **Liquidity → New pool** → form opens with default ETH/USDC, fee tier 0.05%, amounts 1 / 3600.
- [ ] Initial-price preview line shows `1 ETH = 3,600 USDC`.
- [ ] Switch to USDC/EURC → fee tier auto-defaults to 0.01% (stable/stable).
- [ ] Set ETH/cbBTC at 1 ETH / 0.05 cbBTC → click **Create pool** → confirmation modal opens with full description.
- [ ] Confirm → wallet popup signs `PoolManager.initialize` tx.
- [ ] Receipt: BaseScan link visible, button shows **Pool created**, plus a follow-up **"Add liquidity to this pool →"** button.
- [ ] DB: `pools` row inserted with the canonical `pool_key_hash`; `mantua_audit_log` entry with `action=create_pool`.
- [ ] Try the same pair+fee combination again — second attempt reverts on-chain (already initialized); UI shows the revert message.

## Phase 4c — Add liquidity (P4-004 + P4-005)

After create-pool success:

- [ ] Click **"Add liquidity to this pool →"** → AddLiquidityForm opens with locked tokens, default 0.1 / 360.
- [ ] Click **Add liquidity** → confirmation modal; click **Approve & add**.
- [ ] If USDC has no prior PositionManager allowance: wallet popup signs an approval tx first; status shows **"Checking token approvals…"**, receipt visible as a separate **Approval tx ↗** link.
- [ ] Then signs the modifyLiquidities tx; status shows **"Waiting for confirmation…"**.
- [ ] Receipt: BaseScan link, status **"Liquidity added"**.
- [ ] DB: `portfolio_transactions` row with `action=add_liquidity`, the swap params blob, `usd_value`, and the captured `tokenId`. `positions` row inserted with `token_id`, tick range, liquidity. `mantua_audit_log` entry.
- [ ] Set slippage to 200 bps → confirmation modal requires double-confirm.
- [ ] Set slippage to 600 bps → server returns 400 with `ADD_LIQUIDITY_INVALID`.

## Phase 4d — Remove liquidity (P4-006 → P4-008)

- [ ] Switch to **Positions** tab → see the position from the previous step. Row shows `ETH/USDC · 0.05% · token #N · liquidity X`, plus an "opened tx" BaseScan link.
- [ ] Click **Remove** → modal opens. Title shows `Remove liquidity · ETH/USDC`, subtitle shows `Token #N · liquidity X`.
- [ ] Default percentage 50%, slippage 50 bps. Click **Remove** → confirmation modal → **Remove**.
- [ ] Wallet popup signs the modifyLiquidities tx (DECREASE_LIQUIDITY + TAKE_PAIR). Receipt visible.
- [ ] DB: `portfolio_transactions` row with `action=remove_liquidity`, `params.isFullExit=false`. Position row's `liquidity` column decreased by 50% of original. `status` still `open`.
- [ ] Open the modal again, set percentage to **100%**. Confirmation modal shows `severity=warning`, button label is **"Burn position"**, doubleConfirm required.
- [ ] Confirm → wallet signs the BURN_POSITION + TAKE_PAIR tx. Receipt visible.
- [ ] DB: `portfolio_transactions` row with `params.isFullExit=true`. Position row's `status` flipped to `closed`, `closed_tx` populated.
- [ ] Positions list refreshes — the closed position is gone (we filter by `status=open`).

## Audit log spot-checks

After all four flows above:

\`\`\`sql
SELECT action, outcome, created_at
FROM mantua_audit_log
WHERE wallet_address = '<your wallet>'
ORDER BY created_at DESC
LIMIT 10;
\`\`\`

Expected: 4–6 rows including `create_pool/success`, `add_liquidity/success`, `remove_liquidity/success` (twice — partial then full).

## What this plan deliberately does NOT cover

- **Existing-pool add UI** — the server now accepts existing-pool adds (Phase 4e), but the LiquidityListPage's "Add" button is still gated until the DefiLlama → PoolKey translation lands (next follow-up).
- **Permit2 batch approvals** — Phase 4c uses regular ERC-20 approvals (max approval, one extra tx per token). A later Phase 4e slice migrates to Permit2 for one-tx UX.
- **Subgraph indexing** — `/api/positions` only lists positions opened via Mantua. Pre-existing on-chain positions require a v4 subgraph query.
- **Concentrated price ranges** — Phase 4c/d hardcode full-range. Custom tick selection lands when there's a real product need.
- **Real-time price for remove preview** — superseded by Phase 4e StateView; see `phase-4e-stateview.md`.
- **Hooked pool creation** — Phase 5 adds hook selection in PoolCreateForm.
