# Security Sign-off — Sports Pivot Ship Gate (B10-007)

Status: **SIGNED — LOW findings accepted by the owner.**
Prepared 2026-08-17 against commit `aeb210e` + the B10 E2E additions.

## 1. Findings status

Source review: [dynamic-market-hook-review.md](./dynamic-market-hook-review.md)
(Trail of Bits methodology, B2-007).

| Severity      | Open  | Notes                                                                                   |
| ------------- | ----- | --------------------------------------------------------------------------------------- |
| HIGH          | **0** | Ship criterion "zero HIGH open" is met                                                  |
| MEDIUM        | 0     | M-01 (flow accumulators mixed token units) found and fixed in review, regression-tested |
| LOW           | 2     | L-01, L-02 — described below, acceptance required                                       |
| Informational | 1     | I-01 — keeper = resolver key; an owner decision (DM-103), recorded                      |

### Open items requiring written acceptance

- **L-01 — imbalance premium divides USDC flow by v4 liquidity.** Dimensional
  mismatch makes the imbalance premium scale-dependent. Worst case: a
  mispriced _fee premium_ within the hard [BASE_FEE, MAX_FEE] band — never a
  loss of funds; the band is enforced by invariant tests (128k calls).
- **L-02 — `setKeeper` is single-step** while operator transfer is two-step.
  A typoed keeper rotation could hand keeper writes to a dead address;
  recovery is a second `setKeeper` by the operator. No user funds at risk;
  stale keeper state fails closed to MAX_FEE.

**Owner acceptance:** Delleon McGlone, 2026-08-18 — L-01 and L-02 accepted
for the pre-launch ship ("accept L-01 and L-02", in session). The L-01 fix is
scheduled behind the trading-UI work; L-02 joins the next contract change
that touches the registry.

## 2. Safety rails re-verification (B10-001)

Each rail, where it is enforced, and the test or live check that proves it:

| Rail                      | Enforcement point                                                                                                           | Evidence                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Agent spending caps       | server cap model (`updateAgentWalletCap`) + per-strategy `capUsd` independent of wallet cap                                 | existing agent tests; `strategies.test.ts` cap-clamped rebalance             |
| Contract allowlist        | `circle/allowed-targets.ts` inside BOTH Circle execution choke points                                                       | `allowed-targets.test.ts`; refusal is a typed error                          |
| Confirmation before spend | strategies arm only via structured confirm (prose never arms); agent swaps keep the existing confirm flow                   | `strategies.ts` routes; B9-004 tests                                         |
| Kill switches             | `MANTUA_KILL_SWITCH` (all writes) + `STRATEGIES_KILL_SWITCH` (disarms every armed strategy next tick) + per-strategy disarm | `strategies.test.ts` precedence block                                        |
| Rate limits               | global `ipRateLimiter` + `walletRateLimiter` on public chat + `writeRateLimiter` on writes                                  | existing middleware tests; B5-008                                            |
| Audit log                 | every strategy transition + every agent action writes `mantua_audit_log`; resolutions logged only with a tx hash            | `strategy-store.ts`; `resolution.test.ts` "nothing logged without a tx hash" |
| Freeze integrity          | three layers: contract time-freeze, hook timestamp check, service sweep — and strategies disarm on the same clock           | `FullLifecycle.t.sol` step 5; B9-007 tests                                   |
| Injection hardening       | provider strings sanitized once at the serializer; analyst prompt frames feed text as data                                  | `public-slate.test.ts`; B8-008                                               |

## 3. E2E proofs (B10-002/003/004/006)

- `contracts/test/e2e/FullLifecycle.t.sol` — create → split both sides →
  pool under the hook at p=0.50 → LP → swap moves price → kickoff freeze
  (trading blocked, **LP exit still open**) → resolve YES → both parties
  redeem 1:1 → market ends solvent.
- Same harness — postponed game voids: both sides redeem at exactly 0.50,
  market drains to zero collateral.
- `resolution.test.ts` B10-004 — mid-game provider outage: markets still
  freeze on delayed data (safety is timestamp-driven) but **nothing settles
  from a stale cache**, even one containing a "final"; fresh data resolves.
- `strategies.test.ts` B10-006 — hold through drift, fire on the cross,
  disarm at kickoff even at the most tempting price.

## 4. Known gaps, tracked and gated

- Position **execution** (strategy triggers → swaps) and outcome-token
  trading wait on the v4 periphery deploy; triggers persist with audit
  rather than guessing a venue.
- Human audit and a second-model review remain recommended before the
  Base Mainnet contract deployment (this sign-off predates it).
- Slither/Semgrep CI runs remain a follow-up from the B2-007 review.

---

# Addendum — 2026-09-06: in-play trading (D-103) + markets review

**Nothing above this line is altered.** Sections 1–4 record the state signed
on 2026-08-18 and stand as written. This addendum records a **contract
semantics change made after that signing**, and the review run against it.

## A1. What changed

Owner decision **D-103** (2026-09-06) replaced kickoff-freeze with **in-play
trading**: buy/sell runs before *and during* the event. Implemented in task
045 (`docs/tasks/045-inplay-trading-security-e2e.md`).

