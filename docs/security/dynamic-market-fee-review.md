# Security Review — Dynamic Market Hook fee model (D-105)

**Task:** 049 (H-008) in `docs/tasks/049-dynamic-market-fee-model.md`
**Scope:** `contracts/src/hooks/dynamic-market/` — 9 files, the fee-model
change: `RiskPolicy.sol`, `MarketFeeFormula.sol` (new),
`MarketFeeCalculator.sol`, `IMarketStateRegistry.sol`,
`MarketStateRegistry.sol`, `MarketFlow.sol`, `DynamicMarketHook.sol`; plus
the server surfaces that consume the hook (`market-fee.ts`,
`market-fee-telemetry.ts`, `market-fills.ts`, `markets-onchain.ts`).
**Spec:** the owner's fee model (D-105, `docs/decisions/v2-open-decisions.md`)
over `docs/specs/dynamic-market-hook.md` (§28 security model, §44 failure
conditions).
**Methodology:** Trail of Bits skills via
`DelleonMcglone/AI-assisted-security-analysis`, applied in the P5-018 → P5-024
order: audit-context-building, entry-point-analyzer, building-secure-contracts
scanners, sharp-edges, insecure-defaults, static-analysis (Slither),
spec-to-code-compliance, property-based-testing.
**Date:** 2026-09-12
**Reviewer:** AI-assisted (Claude). **Not a substitute for a human audit.**
The external o3 / Gemini review steps in the house process were not run —
this environment has no route to those APIs.

---

## 1. Verdict

**No HIGH and no MEDIUM findings open in the changed code.** Two LOW items
and two informational items are recorded below; none blocks. The
Slither run is unchanged from the P-013 baseline (27 findings, 0 High,
9 Medium, every Medium a previously triaged false positive in files this
task did not alter).

| Severity      | Count | Status                        |
| ------------- | ----- | ----------------------------- |
| HIGH          | 0     | —                             |
| MEDIUM        | 0     | —                             |
| LOW           | 2     | Open, documented (L-03, L-04) |
| Informational | 2     | Recorded (I-03, I-04)         |

---

## 2. Audit context (P5-018)

**What changed and why it is security-relevant.** The hook's fee moved from
a 0.30%–5.00% premium band to a season-gated 0% / 0.10%–0.70% rate shaped by
the pool price. Three new surfaces carry risk:

1. **The season gate** — a boolean that decides whether a pool charges
   anything. Who writes it, when, and whether it can change.
2. **The price-shaped fee** — `feePips = rate × (1 − p)` reads `p` from
   `sqrtPriceX96`, which any trader can move. Whether moving it can lower
   the fee below what the model intends, or push it above the ceiling.
3. **A new external view, `quoteFee`** — the first non-callback function on
   the hook. Whether it leaks a write path or diverges from `beforeSwap`.

**Trust boundaries (unchanged).** PoolManager → hook callbacks (§28.1);
operator → registry registration and pause; keeper → three fee inputs;
everyone → `quoteFee` (view). The server never holds a path into the hook;
it reads `quoteFee` and decodes `MarketFeeUpdated`.

**Value at risk.** No custody: the hook returns a fee to v4 and reverts or
not. Worst case is mispricing — LPs under- or over-compensated within the
band — never loss of principal. The band itself is the control.

## 3. Entry points (P5-019)

| Entry point                            | Caller      | Mutates              | Fee-model relevance                                              |
| -------------------------------------- | ----------- | -------------------- | ---------------------------------------------------------------- |
| `DynamicMarketHook.beforeSwap`         | PoolManager | emits event only     | Returns `rate × (1 − p)` with the override flag; cap check       |
| `DynamicMarketHook.afterSwap`          | PoolManager | `flowOf[id]`         | Folds notional + price into flow/volatility (rate inputs)        |
| `DynamicMarketHook.quoteFee`           | anyone      | nothing (`view`)     | Same `_price` path as `beforeSwap`; reverts where the swap would |
| `DynamicMarketHook.beforeInitialize`   | PoolManager | nothing              | Unchanged gate: registered + dynamic-fee flag                    |
| `DynamicMarketHook.beforeAddLiquidity` | PoolManager | nothing              | Unchanged halt gate                                              |
| `MarketStateRegistry.registerPool`     | operator    | `_states[id]` (once) | **Writes `playoffs`**; once-only, no setter                      |
| `MarketStateRegistry.updateMarket`     | keeper      | 3 keeper fields      | Cannot reach `playoffs`, kickoff, or the rate bounds             |
| `MarketStateRegistry.setPaused/…`      | operator    | pause flags          | Unchanged                                                        |

