# Security Review — Dynamic Market Hook

**Task:** B2-007 in `docs/tasks/sports-pivot.md`
**Scope:** `contracts/src/hooks/dynamic-market/` — 8 files, 953 lines
**Spec:** `docs/specs/dynamic-market-hook.md` (§28 security model, §44 failure conditions)
**Methodology:** Trail of Bits _Building Secure Contracts_ / _Not So Smart Contracts_, via
`DelleonMcglone/AI-assisted-security-analysis` → `plugins/building-secure-contracts`
(code-maturity-assessor, nine categories) and `plugins/static-analysis`.
**Date:** 2026-08-17
**Reviewer:** AI-assisted (Claude Opus 5). **Not a substitute for a human audit.**

---

## 1. Verdict

**No HIGH findings open.** One MEDIUM was found and fixed during review. Three
LOW / informational items are recorded below, two of which need an owner
decision rather than a code change.

B2-007 states that HIGH findings block ship. On that criterion the module
passes. It has not been reviewed by a human auditor, and §45 additionally
requires a Gemini 2.5 Pro pass that has not been run — see §6.

| Severity      | Count | Status                     |
| ------------- | ----- | -------------------------- |
| HIGH          | 0     | —                          |
| MEDIUM        | 1     | Fixed in this pass         |
| LOW           | 2     | Open, documented           |
| Informational | 1     | Open, needs owner decision |

---

## 2. Findings

### M-01 — Flow accumulators mixed token units _(MEDIUM — FIXED)_

**Where:** `MarketFlow.record`, `DynamicMarketHook.afterSwap`

`buy` and `sell` accumulated the raw magnitude of `params.amountSpecified`. That
field is denominated in the **input** token on an exact-input swap and the
**output** token on an exact-output one, so on one side of the book it is YES
shares and on the other it is USDC. The two totals were then differenced to
produce the §14 imbalance.

**Impact.** The imbalance premium and the directional adjustment both read a
quantity that was not comparable across sides. Concretely, selling 1000 YES at
5¢ — $50 of real exposure — registered the same 1000 units of flow as a $1000
USDC buy, a twentyfold overstatement. Because the imbalance premium and the
trade cap both derive from this number, a market trading at a low probability
would price fees and shrink size against phantom imbalance. No funds are at
risk (all values stay inside the immutable bounds), but the fee signal was
wrong in a way that biased systematically with probability, not randomly.

**Fix.** `afterSwap` now computes `MarketMath.usdcNotional` and passes it in;
`record` accumulates that. Both sides are USDC. Regression test:
`test_flowAccumulatesUsdcNotionalNotRawAmount`.

### L-01 — Imbalance divides a token amount by v4 liquidity _(LOW — open)_

**Where:** `MarketMath.imbalanceBps`, called from `MarketFlow.conditions`

Net flow is now in USDC (6dp) but `liquidity` is Uniswap v4's `L`, which is
`sqrt(x·y)` in sqrt-price space — not a token balance. The ratio is therefore
dimensionally inconsistent: it is monotonic in the right direction, and it is
bounded, so it behaves sanely, but it is not "flow as a fraction of available
depth" in any exact sense, and its scale shifts with the pool's price range.

**Impact.** The imbalance premium is a heuristic rather than a measurement. It
will read differently for two pools with identical flow and identical dollar
depth but different tick ranges. Bounded and non-exploitable; wrong in
magnitude.

**Recommendation.** Convert `L` to a USDC-equivalent depth before dividing, or
define imbalance against cumulative flow instead of liquidity. This is a
modelling decision, so it is reported rather than silently changed.

### L-02 — `setKeeper` is single-step while operator transfer is two-step _(LOW — open)_

**Where:** `MarketStateRegistry.setKeeper`

§26 requires two-step transfer for the operator, and that is implemented. The
keeper is rotated in one call, so a mistyped address takes effect immediately.

**Impact.** Bounded by design rather than by luck: with no keeper able to write,
state goes stale, and §22 sends the fee to `MAX_FEE` and the cap to
`MIN_TRADE_CAP`. Markets stay tradeable and the §6 freeze still fires. The
failure is expensive, not fatal, and an operator can re-rotate. Not raised to
MEDIUM for that reason.

