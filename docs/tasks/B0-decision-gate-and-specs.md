# Phase B0 — Decision Gate & Specs

> Master: `docs/tasks/sports-pivot.md` — PHASE B0 (W1, 🔴 P0)
> Snapshot: 2026-09-03 · 6 ✅ · 1 🟡

## Success Criteria

- [ ] All 11 Open Decisions (DM-101–DM-112) closed with rationale and date recorded in `docs/architecture.md`; only DM-103 (resolution authority) may remain open pending owner sign-off (B0-001)
- [ ] `docs/specs/market-lifecycle.md` covers the full create → seed → trade → freeze → resolve → redeem → void path (B0-002)
- [ ] `docs/specs/dynamic-market-hook.md` saved from the DM-110 spec (§0–§46) and treated as authoritative (B0-003)
- [ ] Market ID scheme is a deterministic hash of (provider event ID, market type, outcome index), specified in `docs/specs/market-id.md` and implemented in `server/src/lib/market-id.ts` (B0-004)
- [ ] Postgres carries the eight pivot tables: `sports`, `leagues`, `events`, `markets`, `market_outcomes`, `market_positions`, `resolutions`, `hedge_strategies` (B0-005)
- [ ] Carried-forward scope is reconciled: surviving, superseded, and deferred repo items each classified (B0-006)
- [ ] Branch + task doc per house convention established; prompt history captured (B0-007)
- [ ] Closed decisions stay closed: DM-104's retarget to Base Mainnet is recorded in place with its date, never silently rewritten

## Failure Conditions

- A decision is closed in the table but missing from `docs/architecture.md`, or carries no rationale or date
- DM-103 is treated as resolved without owner sign-off on the signer arrangement
- Specs and implementation drift: `server/src/lib/market-id.ts` no longer matches `docs/specs/market-id.md`
- A pivot table is added, renamed, or dropped outside the eight named in B0-005
- Carried-forward work is rebuilt without checking the scope-reconciliation classification first
- The DM-110 hook spec is forked locally instead of followed as the supplied authoritative spec

## Edge Cases

- DM-103 stays open while B4 resolution work proceeds on the single-key default; the eventual multisig swap is a role change, not a redeploy (B4-007)
- DM-104 was closed 2026-08-16 and retargeted 2026-09 — a decision record can carry both a close and a later retarget
- DM-110 and DM-111 closed 2026-08-17, after B0-001's "8 of 11" tally — decision closes can post-date a task row's inline text
- A carried-forward item can be partly surviving and partly superseded; the reconciliation doc must say which parts are which

## Checklist

- [ ] B0-001 — Close all 11 Open Decisions and record each with rationale and date in `docs/architecture.md` 🟡
- [x] B0-002 — `docs/specs/market-lifecycle.md`: create → seed → trade → freeze → resolve → redeem → void
- [x] B0-003 — `docs/specs/dynamic-market-hook.md` saved from the DM-110 spec (§0–§46), authoritative
- [x] B0-004 — Market ID scheme: deterministic hash of (provider event ID, market type, outcome index)
- [x] B0-005 — Postgres additions: `sports`, `leagues`, `events`, `markets`, `market_outcomes`, `market_positions`, `resolutions`, `hedge_strategies`
- [x] B0-006 — Reconcile carried-forward scope: which repo items survive, which are superseded, which are deferred
- [x] B0-007 — Branch + task doc per house convention; prompt history captured
