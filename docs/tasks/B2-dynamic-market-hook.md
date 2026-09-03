# Phase B2 — Dynamic Market Hook

> Master: `docs/tasks/sports-pivot.md` — PHASE B2 (W2, 🔴 P0)
> Snapshot: 2026-09-03 · 8 ✅

## Success Criteria

- [ ] The hook implements `docs/specs/dynamic-market-hook.md` as the authoritative DM-110 spec — pre-flight covers decimals 6 and keeper = resolver key; RiskPolicy stays blocked on the six risk parameters (spec §0.3) (B2-001)
- [ ] Permission-flag address mining produces a hook address whose v4 callback flags match the spec mask (`& 0x3FFF == 0x28C0`) (B2-002)
- [ ] The hook rejects swaps once the market is `FROZEN` (B2-003)
- [ ] Fee behaviour varies per game state — pre-game, in-play, near-resolution — exactly per spec (B2-004)
- [ ] Deployment is verified and recorded; the superseded pre-launch broadcast awaits the Base Mainnet redeploy, addresses env-driven with no defaults (B2-005)
- [ ] Stable Protection and Dynamic Fee hooks keep serving non-market base pools, regression-guarded by tests (B2-006)
- [ ] Security pass runs the existing Trail of Bits skills methodology; HIGH findings block ship (B2-007)
- [ ] Invariants hold: fee never exceeds the cap; the hook can never block a legitimate redeem (B2-008)

## Failure Conditions

- A swap executes against a `FROZEN` market
- A fee premium exceeds the cap in any game state
- A legitimate redeem is blocked by the hook
- A HIGH security finding ships
- The mined hook address carries the wrong permission bits — CREATE2 deployment would brick callbacks
- A base pool's Stable Protection or Dynamic Fee behaviour regresses

## Edge Cases

- Freeze is timestamp-driven and proven to fire with no keeper write ever made — the freeze cannot depend on a keeper running (B2-003)
- The pre-launch broadcast (bits `0x28C0`, recorded in `deploy/dynamic-market/README.md`) is superseded: the redeploy is Base Mainnet and env-driven, so a missing env var fails loudly rather than falling back (B2-005)
- Market pools have no fixed pair, so the hook sits deliberately outside the fixed-pair hook registry (B2-005, DM-112)
- The invariant campaign covers both failure directions: over-cap fees and redeem-blocking (B2-008)

## Checklist

- [x] B2-001 — Implement the hook against `docs/specs/dynamic-market-hook.md` (decimals 6, keeper = resolver key; RiskPolicy blocked on the six risk parameters, spec §0.3)
- [x] B2-002 — Permission-flag address mining (v4 encodes callbacks in the hook address)
- [x] B2-003 — Freeze enforcement: hook rejects swaps once the market is `FROZEN`
- [x] B2-004 — Fee behaviour per game state (pre-game / in-play / near-resolution) per spec
- [x] B2-005 — Deploy via Foundry, verify, record — pre-launch broadcast superseded by the pending Base Mainnet redeploy, addresses env-driven with no defaults
- [x] B2-006 — Retain Stable Protection + Dynamic Fee hooks for non-market base pools
- [x] B2-007 — Security pass using the existing Trail of Bits skills methodology; HIGH findings block ship
- [x] B2-008 — Invariant tests: fee never exceeds cap; hook cannot block a legitimate redeem