**Recommendation.** Either mirror the two-step pattern, or accept and document
that a bad keeper rotation degrades pricing until corrected.

### I-01 — Keeper and resolver are the same key _(Informational — owner decision)_

Recorded in spec §0.1. The keeper that writes model probability, confidence, and
event state is the same key that resolves and voids markets. One compromise
therefore both skews fees and settles outcomes.

Containment that does hold: no keeper write can exceed the immutable §27 bounds;
the §6 freeze is timestamp-driven and fires regardless; and keeper is separate
from **operator**, so a compromised keeper cannot register pools, pause, or
rotate roles. DM-103 is still open on whether that key becomes a multisig —
doing so would close this.

---

## 3. Nine-category maturity assessment

| Category                     | Rating       | Basis                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arithmetic**               | Satisfactory | Solidity 0.8 checked maths throughout; **zero `unchecked` blocks**. `FullMath.mulDiv` for every 512-bit intermediate (`sqrtPriceX96²` overflows `uint256`). Rounding is division-truncation only, always in the protocol's favour. Bounds fuzzed at 128k calls plus a 100k deterministic sweep. |
| **Auditing**                 | Moderate     | `MarketFeeUpdated` publishes the full premium decomposition per swap (§29); registry emits on registration, keeper write, pause, and both role changes. No off-chain monitoring exists yet — B10-009 covers the runbook.                                                                        |
| **Access controls**          | Satisfactory | Three roles, separated: PoolManager (callbacks), keeper (three fields), operator (registration/pause/roles). `onlyPoolManager` on all four callbacks; direct-call rejection tested for each. Two-step operator transfer. No `owner` god-role.                                                   |
| **Complexity management**    | Satisfactory | Eight files, each ≤150 lines, each with a purpose statement. Pure maths isolated in `MarketMath`; policy constants isolated in `RiskPolicy`; no inheritance beyond one interface.                                                                                                               |
| **Decentralisation**         | Weak         | A single keeper key drives model inputs and a single operator key controls registration and pause; both are EOAs today. This is inherent to the design at v1 and is acknowledged in spec §2.1 and Risk 2 of the pivot plan, not a defect in this code.                                          |
| **Documentation**            | Satisfactory | Every module carries a purpose statement and spec cross-references; every non-obvious choice states its reason (rational decay, saturating add, absent stubs, `FREEZE_LEAD = 0`).                                                                                                               |
| **Transaction ordering**     | Moderate     | Fee and cap depend on pool price, so a swap can be sandwiched to move the fee it pays. Bounded by `[BASE_FEE, MAX_FEE]`, and the directional adjustment charges the risk-increasing side, which penalises exactly that behaviour. Not eliminated.                                               |
| **Low-level manipulation**   | Satisfactory | No `assembly`, no `delegatecall`, no `tx.origin`, no `selfdestruct`, no raw `call`. Verified by grep across the module.                                                                                                                                                                         |
| **Testing and verification** | Satisfactory | 134 tests. All 16 §33 edge cases covered explicitly. 128k-call invariant campaign with **0 reverts**, plus a 100k deterministic sweep asserting the fee band.                                                                                                                                   |

---

## 4. §44 failure conditions — checked one by one

