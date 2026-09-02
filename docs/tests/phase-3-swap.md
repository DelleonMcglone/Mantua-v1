# Phase 3 — Swap Core E2E Test Plan

P3-008. Run after `npm install` + Privy login + at least small balances funded on the test wallet.

## Setup

1. `server/.env` populated with `UNISWAP_TRADING_API_KEY`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `DATABASE_URL` pointing to a real Postgres (Neon dev branch is fine).
2. `client/.env.local` populated with `VITE_PRIVY_APP_ID`, `VITE_API_BASE_URL=http://localhost:3001`, `VITE_BASE_RPC_URL` (Alchemy / QuickNode recommended).
3. `npm run db:generate -w @mantua/server && npm run db:migrate -w @mantua/server` to materialize the Drizzle schema (incl. `daily_wallet_spend`, `mantua_audit_log` tables).
4. `npm run dev` at the root → Vite on `https://localhost:5173`, Express on `http://localhost:3001`.
5. Log in with the test wallet via Privy. Confirm header shows the truncated wallet address.

## Happy paths — 10 token-pair combinations (P3-008)

Run a small swap (≤$5) for each pair, both directions where the market exists.

- [ ] ETH → USDC
- [ ] USDC → ETH
- [ ] ETH → cbBTC
- [ ] cbBTC → USDC
- [ ] ETH → EURC
- [ ] USDC → EURC
- [ ] EURC → USDC
- [ ] ETH → LINK
- [ ] LINK → USDC
- [ ] cbBTC → ETH

For each: amount input → quote returns within 1s → click Review swap → confirmation modal renders with `<from-amount> <from-token> → <to-amount> <to-token>` and slippage line → click Sign & swap → wallet popup → after receipt: BaseScan link visible, status = Done.

## Error states (P3-007)

- [ ] **Insufficient balance.** Try a swap above wallet balance — the wallet popup should reject with a clear message.
- [ ] **Quote expired / upstream down.** Manually break `UNISWAP_TRADING_API_KEY` in `server/.env`, restart server, attempt a quote. UI shows "Upstream quote temporarily unavailable." Restore the key.
- [ ] **Spending cap exceeded.** With a $500/day default cap and ETH ≈ $3,600, attempt a 1 ETH swap. Server returns `spending_cap_exceeded`; UI shows the error.
- [ ] **Slippage hard reject.** Type `600` into the slippage box. Server returns `slippage_too_high`; UI shows the error and the swap CTA is disabled.
- [ ] **Slippage double-confirm.** Set slippage to `200` (2%). Quote succeeds with `slippageWarning: "double_confirm"`. Confirmation modal requires two clicks before "Sign & swap" fires.
- [ ] **Kill-switch.** Set `MANTUA_KILL_SWITCH=1` in `server/.env`, restart server. Quote attempts return 503; UI shows "Mantua write operations are temporarily disabled." Set back to 0.
- [ ] **User rejects in wallet.** Reach the Sign step, then click Reject in the wallet popup. UI surfaces "Transaction rejected." and resets to idle.
- [ ] **Wrong chain.** Force the wallet onto Polygon, then try to swap. The viem bridge auto-switches to Base; if the wallet refuses, the UI throws and the swap doesn't proceed.

## Database side-effects (P1-001 + P1-008 + P3-006)

After a successful swap:

- [ ] One row in `portfolio_transactions` with `action='swap'`, the tx hash, the swap params, `outcome='success'`, and a non-null `usd_value`.
- [ ] One row in `daily_wallet_spend` for today (UTC) with `spent_usd` incremented by the swap's USD value.
- [ ] One row in `mantua_audit_log` with `action='swap'`, `outcome='success'`, the IP and user-agent populated.

After a rejected-cap quote attempt:

- [ ] One row in `mantua_audit_log` with `outcome='rejected_cap'` and `reason` matching the SafetyError message.
- [ ] No new row in `portfolio_transactions` (success-only table).
- [ ] No change to `daily_wallet_spend`.

## Rate limit smoke (P1-007)

- [ ] Issue ~25 quote requests in a minute via the UI (mash the amount input). After ~20, the server returns 429 `RATE_LIMITED`. UI shows "Too many requests — please slow down." After 60s, requests succeed again.

## What this plan deliberately does NOT cover

- Swaps through hooks (Phase 5 owns hook-routed pools; Phase 3 swaps go through Trading API's auto-router which may or may not pick a hooked pool).
- Mobile / responsive layout (Phase D follow-up).
- Agent-initiated swaps (Phase 6).
