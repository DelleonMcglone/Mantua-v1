# Security findings

Tracks issues raised during Phase 5 hook security review (P5-017 → P5-026).
Each finding gets an ID, severity, status, and reproducer.

## Format

```
## SF-NNN — <one-line title>

**Hook:** <hook name>
**Source:** <repo@commit, file:line>
**Severity:** Critical | High | Medium | Low | Info
**Status:** Open | In review | Accepted-as-risk | Fixed (commit) | Won't fix (rationale)
**Reporter:** <name / tool>
**Reported:** <YYYY-MM-DD>

### Description
<what's wrong>

### Reproducer
<how to trigger>

### Recommendation
<proposed fix>
```

---

## P5-017 — Slither static analysis baseline (2026-04-28)

Tool: `slither-analyzer 0.11.4` with `solc 0.8.26`. Harness:
[`contracts/script/security/run-slither.sh`](../../contracts/script/security/run-slither.sh).
Raw outputs (full detector JSON + stderr): `docs/security/slither/<hook>.{json,txt}`.

### Per-hook severity counts

| Hook | Submodule pin | Total | High | Medium | Low | Info |
|---|---|---:|---:|---:|---:|---:|
| StableProtectionHook | `1282b89` | 84 | 1 | 23 | 2 | 58 |
| DynamicFee | `854e939` | 76 | 1 | 23 | 4 | 48 |
| RWAGate | `bb41ada` | 51 | 0 | 8 | 5 | 38 |
| AsyncLimitOrder | `89d905f` | — | — | — | — | — |

**AsyncLimitOrder failed to compile** under the harness — its submodule
pins a `v4-periphery` revision missing `BaseHook.sol` (same root cause as
Phase 5b-3.2 vendor work for Stable Protection). Slither baseline pending
a submodule-deps fix; tracked in this section as a follow-up under
**SF-016** (open for P5-018+ triage).

### Own-source findings (Mantua-controlled code)

The two High findings (one in Stable Protection, one in Dynamic Fee) are
both `incorrect-exp` against `FullMath.mulDiv` in upstream Uniswap
`v4-core` — a well-known Slither false positive on Remco Bloemen's
algorithm. **No own-source High findings.**

The Medium findings below are in Mantua-controlled code (`hooks/<hook>/src/`)
and need triage in P5-018+. Each is logged here with status `Open`.

#### StableProtectionHook — 7 Medium findings, own-source

| ID | Detector | File:line |
|---|---|---|
| SF-001 | `divide-before-multiply` | `src/libraries/StableSwapMath.sol:30` (`calculateD`) |
| SF-002 | `divide-before-multiply` | `src/libraries/StableSwapMath.sol:30` (`calculateD`, second instance) |
| SF-003 | `divide-before-multiply` | `src/libraries/StableSwapMath.sol:71` (`getY`) |
| SF-004 | `divide-before-multiply` | `src/libraries/StableSwapMath.sol:137` (`checkInvariant`) |
| SF-005 | `unused-return` | `src/StableProtectionHook.sol:253` (`_getVirtualReservesNormalized` ignores 3 of 4 `getSlot0` outputs) |
| SF-006 | `unused-return` | `src/StableProtectionHook.sol:181` (`_afterSwap` ignores 1 of 2 `classifyZone` outputs) |
| SF-007 | `unused-return` | `src/StableProtectionHook.sol:228` (`currentDeviationBps` ignores 1 of 2 `classifyZone` outputs) |

#### DynamicFee — 7 Medium findings, own-source

| ID | Detector | File:line |
|---|---|---|
| SF-008 | `divide-before-multiply` | `src/DynamicFee.sol:251` (`_sqrtPriceX96ToPrice`) |
| SF-009 | `unused-return` | `src/libraries/OracleManager.sol:24` (`getOraclePrice` ignores `latestRoundData` outputs) |
| SF-010 | `unused-return` | `src/libraries/OracleManager.sol:38` (`safeGetOraclePrice`) |
| SF-011 | `unused-return` | `src/DynamicFee.sol:150` (`_computeFee` ignores `getSlot0` outputs) |
| SF-012 | `unused-return` | `src/DynamicFee.sol:176` (`afterSwap` ignores `getSlot0` outputs) |
| SF-013 | `unused-return` | `src/DynamicFee.sol:210` (`getPoolStatus`) |
| SF-014 | `unused-return` | `src/DynamicFee.sol:227` (`previewFee`) |