`quoteFee` is `external view` and calls only `_price` (`private view`);
no storage write is reachable from it. Checked by reading the function
body and by the compiler accepting `view`.

## 4. Vulnerability scanners — building-secure-contracts (P5-020)

Categories walked, with the fee-model-specific answer:

- **Access control.** The only new state, `playoffs`, is written by
  `registerPool` under `onlyOperator` and never again (no setter exists;
  `MarketStateRegistry.t.sol::test_registryExposesNoKickoffSetter` pattern,
  and `FeeManipulation.t.sol::test_keeperCannotTouchTheSeasonFlag`). The
  keeper's `updateMarket` writes three fields and is bounds-checked (§28.4).
- **Arithmetic.** `MarketFeeFormula` uses `FullMath.mulDiv` for the
  512-bit intermediate in `contractFee` and `mulDivRoundingUp` in
  `feeOnInput`; `effectiveFeePips` multiplies a `uint24` by a value ≤ 10 000
  — no overflow possible in `uint256`. Division floors, so rounding can only
  under-charge by < 1 pip; the ceiling is never exceeded by rounding
  (`MarketFeeFormula.t.sol::testFuzz_pipFeeNeverExceedsTheRate`).
  `type(uint256).max` inputs are exercised without revert
  (`test_extremeAmountsDoNotOverflow`, `testFuzz_formulaIsTotal`).
- **Denial of service.** Every fee path is pure/total: zero liquidity, zero
  price, `p > BPS`, stale state all return a value. The season gate returns
  before any driver is read, so a regular-season pool cannot revert on a
  degenerate driver input. No loops.
- **Reentrancy.** `beforeSwap`/`afterSwap` keep the `nonReentrant` latch;
  `quoteFee` is `view`. No external calls other than PoolManager and
  registry reads (both trusted, immutable addresses).
- **Oracle / price manipulation.** Covered in §6 (sharp edges) and by
  `FeeManipulation.t.sol`.
- **Unchecked returns / silent failures.** `registry.marketState` reverts
  for unregistered pools; `poolManager.getSlot0` is a library read.
- **Front-running.** A quote is a view at block N; execution at block N+1
  may see a different `p` or flow. This is the same exposure as any AMM
  quote and is bounded by the fee band; the UI re-quotes on state change.
  Not a finding.
- **Event integrity.** `MarketFeeUpdated` carries the full breakdown, the
  price, the season flag, and the pip fee; the server filters logs to the
  deployed hook address before decoding (`market-fee-telemetry.ts`), so a
  foreign contract in the same transaction cannot forge fee telemetry
  (`market-fee-telemetry.test.ts`).

## 5. Spec-to-code compliance (P5-023) — the fee model