| Condition                                      | Result | Evidence                                                                                     |
| ---------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Keeper can increase `MAX_FEE`                  | PASS   | `constant` in a library; no setter exists anywhere                                           |
| Keeper can increase `ABS_MAX_TRADE`            | PASS   | Same                                                                                         |
| Unregistered pool can initialize               | PASS   | `test_unregisteredPoolCannotInitialize`                                                      |
| Static-fee pool can use the hook               | PASS   | `test_staticFeePoolIsRejected`                                                               |
| User can invoke callbacks directly             | PASS   | Four direct-call rejection tests                                                             |
| Kickoff freeze depends on a keeper update      | PASS   | `test_swapRevertsAfterKickoffWithoutAnyKeeperUpdate` — no keeper write ever occurs           |
| Stale keeper state bricks the market           | PASS   | `test_staleKeeperStateChargesMaxFeeWithoutReverting`                                         |
| LPs cannot remove liquidity during a halt      | PASS   | No `BEFORE_REMOVE_LIQUIDITY` bit; the function is not implemented                            |
| `BEFORE_REMOVE_LIQUIDITY` enabled              | PASS   | `test_forbiddenPermissionsAreNotEncoded`                                                     |
| `BEFORE_SWAP_RETURNS_DELTA` enabled            | PASS   | Same; `beforeSwap` returns `ZERO_DELTA`                                                      |
| Fee below `BASE_FEE`                           | PASS   | `clampFee`; 128k invariant + 100k sweep                                                      |
| Fee above `MAX_FEE`                            | PASS   | Same                                                                                         |
| Trade above the cap succeeds                   | PASS   | `test_swapAboveTheCapReverts`                                                                |
| Halted market accepts a swap                   | PASS   | Five halt tests (frozen, paused, global pause, resolved, void)                               |
| Zero liquidity causes unintended revert        | PASS   | `test_zeroLiquidityIsMaximumImbalanceNotARevert`, `test_zeroLiquidityCapIsTheMinimum`        |
| Token ordering changes market math incorrectly | PASS   | Both orderings tested; `test_wrongOrderingSaturatesRatherThanMirroring` documents the hazard |
| Keeper inputs accepted outside bounds          | PASS   | Two rejection tests; bounds checked _before_ storage                                         |
| Uses `tx.origin` / `delegatecall`              | PASS   | Grep-verified absent                                                                         |
| Unbounded loop in a callback                   | PASS   | Grep-verified: no loop anywhere in the module                                                |
| Any file exceeds 150 lines                     | PASS   | Largest is 150 (`MarketStateRegistry`); hook is 144                                          |
| Any TODO or placeholder remains                | PASS   | Grep-verified absent                                                                         |
| Deployment does not satisfy `0x28C0`           | PASS   | Deployed 2026-08-17 at `0xbb5D…E8c0`; bits asserted in-tx and re-derived from the address    |
| Backend routing wrong                          | PASS   | `getV4StackForHook` resolves the hook to its own stack; live pools probed post-deploy        |
| Tests miss a specified edge case               | PASS   | All 16 mapped to named tests                                                                 |
| 100k-call fee invariant fails                  | PASS   | Passes at 100k sweep and 128k campaign                                                       |

---

## 5. Deviations from spec

1. **Eight files, not seven.** `MarketFlow.sol` was added. §30 names seven
   modules; keeping the hook inside the §44 150-line limit required extracting
   flow accumulation, the halt check, and condition assembly. §30 lists required
   modules rather than forbidding others, so this is judged the lesser
   deviation — but it is a deviation.

2. **Unpermissioned `IHooks` callbacks are not implemented** rather than stubbed
   to revert, and the contract does not declare `is IHooks`. v4 dispatches only
   the callbacks the address bits permit, so an unpermissioned one is
   unreachable; omitting them is strictly safer than a stub and saved ~60 lines.

3. **The Nezlobin directional logic is re-derived, not imported.** The
   dynamic-fee `FeeCalculator` keys off `DeviationMonitor.Zone`, an
   oracle-deviation type a prediction market cannot produce — there is no
   external reference price to deviate from. The asymmetry (toxic side pays
   more) is reused; the lookup table is not.

4. **`ComplianceRegistry` two-step transfer re-implemented.** The RWAgate repo is
   not a submodule here, so the pattern could not be imported (spec §0.5).

---

## 6. Not done

- **B2-005 deployment** — needs a funded Base Mainnet deployer key and the
  CREATE2 salt mine. No mainnet contract has been deployed and no address
  recorded.
- **Human audit** — required before real value is at risk.
- **Gemini 2.5 Pro review** (§45) — not run.
- **Slither / Semgrep** — neither is installed in this environment, so the
  static-analysis pass was performed by targeted inspection and grep rather
  than by a tool. Running Slither before deployment is recommended.
