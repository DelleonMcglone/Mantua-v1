# Phase B4 — Resolution & Settlement

> Master: `docs/tasks/sports-pivot.md` — PHASE B4 (W2, 🔴 P0)
> Snapshot: 2026-09-03 · 6 ✅ · 1 ⏸

## Success Criteria

- [ ] The `Resolver` contract accepts an outcome for a market ID, enforces signer + operator authority, and emits `MarketResolved` (B4-001)
- [ ] Freeze at scheduled start time is enforced in three layers: permissionless time-based `Market.freeze`, the hook's timestamp check, and the service's freeze sweep in `planResolution` (B4-002)
- [ ] The resolution service runs final detected → outcome derived → submitted onchain → DB reconciled (B4-003)
- [ ] A bad or missing feed never auto-settles a market: operator override exists, waiting is the default, settling the exception (B4-004)
- [ ] Void path: postponed/cancelled → `INVALID` → everyone redeems at cost, with the 0.50 disclosure in Terms/docs (B4-005)
- [ ] The public resolution log carries source, timestamp, signer, and tx link; resolution authority is disclosed in Terms, docs, and the market page (B4-006)
- [ ] `resolutions` rows are written only with a tx hash (B4-006)

## Failure Conditions

- A market settles from delayed, missing, unknown, or contradictory data
- A non-signer resolves a market, or signer authority is bypassed
- A resolution lands without a tx hash on the record
- A voided market pays anything other than cost back to both sides
- Resolution authority ships undisclosed anywhere it is user-visible
- The resolver multisig upgrade is treated as launch-blocking — it is deferred P2 behind DM-103, not silently dropped

## Edge Cases

- Risk 2: v1 ships a trusted resolver with no dispute window — the disclosure (B4-006) is the mitigation; a dispute window is a post-Sept-16 item
- DM-103 remains open: the single key is the interim authority, and the operator seat already rotates two-step, so multisig is a role change, not a redeploy (B4-007)
- The resolution cron 503-runs dry until the Resolver deploys — it must never fake success (B4-003)
- A tie game maps to both markets void, matching the contract void path (B4-005)
- `Market.freeze` is permissionless and the hook's check is timestamp-driven, so freeze happens even if the service never runs (B4-002)

## Checklist

- [x] B4-001 — `Resolver` contract: accepts outcome for a market ID, enforces signer authority, emits `MarketResolved`
- [x] B4-002 — Freeze trigger at scheduled start time
- [x] B4-003 — Resolution service: final detected → outcome derived → submitted onchain → DB reconciled
- [x] B4-004 — Manual override on the resolver; a bad or missing feed must not auto-settle a market
- [x] B4-005 — Void path: postponed/cancelled → `INVALID` → everyone redeems at cost
- [x] B4-006 — Public resolution log (source, timestamp, signer, tx link) + UI disclosure of resolution authority
- [ ] B4-007 — Resolver multisig upgrade per DM-103 ⏸