| Spec statement                                                 | Code                                                                                                                       | Evidence                                                                                                                                                                               | ✓   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Regular season: 0% trading fees                                | `Calc.rate` returns all-zero breakdown when `!playoffs`; `REGULAR_SEASON_FEE = 0`                                          | `MarketFeeCalculator.t.sol::test_regularSeasonIsFreeWhateverTheConditions`; invariant `invariant_regularSeasonIsFree`; hook test `test_regularSeasonPoolIsFeeFreeEvenWhenStaleAndThin` | ✓   |
| Playoffs: fees introduced                                      | `playoffs` per pool at `registerPool`; `Calc.rate` computes when true                                                      | `test_playoffsActivateTheDynamicRate`                                                                                                                                                  | ✓   |
| Dynamic range 0.10%–0.70%                                      | `MIN_RATE = 1000`, `MAX_RATE = 7000`, `clampRate`                                                                          | `RiskPolicy.t.sol`; `testFuzz_feeNeverExceedsTheCeilingAndTheSeasonRuleHolds`; 100k sweep                                                                                              | ✓   |
| Maximum 0.70% — never exceeded                                 | `constant`, no setter; `effectiveFeePips ≤ rate ≤ MAX_RATE`                                                                | `testFuzz_pipFeeNeverExceedsTheRate`, `invariant_feeWithinImmutableBounds`                                                                                                             | ✓   |
| Varies by liquidity, volatility, trading activity, uncertainty | Four premiums, weights 2500 each (activity = imbalance 1500 + directional 1000; uncertainty = deviation 1500 + event 1000) | `test_lowLiquidityRaisesTheRate`, `test_volatilityRaisesTheRate`, `test_activityRaisesTheRate…`, `test_uncertaintyRaisesTheRate`                                                       | ✓   |
| Highest fee at p ≈ 0.50, lower toward 0 / 1                    | `contractFee` ∝ `p × (BPS − p)`; hook returns `rate × (1 − p)`                                                             | `test_perContractFeePeaksAtEvenOdds`, `…DeclinesMonotonically…`, `invariant_perContractFeePeaksAtEvenOdds`                                                                             | ✓   |
| `Fee = C × fee_rate × p × (1 − p)`                             | `MarketFeeFormula.contractFee`; realised on-chain via `effectiveFeePips`                                                   | Shared vectors (Solidity + TS); `testFuzz_pipFeeRealisesThePerContractFormula`; live proof `FullLifecycle.t.sol::_assertLiveFee` (LP fee growth equals the quoted fee)                 | ✓   |
| `p` = contract price from pool state                           | `MarketMath.probabilityBps(sqrtPriceX96, yesIsToken0)` read before the swap in `_price`                                    | `test_feeReadsProbabilityFromPoolStateInBothOrderings`                                                                                                                                 | ✓   |
| Quote equals execution                                         | `quoteFee` and `beforeSwap` share `_price`                                                                                 | `test_quoteFeeMatchesBeforeSwapAndTheEmittedBreakdown`                                                                                                                                 | ✓   |

**One interpretation is recorded, not assumed:** `C` is the
contract-equivalent of the _gross_ input at the pre-trade price. Counting
contracts net of the fee would change the pip formula by `1/(1 + r(1−p))`
(≤ 0.7% of the fee). Documented in D-105 and the task record; the
per-contract fee is therefore exact under the stated definition.

## 6. Sharp edges (P5-021)

- **`p = 0` makes the pip rate equal the full rate.** At a price of zero
  the contracts are worthless, so the per-contract fee is zero while the
  pip rate on the input is `rate`. Harmless (a USDC input at `p = 0` buys
  unbounded contracts and the pool cannot actually sit at 0), but a reader
  expecting "lower fee near 0" to mean a lower _pip_ rate will be surprised.
  Documented in `MarketFeeFormula.sol` and `docs/fee-model.md`. **I-03.**