| Layer                | Signed design (2026-08-18)                          | After D-103                                                                                     |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Market.freeze()`    | Permissionless at `startsAt`                        | Resolver-only from `startsAt`; **permissionless from `startsAt + MAX_EVENT_DURATION` (12 h)**    |
| `Resolver.freeze()`  | Permissionless forward                              | `onlyAuthorized` (signer/operator) — see M-01 note below                                        |
| Hook swap gate       | `RiskPolicy.isFrozen` — pure time at kickoff        | Market-state-driven (`FINAL`) + `RiskPolicy.isPastBackstop` time backstop                       |
| `split` / `merge`    | Closed at kickoff                                   | Open while trading is open; still close at freeze                                               |
| Registry kickoff     | Immutable, no setter                                | **Unchanged** — still immutable, now anchoring the backstop and fee dynamics                     |

Preserved unchanged and re-verified: once-only pool registration, no kickoff
setter, dynamic-fee-only pools, `onlyPoolManager` callbacks, no
`BEFORE_REMOVE_LIQUIDITY` (LP exit stays open during a halt),
resolve-before-freeze rejection, the immutable `RiskPolicy` bounds.

## A2. Section 2 rail correction — "Freeze integrity"

The §2 table's Freeze-integrity row ("three layers: contract time-freeze,
hook timestamp check, service sweep — and strategies disarm on the same
clock") describes the **pre-D-103** design and no longer matches the code.
As of this addendum the rail reads:

| Rail             | Enforcement point                                                                                                                                                        | Evidence                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Freeze integrity | Resolver freeze on final (contract) + hook halt on `eventState = FINAL` + **shared 12 h time backstop** on both layers (`Market.MAX_EVENT_DURATION` == `RiskPolicy.MAX_EVENT_DURATION`) | `Market.t.sol` freeze-window tests, `test_backstopMatchesTheHook`, `FullLifecycle.t.sol` in-game leg |

The service-side strategy disarm (B9-007) moved with the contract in task
046: `ticksFromSlates` marks a market `frozen` when the event is `final` (or
void) or once `startsAt + MAX_EVENT_DURATION` has passed, so a strategy now
stays armed through the game and disarms on the same close the contract
enforces. Safety precedence is unchanged — disarm conditions are still
evaluated before trigger conditions, so a strategy can never fire on a frozen
or resolved market.

## A3. Review status after the change

Source review:
[markets-contracts-review.md](./markets-contracts-review.md) — P-013,
Trail of Bits methodology, covering `contracts/src/markets/` plus the hook
files changed for D-103, with the new freeze/backstop surface reviewed
explicitly (early-freeze griefing, backstop bypass, state-machine holes).

| Severity      | Open  | Notes                                                                                                    |
| ------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| HIGH          | **0** | Ship criterion "zero HIGH open" still met                                                                |
| MEDIUM        | 1     | M-01 — halt/freeze are keeper/resolver-coupled; bounded by the stale clamp + backstop. **Ops requirement, needs owner acceptance** |
| LOW           | 2     | L-01 `redeemInvalid` odd-unit dust; L-02 permissionless `createMarket` (pre-existing, now also anchors the trading window) |
| Informational | 2     | I-01 losing-side tokens survive redemption; I-02 resolver authority concentration (carries B10-007 I-01)  |

One finding was fixed during review rather than reported: the permissionless
`Resolver.freeze()` forward would have handed the resolver-only early-freeze
window to any caller (every call through the Resolver reaches
`Market.freeze()` as the resolver). It is now `onlyAuthorized`, with
`test_strangerCannotFreezeThroughTheResolver` as the regression.

**Open item requiring written acceptance (new):**

- **M-01 — freeze/halt coupling.** If the resolution service freezes and
  resolves a market on-chain while failing to write `eventState = FINAL` to
  the registry, the pool keeps trading a decided market until staleness
  clamps it (≤15 min → `MAX_FEE` / `MIN_TRADE_CAP`) and the 12 h backstop
  closes it. No user collateral is at risk; the exposure is LP inventory
  mispricing against informed flow. **Mitigation is operational:** write
  `FINAL` before `Resolver.freeze()` in the same step, and alert on any
  `Frozen` market whose registry state is not `FINAL`/`RESOLVED`.

**Owner acceptance:** ⬜ pending — M-01 has not been accepted, and the
monitoring it requires does not exist yet.

## A4. Static analysis — the §4 follow-up, now run

Slither 0.11.4 ran against the first-party contracts;
`contracts/script/security/run-slither.sh` was extended to cover them, and
the raw outputs the previous review cited but never produced are now in the
repo: `docs/security/slither/markets-dynamic-market.{txt,json}`.
**27 findings: 0 High, 9 Medium, 18 Low/Info**, every Medium triaged as a
false positive in §5 of the markets review. The vendored hook submodules
still do not compile standalone in this environment and remain uncovered.

## A5. E2E proofs added (P-014)

- `contracts/test/e2e/FullLifecycle.t.sol` — now carries the **in-game
  leg**: trade after kickoff succeeds, then resolver freeze on final,
  swaps blocked / LP exit open, resolve, redeem, solvent-empty.
- `contracts/test/integration/MarketLifecycleForkE2E.t.sol` — the same
  journey on a **Base Mainnet fork with real USDC**, over a
  CREATE2-mined hook and the deploy scripts' own wiring.

## A6. What this addendum does not do

It does not re-sign the ship gate. The original signing covered the
kickoff-freeze design; the semantics have since changed, M-01 is unaccepted,
and the human audit and second-model review remain outstanding as before.
