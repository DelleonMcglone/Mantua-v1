# Phase B6 — Privy Auth, Profile & Portfolio

> Master: `docs/tasks/sports-pivot.md` — PHASE B6 (W3, 🔴 P0)
> Snapshot: 2026-09-03 · 10 ✅ · 2 ⏸

## Success Criteria

- [ ] Login methods are Google, email, and wallet; Apple and passkey are removed from the current Privy config (B6-001)
- [ ] The header shows distinct Log in (ghost) and Sign up (primary) entry points over the single Privy flow — the split is presentational (B6-002)
- [ ] Users without a wallet get an embedded wallet on signup (`createOnLogin: "users-without-wallets"`) (B6-003)
- [ ] Privy is chain-restricted to the DM-104 target, Base only (`supportedChains: [base]`) (B6-004)
- [ ] Return-to-intent: login from a matchup action lands back on that market — the Privy modal overlays the current route (B6-005)
- [ ] Server-side token verification stays on protected routes (`attachAuth` global, `requireAuth` on write routes) (B6-006)
- [ ] On login the header auth control swaps to the profile pill (B6-007)
- [ ] The profile button routes to the portfolio, which lives inside the user profile — not a standalone nav item (B6-008)
- [ ] Portfolio shows open market positions with entry price, current implied odds, unrealised P/L, and market status (B6-009)
- [ ] Portfolio shows LP positions with hook badges, token balances, and transaction history with explorer links (B6-010)
- [ ] The portfolio's agent wallet view links to the Agent panel, and armed hedging strategies surface once B9 exists (B6-011)
- [ ] The profile menu carries settings, spending cap controls, and log out (B6-012)

## Failure Conditions

- Apple or passkey remains in the login config
- A protected route loses server-side token verification
- The portfolio appears as a standalone nav item outside the profile
- Login from a matchup action lands the user somewhere other than that market
- Positions show unrealised P/L without a receipt-verified entry basis (avg-cost from indexed `market_fills`) (B6-009)
- Spending-cap controls or log out disappear from the profile menu

## Edge Cases

- A user arriving with an existing wallet must not get a second embedded one (B6-003)
- While the portfolio is open the left column swaps to the portfolio stack (balances + assets); closing restores the board (B6-008)
- The agent-wallet section links to the Agent panel even before B9 strategies exist — the section degrades gracefully (B6-011)
- One-click Close deep-links into the league page's Sell flow rather than duplicating it (B6-009)

## Checklist

- [x] B6-001 — Login methods: Google, email, wallet; remove Apple and passkey from current config
- [x] B6-002 — Distinct Log in and Sign up entry points (Privy exposes one flow; the split is presentational)
- [x] B6-003 — Embedded wallet on signup for users without one
- [x] B6-004 — Chain restriction updated to the DM-104 target
- [x] B6-005 — Return-to-intent: user who clicked a matchup action lands back on that market
- [x] B6-006 — Server-side token verification retained on protected routes
- [x] B6-007 — Header auth control swaps state on login: Log in / Sign up becomes the profile button
- [x] B6-008 — Profile button routes to the portfolio; portfolio lives inside the user profile, not as a standalone nav item
- [ ] B6-009 — Portfolio: open market positions with entry price, current implied odds, unrealised P/L, and market status ⏸
- [x] B6-010 — Portfolio: LP positions with hook badges, token balances, and transaction history with explorer links
- [ ] B6-011 — Portfolio: agent wallet view and armed hedging strategies (wires to B8, B9) ⏸
- [x] B6-012 — Profile menu: settings, spending cap controls, log out
