# Security Review — Markets Contracts + In-Play Freeze Surface

**Task:** P-013 in `docs/tasks/prediction-market-protocol.md` (task 045).
**Scope:** `contracts/src/markets/` — `Market.sol`, `OutcomeToken.sol`,
`MarketFactory.sol`, `Resolver.sol`, `MarketPoolBootstrap.sol` (5 files,
~600 lines) — **plus** the hook files changed for D-103 in-play trading:
`RiskPolicy.sol`, `MarketFlow.sol`, `MarketErrors.sol`,
`MarketStateRegistry.sol` (comments only).
**Spec:** `docs/specs/market-lifecycle.md` (D-103 revision),
`docs/specs/dynamic-market-hook.md` §6/§23 (revised).
**Methodology:** Trail of Bits _Building Secure Contracts_ /
_Not So Smart Contracts_ (code-maturity categories), manual line-by-line
review of every entry point, plus Slither 0.11.4 static analysis (see §5).
**Date:** 2026-09-06
**Reviewer:** AI-assisted (Claude Fable 5). **Not a substitute for a human audit.**

---

## 1. Verdict

**No HIGH findings open.** One MEDIUM is recorded against the new in-play
freeze surface — it is an *operational coupling*, not an on-chain exploit
path, and is bounded by the degradation ladder and the 12-hour backstop; it
needs an owner-acknowledged ops requirement rather than a code change. Three
LOW / informational items are recorded.

P-013 states that HIGH findings block ship. On that criterion the module
passes. It has not been reviewed by a human auditor.

| Severity      | Count | Status                                      |
| ------------- | ----- | ------------------------------------------- |
| HIGH          | 0     | —                                           |
| MEDIUM        | 1     | Open — ops requirement, documented below    |
| LOW           | 2     | Open, documented                            |
| Informational | 2     | Open, documented                            |

---

## 2. The new freeze/backstop surface (D-103), reviewed explicitly

The in-play change replaced "freeze at kickoff, permissionless, two
independent clocks" with "freeze on final, authority-driven, one shared
backstop clock". Each question the task brief posed:

**Griefing via early freeze?** No. `Market.freeze()` now has two windows:
the resolver (and only the resolver) from `startsAt`; anyone from
`startsAt + MAX_EVENT_DURATION`. A stranger calling inside the event window
gets `TooEarlyToFreeze` (`test_strangerCannotFreezeDuringTheEventWindow`).
The subtle hole this required closing: `Resolver.freeze(marketId)` was
previously a **permissionless forward**, and any call through it reaches
`Market.freeze()` with `msg.sender == resolver` — which would have handed
the resolver-only early window to everyone. The forward is now
`onlyAuthorized` (signer/operator), tested by
`test_strangerCannotFreezeThroughTheResolver`. Neither path can freeze
before kickoff (a called-off game is `voidMarket`'s job), so the resolver
cannot pre-emptively close a market being priced pre-game either.

**Backstop bypass?** No path found. The backstop reads two values, both
immutable after creation: `Market.startsAt` (constructor immutable; the
factory rejects past kickoffs) and the registry's `kickoffTimestamp`
(written once in `registerPool`, `PoolAlreadyRegistered` guards re-writes,
and there is no setter — re-verified this pass). The two layers share one
constant, `MAX_EVENT_DURATION = 12 hours`, declared in both `Market.sol`
and `RiskPolicy.sol` and asserted equal in `Market.t.sol`
(`test_backstopMatchesTheHook`). `RiskPolicy.isPastBackstop` computes by
subtraction (`nowTs - kickoffTimestamp >= MAX_EVENT_DURATION`), so a
kickoff near `type(uint64).max` cannot overflow into a never-closing
market; `Market.freeze`/`isTradeable` widen to `uint256` before adding for
the same reason. The hook's backstop is evaluated in `beforeSwap`/
`beforeAddLiquidity` from the block clock only — a keeper that never writes
again cannot extend trading
(`test_swapRevertsAtBackstopWithoutAnyKeeperUpdate`).

**State-machine holes?** Transitions enumerated: `OPEN → FROZEN` (resolver
from kickoff, anyone from backstop), `OPEN → INVALID` (resolver),
`FROZEN → RESOLVED` (resolver), `FROZEN → INVALID` (resolver),
`RESOLVED/INVALID → SETTLED` (bookkeeping on drain). Every mutating entry
point checks state first; there is no path back into `OPEN`, no
`resolve` from `OPEN` (resolve-before-freeze stays rejected — B1-007,
re-tested), no `void` from `RESOLVED`. A market past the backstop but not
yet frozen is still `OPEN` for `split`/`merge` — but `isTradeable()` now
reports false there and the hook has already halted swaps, so the window is
"mint fully-collateralised sets against a decided game", which D-103
explicitly accepts as harmless (a set is always worth exactly $1). The
fuzzed solvency invariants were re-run under the new handler (both freeze
paths reachable): 128k calls, collateral ≥ outstanding sets throughout.

**Fee-calculator reachability.** `MarketFeeCalculator._eventRatio` prices
`FINAL/RESOLVED/VOID` at maximum "defensively" on the assumption the hook
reverts first — still true after the reordering in
`MarketFlow.requireTradeable` (FINAL now reverts before the backstop check;
both revert before `conditions()` runs).

### M-01 — Hook halt and market freeze are keeper/resolver-coupled *(MEDIUM — open, ops requirement)*

**Where:** `MarketFlow.requireTradeable` (hook) vs `Market.freeze` (market).

Under the old semantics both layers froze from the same immutable timestamp
with no liveness dependency. Under D-103 the *normal* halt is data-driven on
both layers, but by **two different writes**: the keeper's
`eventState = FINAL` (halts the pool) and the resolver's `freeze()` (halts
`split`/`merge` and gates `resolve`). If the resolver freezes and resolves
a market while the keeper never writes `FINAL`/`RESOLVED`, the **pool keeps
trading a decided market** until staleness clamps it (≤15 min to
`MAX_FEE`/`MIN_TRADE_CAP`) and the 12-hour backstop closes it. Informed
flow drains the mispriced side of the LP position (largely protocol-owned
seed liquidity) during that window.

