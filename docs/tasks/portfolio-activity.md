# Phase 9 — Portfolio Management + Activity

> Owner directive 2026-09-12 ("continue with phase 9"). Twenty-one rows,
> PF-001 … PF-021: the ten portfolio surfaces from the spec, real-time
> valuation, settled history, and the unified Activity system. Decision
> record: **D-115** (the activity model) in
> `docs/decisions/v2-open-decisions.md`.
>
> Naming note: `docs/tasks/v2-roadmap.md` already uses `PF-001 … PF-010`
> for legacy _fee_ rows; this ledger's `PF-` prefix is the owner's Phase 9
> numbering and the two never share a document.
>
> Snapshot: 2026-09-12 (post-064) · **8 ✅ · 12 🟡 · 1 ⬜**.
> Lanes: 062 activity spine (server) · 063 position economics (server) ·
> 064 activity timeline + chain-branding sweep (client) · 065 portfolio
> surfaces (client) · 066 end-to-end + pricing decision.

## What the reconnaissance found (baseline, before any lane)

- **The Activity table had no writers and no readers.** `activity` was
  created in migration 0009 and never touched; `portfolio_transactions`
  (swap, liquidity, agent send — successes only) and the compliance
  `mantua_audit_log` were the de-facto history. Sports trades lived only
  in `market_fills`; redeems and settlements stamped `market_positions`;
  hedges reached the audit log; fiat lived in `fiat_transfers`.
- **A portfolio already shipped under B6** (balances, LP positions with
  hook badges, market positions marked live with entry and unrealized
  P&L, the agent tab, unified balance, earnings) but with no cross-account
  assets view, no settled history for users, no hedge relationship, no
  agent positions on the client, and no activity timeline at all.
- **Valuation** is Pyth first with a DefiLlama fallback and a silent `0`
  on outage, not CoinGecko (Phase 13 owns that migration).
- **Chain branding** leaks in three places (asset detail tx links, chat
  text links, one hard-coded explorer URL) and no sweep test guards
  PF-018.

## Rows

| Row    | Requirement (condensed)                                                                                        | Status | Where / what remains                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| PF-001 | §1 Assets — everything held across wallets/accounts                                                            | 🟡     | User wallet balances shipped (B6); cross-account aggregate — lane 065                                                                    |
| PF-002 | §2 Positions (liquidity) — per pool deposited, value, fees, P&L, share                                         | 🟡     | Server: `lp-economics.ts` + `GET /api/portfolio/economics` (deposited, value, fees, P&L, share) — 063; UI — lane 065                     |
| PF-003 | §3 Market positions — event, market, side, entry, current, value, unrealized P&L, potential payout, status     | 🟡     | Marked positions + entry + P&L (B6) + `potentialPayoutRaw` (063); event grouping in the UI — lane 065                                    |
| PF-004 | §4 Agent — active/inactive, strategy, spending limit, current activity, permissions, recent actions            | 🟡     | Cap, policy panel, rebalance toggle shipped; status, recent actions from activity — lane 065                                             |
| PF-005 | §5 Agent positions — sports positions, hedges, other authorized trades                                         | 🟡     | Server reads exist (`mantua_get_portfolio`); client section — lane 065                                                                   |
| PF-006 | §6 Unified balance                                                                                             | ✅     | C-008 (`UnifiedBalanceTab`)                                                                                                              |
| PF-007 | §7 Earnings — LP earnings plus other realized earnings                                                         | 🟡     | Accrued LP fees (B6) + realized market earnings on `/api/portfolio/economics` (063); collected-fee ledger — documented gap               |
| PF-008 | §8 User wallet — wallet, assets, transactions                                                                  | 🟡     | Wallet + per-asset tx list shipped; wallet ledger from activity — lane 065                                                               |
| PF-009 | §9 Liquidity positions — detailed per-pool LP view                                                             | 🟡     | Assets tab has the list; per-pool detail in the profile — lane 065                                                                       |
| PF-010 | §10 Hedging — hedge relationship, value, performance                                                           | 🟡     | Hedges now carry `position_ref` in activity (062); section — lane 065                                                                    |
| PF-011 | Real-time valuation, never hardcoded                                                                           | 🟡     | Live pool marks + Pyth/DefiLlama pricing; decision + observable fallback — lane 066                                                      |
| PF-012 | Settled-position history with realized P&L                                                                     | 🟡     | `GET /api/portfolio/settled` (063) — realized P&L, labels, redeemed flag; UI — lane 065                                                  |
| PF-013 | E2E: every section renders real data                                                                           | ⬜     | Lane 066                                                                                                                                 |
| PF-014 | Preserve and migrate the Activity system                                                                       | ✅     | The dormant table is now the spine (062): schema, migration 0020, writer, route                                                          |
| PF-015 | Activity covers sports buys/sells, agent trades, hedges, liquidity, swaps, deposits, withdrawals, settlements  | ✅     | Eleven write sites fan out (062)                                                                                                         |
| PF-016 | Tx hash, action, asset, amount, value, timestamp, status, market/pool, attribution, related position           | ✅     | Columns + `(tx_hash, kind)` uniqueness (062)                                                                                             |
| PF-017 | Pending / Completed / Failed, deterministic transitions                                                        | ✅     | `transitionActivity` moves pending exactly once; Circle sends pending → terminal (062)                                                   |
| PF-018 | Verification links without chain branding                                                                      | ✅     | Neutral `TxRow` everywhere; the burn card's hard-coded URL fixed; `chainless-branding.test.ts` sweep with two listed carve-outs (064)    |
| PF-019 | Chronological card/timeline view                                                                               | ✅     | `features/activity/` — filter chips, day groups, icon / status / amount / time / verification cards; Activity tab in the portfolio (064) |
| PF-020 | Agent activity identifies research / simulation / recommendation / trade / hedge / swap / liquidity / transfer | ✅     | Kinds + category (062)                                                                                                                   |
| PF-021 | E2E: user trade, agent trade, hedge, settlement each appear                                                    | 🟡     | Server half wired (062); the composed test — lane 066                                                                                    |
