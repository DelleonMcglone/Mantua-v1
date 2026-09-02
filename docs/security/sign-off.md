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