**Why not HIGH:** it requires the single resolution service (keeper and
signer are the same key today, spec §0.1) to half-operate — freeze on-chain
markets while failing to write the registry — and the loss is bounded: the
stale clamp engages within `STALE_AFTER = 900 s`, per-trade size falls to
$100, the fee rises to 5%, and no user collateral is at risk (the vault is
untouched; the exposure is LP inventory mispricing).

**Requirement (ops):** the resolution flow MUST write
`eventState = FINAL` in the same operational step as — and before —
`Resolver.freeze()`, and monitoring MUST alert on a `Frozen` market whose
registry state is not `FINAL`/`RESOLVED`. Closing this fully on-chain would
mean the registry learning each market's address (or the hook reading
`Market.isTradeable()`), a wiring change deliberately out of scope for the
minimal D-103 restructure; recorded for the owner.

---

## 3. Findings — markets contracts

### L-01 — `redeemInvalid` burns a lone token for zero payout *(LOW — open)*

**Where:** `Market.redeemInvalid`.

Payout is `total / 2` rounded down. A holder redeeming a single odd token
unit (1 wei of YES, no NO) burns it and receives 0; the rounding dust
accrues to the vault. Solvency is never at risk (rounding is always in the
protocol's favour) and the loss is bounded at 1 wei per redemption, but it
is a burn-for-nothing path a UI should avoid triggering. Recommendation:
none required on-chain; the client should redeem even amounts or warn.

### L-02 — `createMarket` is permissionless *(LOW — open, pre-existing)*

**Where:** `MarketFactory.createMarket` / `createMarketIfAbsent`.

Anyone can deploy a market with an arbitrary `marketId`, `label`, and
`startsAt` through the shared factory, and it will bind the canonical
Resolver. A spoofed market cannot steal funds (its collateral vault is its
own, fully backed) and is never listed (the server lists only ids it
derived itself, and the id preimage is persisted at creation per P-002),
but a squatter could pre-create the *canonical* id for a real game with the
wrong `startsAt`, and the generator's `createMarketIfAbsent` would then
adopt it silently — with a mis-anchored freeze backstop. Recommendation:
have the market generator verify `startsAt` (and label) of an
already-existing market against the schedule before listing, or gate
creation. Pre-existing surface, unchanged by this task; recorded because
`startsAt` now also anchors the trading window's end.

### I-01 — Losing-side tokens survive redemption *(Informational)*

`redeem()` burns only the winning side and leaves losing tokens as a
position record (documented in-code). Consequence: `totalSupply` of the
losing token never drains and `SETTLED` depends only on winning-side
redemption. No accounting path reads the losing supply after resolution;
verified none of the invariants or the hook do either.

### I-02 — Resolver authority concentration *(Informational — tracked by D-104/I-01 carry-over)*

`onlyAuthorized` (signer **or** operator) can freeze-then-resolve in two
transactions with no on-chain delay; the D-104 dispute window is
server-side. One compromised signer key can therefore settle markets
wrongly (the incident-runbook risk recorded in the lifecycle spec §4). The
keeper being the same key couples fee inputs to settlement (sign-off I-01).
Unchanged by this task; carried forward until the keys are split at mainnet
deploy.

---

## 4. Nine-category maturity assessment (markets module)

| Category                     | Rating       | Basis                                                                                                                                                                                                              |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Arithmetic**               | Satisfactory | Solidity 0.8 checked maths; no `unchecked`; the one rounding site (`redeemInvalid`) rounds in the protocol's favour; backstop arithmetic overflow-safe by widening/subtraction (new this pass).                     |
| **Auditing**                 | Satisfactory | Every transition emits (`Split/Merge/Frozen/Resolved/Voided/Redeemed/Settled`); `Resolver` events carry `caller` to distinguish automated vs override settlement (B4-006).                                          |
| **Access controls**          | Satisfactory | `onlyResolver` on resolve/void; two-window freeze (resolver / permissionless-after-backstop); `onlyMarket` mint/burn; Resolver roles rotatable, operator two-step, factory pointer one-shot.                        |
| **Complexity management**    | Satisfactory | Five small files, single-purpose; no inheritance beyond ERC20; the state machine is a five-value enum with explicit guards.                                                                                          |
| **Decentralisation**         | Weak         | Resolver signer/operator are EOAs; settlement is trusted (D-104 accepted). Inherent to v1; not a code defect.                                                                                                       |
| **Documentation**            | Satisfactory | Every non-obvious choice states its reason; the D-103 revision updated every stale kickoff-freeze comment found by grep.                                                                                            |
| **Transaction ordering**     | Moderate     | In-play trading makes result-latency arbitrage the *product*, priced by the hook's fee ladder; the M-01 window above is the residual. `split`/`merge` are exact and unfront-runnable.                               |
| **Low-level manipulation**   | Satisfactory | No `assembly`, `delegatecall`, `tx.origin`, `selfdestruct`, or raw `call` anywhere in `src/markets/` (grep-verified this pass).                                                                                     |
| **Testing and verification** | Satisfactory | 209 non-fork tests green including 128k-call solvency invariants with both freeze paths reachable; local E2E gained the in-game leg; fork E2E (P-014) proves the journey on mainnet state with real USDC.           |

---

## 5. Static analysis (Slither 0.11.4)

Run this pass via `contracts/script/security/run-slither.sh` (extended by
task 045 to cover the first-party contracts).

**Why the directory was empty.** The previous review and `findings.md` both
cite `docs/security/slither/`, and an audit found it holding nothing but
`.gitkeep`. The cause was not a missing run: `.gitignore` carried
`docs/security/slither/*` under its **"# Logs"** heading, so any output a
run produced was ignored as if it were regenerable log noise. Cited security
evidence must be tracked, so the ignore rule now negates per-artifact.
Raw outputs are checked in:

- `docs/security/slither/markets-dynamic-market.txt` (human-readable)
- `docs/security/slither/markets-dynamic-market.json` (detector JSON)

**27 findings: 0 High, 9 Medium, 18 Low/Info.** Every Medium triaged:

| Detector             | Where                                        | Triage                                                                                                                                                          |
| -------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `incorrect-equality` | `_settleIfDrained`, `redeem`, `redeemInvalid`, `MarketFlow.conditions` | Strict equality against 0 on balances/counters the contract itself decrements — the intended drain/empty checks, not attacker-reachable equalities. False positive. |
| `reentrancy-no-eth`  | `redeem`, `redeemInvalid` (burn before state write in `_settleIfDrained`) | "External" callee is the market's own `OutcomeToken` (`onlyMarket`, no hooks/callbacks, solmate ERC20). No reentrancy vector; burn-before-pay is the CEI ordering that protects the invariant. |
| `uninitialized-local`| `MarketFlow.record().move`                   | Deliberate: defaults to 0 for the first swap (no prior price ⇒ zero volatility observation), documented in-code.                                                  |
| `unused-return`      | `getSlot0` partial destructuring (hook + flow) | Only `sqrtPriceX96` is needed; the remaining slot0 fields are irrelevant to the fee path.                                                                        |

Lows are the standard `timestamp` (the design *is* time-based — the
backstop must read the clock), `reentrancy-events` (events after burns of
the trusted token), and `missing-zero-check` on constructor args already
guarded elsewhere. None actionable.

The vendored hook submodules (`stable-protection`, `dynamic-fee`) still
fail to compile standalone under this environment's solc-select-less setup;
their rows in `run-slither.sh` are unchanged and out of scope here.

---

## 6. Not done

- **Human audit** — required before real value is at risk (unchanged from
  the B2-007 review).
- **Second-model review** (spec §45's Gemini pass) — not run.
- **M-01 monitoring** — the frozen-but-not-FINAL alert does not exist yet;
  it is an ops deliverable, flagged to the owner above.