- **The rate is not constant across `p` when the keeper's model disagrees
  with the pool.** The deviation driver reads `|p − model|`, so pushing
  the price away from the model raises the rate; the per-contract peak at
  0.50 holds for fixed conditions (the spec's statement) and, in the
  scenario matrix, still holds under the moving deviation because
  `p(1−p)` dominates. Recorded so nobody "fixes" it into a constant.
  **I-04.**
- **Exact-output swaps count `C` on the gross input.** See §5. Not a bug;
  a definition.
- **Same-block re-quote is identical; next-block re-quote can differ.**
  Flow decays and the keeper may write; the UI must re-quote on input
  change (it does, 400 ms debounce) and the server quote is fetched in the
  same request as the calldata.

## 7. Insecure defaults (P5-021)

- **Unknown season type → regular season (0%).** Chosen deliberately: a
  provider that omits `season.type` must not switch fees on. The reverse
  default would charge users on data absence. `ingest.test.ts` pins it.
- **Registry never fed → stale → `MAX_RATE`** (playoffs) — unchanged
  fail-closed posture; in the regular season it stays 0%.
- **`playoffs` default in the Solidity struct is `false`** — the same
  fee-free default at the contract layer.

## 8. Static analysis (P5-022)

Slither 0.11.6 with solc 0.8.26, `contracts/script/security/run-slither.sh`
first-party section, outputs at
`docs/security/slither/markets-dynamic-market.{txt,json}`:

| Total | High | Medium | Low | Info |
| ----- | ---- | ------ | --- | ---- |
| 27    | 0    | 9      | 18  | 0    |

Identical counts and detectors to the P-013 baseline. The nine Mediums are
`incorrect-equality` (`MarketFlow`, `Market` ×3), `reentrancy-no-eth`
(`Market` ×2), `uninitialized-local` (`MarketFlow`), `unused-return`
(`DynamicMarketHook`, `MarketFlow`) — all triaged as false positives in
`markets-contracts-review.md` §5 and untouched by this task. **No detector
fires on `MarketFeeFormula.sol`, `MarketFeeCalculator.sol`, or
`RiskPolicy.sol`.**

## 9. Property-based testing (P5-024)

- `MarketFeeCalculator.t.sol` — fuzz over every input incl. the season
  flag: ceiling, band, season rule; per-contract peak for fixed conditions.
- `MarketFeeFormula.t.sol` — fuzz: pip ≤ rate; regular season zero; totality
  over `uint256`; pip-vs-per-contract identity.
- `DynamicMarketInvariant.t.sol` — stateful invariant campaign (four
  invariants) plus the 100 000-call sweep asserting ceiling, band, season
  rule, the `rate × (1 − p)` identity, and that the ceiling is reached.
- `FeeManipulation.t.sol` (H-017) — bounded influence per gameable input.

## 10. Findings

### L-03 — Volatility can be griefed toward the ceiling by price thrashing _(LOW)_

Repeated large price moves saturate the EWMA (20% weight per observation)
and lift the volatility share to its 0.15% maximum; sustained thrashing
therefore raises everyone's rate by up to 0.15% while it lasts. Bounded by
construction, self-defeating (the griefer pays the fee on every leg and
trips the trade cap as risk rises), and reverting within ~20 calm
observations (`test_volatilityGriefingSaturatesAtTheCeilingAndDecays`).
**Recommendation:** none required for launch; a per-block volatility
observation cap is the fix if it is ever observed in the wild.

### L-04 — `feeUsdcRaw` for sells values the YES fee at the pre-trade price _(LOW, telemetry only)_

The telemetry column values a YES-denominated fee at `p` before the swap;
the executed price is a hair different. Analytics-only (never used to
charge), and the pip fee and rate are recorded exactly. **Recommendation:**
accept; note in the analytics docs.

### I-03 — Pip rate at `p → 0` equals the full rate (informational)

See §6. Documented.

### I-04 — Rate depends on `p` through the deviation driver (informational)

See §6. Documented; the spec's per-contract peak holds for fixed conditions
and in the scenario matrix.

## 11. §44 failure conditions — re-walked for the fee model

| Condition                                         | Result                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A keeper can increase the fee ceiling             | Pass — `MAX_RATE` is `constant`; keeper writes three bounded fields                 |
| A fee exceeds the ceiling                         | Pass — fuzz, invariant, 100k sweep, live e2e                                        |
| A regular-season swap is charged (new, D-105)     | Pass — calculator, invariant, hook tests                                            |
| A playoff rate falls below the floor (new)        | Pass — `clampRate`, fuzz                                                            |
| A user can directly invoke hook callbacks         | Pass — unchanged `onlyPoolManager`; `quoteFee` is a view with no effects            |
| Zero-liquidity market causes an arithmetic revert | Pass — `_liquidityRatio` guards; scenario matrix row "zero liquidity"               |
| Token ordering changes market math incorrectly    | Pass — `test_feeReadsProbabilityFromPoolStateInBothOrderings`                       |
| Any file exceeds 150 lines                        | Pass — 9 files, max 150 (`MarketFeeCalculator.sol`, `MarketStateRegistry.sol`)      |
| Any TODO or placeholder remains                   | Pass — none                                                                         |
| The 100k-call fee invariant fails                 | Pass — `test_feeInvariantOverOneHundredThousandCalls`                               |
| Backend routing points to the wrong deployment    | N/A until deploy — `DYNAMIC_MARKET_BY_CHAIN` stays empty; the quote degrades to 503 |

## 12. What this review does not do

It does not re-sign the ship gate (`sign-off.md`); that needs the owner's
acceptance of the fee model in production, the still-open M-01, and the
human audit the process requires. It was run before deployment, on the
source at this task's commit; per the security phase rules it must be
re-run on any contract change.