#### RWAGate — 0 Medium findings, own-source

All 8 RWAGate Mediums are in upstream `lib/`. No own-source Medium issues.

#### AsyncLimitOrder

| ID | Detector | File:line |
|---|---|---|
| SF-015 | (compile failure) | `src/TakeProfitsHook.sol:4` — `BaseHook` import not found in pinned `lib/v4-periphery` |

### Status legend

All P5-017 findings start as **Open**. Triage moves to:
- **In review** — owner is investigating
- **Accepted-as-risk** — known false positive (link to upstream issue / explanation) or risk explicitly accepted (with rationale)
- **Accepted-as-risk (beta)** — accepted only for the pre-launch beta (P9-003 sign-off in [`sign-off.md`](sign-off.md)). Must close to ✅ Fixed or supersede with auditor sign-off before the Base Mainnet hook deployment.
- **Fixed** — code change merged (link to commit)
- **Won't fix** — out of scope (with rationale)

P5-018 picks up triage. P5-019 → P5-026 cover other tools (Mythril,
semgrep, Echidna fuzz, manual review, audit) and re-run after fixes.

### P9-003 pre-launch beta triage (2026-05-05)

All 14 own-source Mediums marked **Accepted-as-risk (beta)**:

| ID | Finding | Class | Rationale |
|---|---|---|---|
| SF-001 → SF-004 | StableSwap `divide-before-multiply` (4×) | A — algorithm-dictated order | Iterative D-solver / Y-from-D math; Slither flags pattern mechanically. No impact at beta magnitudes (≤1k token units). |
| SF-005 → SF-007 | StableProtection `unused-return` (3×) | B — discarded tuple returns | `getSlot0` / `classifyZone` returns we don't act on. No state leak. |
| SF-008 | DynamicFee `_sqrtPriceX96ToPrice` divide-before-multiply | A | Standard Q96 → priceE18 conversion. |
| SF-009 → SF-014 | DynamicFee `unused-return` (6×) | B | Chainlink `latestRoundData` round/timestamp + Uniswap `getSlot0` returns we don't gate logic on. |
| SF-015 | AsyncLimitOrder Slither compile failure | C — vendor-deps gap | Pinned `lib/v4-periphery` missing `BaseHook.sol`. Fix path is a periphery submodule bump on the ALO repo. ALO is not on the user-facing flow; analysis-pending status acceptable for beta. |

Full rationale and pre-deployment fix paths in
[`sign-off.md`](sign-off.md).

### Note on upstream-dep findings

71 of Stable Protection's 84 detectors fire on `lib/v4-core/` and
`lib/v4-periphery/` (Uniswap upstream). These are **not Mantua's
responsibility**, but documenting them here tells reviewers we ran the
tool against the full transitive set, not just our own files. Same
ratios for Dynamic Fee (~16 dep mediums) and RWAGate (8 dep mediums).
Upstream findings are logged in the raw JSON; not transcribed above.

### Task 049 — Dynamic Market Hook fee model (2026-09-12)

Review: [`dynamic-market-fee-review.md`](dynamic-market-fee-review.md)
(Trail of Bits methodology over the D-105 fee-model change). Slither
0.11.6 re-run: 27 findings, 0 High, 9 Medium — identical to the P-013
baseline; no detector fires on the new `MarketFeeFormula.sol`,
`MarketFeeCalculator.sol`, or `RiskPolicy.sol`.

| ID   | Finding                                                             | Severity | Status                     |
| ---- | ------------------------------------------------------------------- | -------- | -------------------------- |
| L-03 | Volatility griefing can lift the rate by ≤ 0.15% while it lasts     | Low      | Open — bounded, self-defeating, decays; accepted for launch pending owner note |
| L-04 | Sell-side `fee_usdc_raw` telemetry valued at the pre-trade price    | Low      | Accepted — analytics only  |
| I-03 | Pip rate on the input equals the full rate as `p → 0`               | Info     | Documented                 |
| I-04 | Rate varies with `p` through the model-deviation driver             | Info     | Documented                 |

The previous fee-band statements in this file and in `sign-off.md`
(`BASE_FEE` 0.30%, `MAX_FEE` 5.00%) are superseded by D-105
(`MIN_RATE` 0.10%, `MAX_RATE` 0.70%, `REGULAR_SEASON_FEE` 0%).
