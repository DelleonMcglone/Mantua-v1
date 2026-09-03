# Phase B10 — E2E & Ship

> Master: `docs/tasks/sports-pivot.md` — PHASE B10 (W5, 🔴 P0)
> Snapshot: 2026-09-03 · 7 ✅ · 3 ⏸

## Success Criteria

- [ ] Safety rails re-verified on the new surfaces: spending caps, slippage, confirmation modal, kill switch, rate limits, audit log — rail-by-rail with enforcement point and evidence (`docs/security/sign-off.md` §2) (B10-001)
- [ ] Full-lifecycle E2E: create → seed → positions both sides → add liquidity → price moves → freeze → resolve → redeem → balances verified, under production wiring (B10-002)
- [ ] Void E2E: postponed game → `INVALID` → all collateral returned (B10-003)
- [ ] Data-outage E2E: provider down mid-game → market freezes, does not mis-resolve (B10-004)
- [ ] Agent E2E: natural language → parse → preview → confirm → execute → audit entry (B10-005)
- [ ] Hedging E2E: arm strategy → trigger fires → executes under cap → disarms on freeze (B10-006)
- [ ] Security sign-off signed with zero HIGH findings open and MEDIUMs accepted in writing (`docs/security/sign-off.md`) (B10-007)
- [ ] Jurisdictional posture verified end to end per DM-108 — implied, not surfaced; no extra jurisdictional notice in the UI (B10-008)
- [ ] Incident runbook covers kill-switch activation, mis-resolution recovery, provider failover, and user comms (`docs/ops/incident-runbook.md`) (B10-009)
- [ ] Ship: production live end to end (B10-010)

## Failure Conditions

- A safety rail is missing on any new surface
- The lifecycle E2E leaks collateral or pays the wrong side
- An outage mis-resolves a market instead of freezing it
- Anything settles from a stale cache, even one containing a final (B10-004)
- The sign-off is unsigned, or a HIGH finding is open at ship
- A jurisdictional notice surfaces in the UI — DM-108 closed as implied, not marketed
- Ship is declared while the agent or hedging E2E rows still read ⏸

## Edge Cases

- Kickoff freeze leaves LP exits open — the E2E must prove liquidity can leave a frozen market while swaps cannot (B10-002)
- Void pays exactly 0.50 to both sides and the market drains to zero (B10-003)
- Freeze is timestamp-driven, so delayed data cannot prevent the freeze; recovery settles normally once data returns (B10-004)
- Accepted MEDIUMs (L-01/L-02) are documented in writing, not silently waived (B10-007)
- Operational docs name Base Mainnet factually — instruction, not posture marketing (B10-008)

## Checklist

- [x] B10-001 — Safety rails re-verified on new surfaces: spending caps, slippage, confirmation modal, kill switch, rate limits, audit log
- [x] B10-002 — Full-lifecycle E2E: create → seed → positions both sides → add liquidity → price moves → freeze → resolve → redeem → balances verified
- [x] B10-003 — Void E2E: postponed game → `INVALID` → all collateral returned
- [x] B10-004 — Data-outage E2E: provider down mid-game → market freezes, does not mis-resolve
- [ ] B10-005 — Agent E2E: natural language → parse → preview → confirm → execute → audit entry ⏸
- [ ] B10-006 — Hedging E2E: arm strategy → trigger fires → executes under cap → disarms on freeze ⏸
- [x] B10-007 — Security sign-off — zero HIGH findings open, MEDIUM accepted in writing (`docs/security/sign-off.md`)
- [x] B10-008 — Jurisdictional posture verified end to end (DM-108): no extra jurisdictional notice in the UI
- [x] B10-009 — Incident runbook: kill-switch activation, mis-resolution recovery, provider failover, user comms
- [ ] B10-010 — Ship: production live end to end ⏸
