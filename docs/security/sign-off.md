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
  Arc Mainnet contract deployment (this sign-off predates it).
- Slither/Semgrep CI runs remain a follow-up from the B2-007 review.

---

# Addendum — 2026-09-06: in-play trading (D-103) + markets review

**Nothing above this line is altered.** Sections 1–4 record the state signed
on 2026-08-18 and stand as written. This addendum records a **contract
semantics change made after that signing**, and the review run against it.

## A1. What changed

Owner decision **D-103** (2026-09-06) replaced kickoff-freeze with **in-play
trading**: buy/sell runs before _and during_ the event. Implemented in task
045 (`docs/tasks/045-inplay-trading-security-e2e.md`).

| Layer               | Signed design (2026-08-18)                   | After D-103                                                                                   |
| ------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Market.freeze()`   | Permissionless at `startsAt`                 | Resolver-only from `startsAt`; **permissionless from `startsAt + MAX_EVENT_DURATION` (12 h)** |
| `Resolver.freeze()` | Permissionless forward                       | `onlyAuthorized` (signer/operator) — see M-01 note below                                      |
| Hook swap gate      | `RiskPolicy.isFrozen` — pure time at kickoff | Market-state-driven (`FINAL`) + `RiskPolicy.isPastBackstop` time backstop                     |
| `split` / `merge`   | Closed at kickoff                            | Open while trading is open; still close at freeze                                             |
| Registry kickoff    | Immutable, no setter                         | **Unchanged** — still immutable, now anchoring the backstop and fee dynamics                  |

Preserved unchanged and re-verified: once-only pool registration, no kickoff
setter, dynamic-fee-only pools, `onlyPoolManager` callbacks, no
`BEFORE_REMOVE_LIQUIDITY` (LP exit stays open during a halt),
resolve-before-freeze rejection, the immutable `RiskPolicy` bounds.

## A2. Section 2 rail correction — "Freeze integrity"

The §2 table's Freeze-integrity row ("three layers: contract time-freeze,
hook timestamp check, service sweep — and strategies disarm on the same
clock") describes the **pre-D-103** design and no longer matches the code.
As of this addendum the rail reads:

| Rail             | Enforcement point                                                                                                                                                                       | Evidence                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
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

| Severity      | Open  | Notes                                                                                                                              |
| ------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| HIGH          | **0** | Ship criterion "zero HIGH open" still met                                                                                          |
| MEDIUM        | 1     | M-01 — halt/freeze are keeper/resolver-coupled; bounded by the stale clamp + backstop. **Ops requirement, needs owner acceptance** |
| LOW           | 2     | L-01 `redeemInvalid` odd-unit dust; L-02 permissionless `createMarket` (pre-existing, now also anchors the trading window)         |
| Informational | 2     | I-01 losing-side tokens survive redemption; I-02 resolver authority concentration (carries B10-007 I-01)                           |

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
  journey on a **mainnet fork with real USDC** (Base at the time; since 2026-09-30 the fork is Arc Mainnet with a 6-dp mock collateral — Arc's native USDC needs arc-foundry), over a
  CREATE2-mined hook and the deploy scripts' own wiring.

## A6. What this addendum does not do

It does not re-sign the ship gate. The original signing covered the
kickoff-freeze design; the semantics have since changed, M-01 is unaccepted,
and the human audit and second-model review remain outstanding as before.

## A7. Fee model change (task 049, D-105) — 2026-09-12

The hook's fee moved from the 0.30%–5.00% premium band this document was
signed against to the owner's fee model: **0% in the regular season;
0.10%–0.70% dynamic in the playoffs**, applied as
`Fee = C × rate × p × (1 − p)` with an immutable 0.70% ceiling. Every
statement above that names `BASE_FEE` or `MAX_FEE` (the L-01 band, the
M-01 stale clamp) now reads `MIN_RATE` / `MAX_RATE` for playoff pools and
0% for regular-season pools; the stale-keeper clamp is otherwise unchanged.

Review: [`dynamic-market-fee-review.md`](./dynamic-market-fee-review.md) —
**0 HIGH, 0 MEDIUM**, two LOW (L-03 volatility griefing within its bounded
share; L-04 sell-side telemetry valuation), two informational. Slither
re-run unchanged from the P-013 baseline. Tests: 236 local contract tests
(hooks, e2e, markets) green including the 100k-call invariant sweep and an
on-chain fee proof in `FullLifecycle.t.sol`; the mainnet fork suites (Arc since 2026-09-30)
could not run in the review environment (RPC egress blocked) and must be
run before deploy.

**This addendum does not re-sign the ship gate.** M-01 remains unaccepted,
L-03 needs the owner's written note, the fork suites need a run, and the
human audit and second-model review remain outstanding as before.

# Addendum — 2026-09-13: launch gate (task 067, D-117)

Scope: the surfaces shipped after A1–A7 (consumer trading layer,
reliability spine, agent core, portfolio, and the legal acceptance
record). Full review: [`launch-gate-review.md`](./launch-gate-review.md).

## B1. Rails re-verified

Every rail in §2 is traced to its enforcement point on the new surfaces
and to a test (`launch-gate-review.md` §2). No rail regressed. The only
new write, Terms acceptance, sits behind `requireAuth`,
`writeRateLimiter`, and the kill switch like every other write.

## B2. Guards that are now tests

- Security headers on every response (`security-headers.test.ts`).
- Every mutating route carries a guard, with three allowlisted exceptions
  that name their reason (`route-guards.test.ts`).
- No secret in any tracked file (`secret-scan.test.ts`).
- The real client in a real browser: Discover → Trade → Executed, the
  error copy, the pause, the legal pages (`client/e2e`, in CI).

## B3. Dependency posture

`express-rate-limit` bumped to 8.7.0. Seventeen high advisories remain,
each triaged in `launch-gate-review.md` §4; none reaches a production
request path with attacker-controlled input. The SDK bump that clears
the `ws` and `axios` entries is a separate task.

## B4. What this addendum does not do

It does not re-sign the ship gate. Still outstanding and unchanged: M-01
written acceptance, the L-03 note, and the human audit and second-model
review before the mainnet deploy. Two items A7 left open have moved: the
fork suites run green in CI on an Arc Mainnet fork (Base before 2026-09-30) (`contracts.yml`, ledger
G-003), and a Content-Security-Policy now ships in report-only mode with a
report endpoint (`launch-gate-review.md` §3) — enforcement waits on a clean
report window. The ledger in `docs/tasks/launch-gate.md` carries the rest
as 🟡 rows.

# Addendum — 2026-10-01: Arc Mainnet deploy and written acceptances (L-003)

Scope: everything that shipped between B4 and the Arc Mainnet deploy, the
written acceptances L-003 asks the owner for, and one new finding (K-01)
that surfaced while preparing them. This addendum does **not** re-sign the
ship gate; see C8 for what stands between here and open markets.

## C1. What changed since B

| Change                                                                                                                     | Where                                           | Security-relevant detail                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch chain moved to **Arc Mainnet (5042)**, Base stripped (B-002/B-003/B-005)                                            | PRs #87–#89                                     | One `SupportedChainId`; chain identity never reaches the UI; USDC is the gas token (18-dp native view of the same 6-dp balance, converted at the edge).                                                                                                                                                     |
| Full Dynamic Market stack deployed on Arc (H-009 / L-018)                                                                  | PRs #90, #91; `deploy/dynamic-market/README.md` | Hook `0xb23d…28c0` bytecode hash `0x103be191…d25880c` is byte-identical to the build A7 was reviewed against; permission bits `0x28C0` asserted in-tx and re-checked; all 11 contracts source-verified on Arcscan (Sourcify exact matches). Operator = keeper = deployer `0x4EF8…12C3` (DM-103, unchanged). |
| Circle mainnet credentials, Gas Station policy on Arc (C-001/C-005/C-006/C-017)                                            | PR #94; `docs/tasks/018-circle-credentials.md`  | Live key + entity secret stored as _sensitive_ in Vercel; recovery files kept offline. Sponsored transaction proven: the agent SCA paid zero gas (tx `0x1b9e52f2…ac51`). The agent-wallet custody boundary (D-008/D-110) is unchanged.                                                                      |
| Provider outage fix: cross-provider event identity + fallback (R-012)                                                      | PRs #92, #100, #101                             | New `events.provider_ids` column; a second provider may refresh a row but never changes its owner or market id. ESPN serves the live tick while the Sportradar key is a trial.                                                                                                                              |
| Seller gates un-darked (MP-003) **by owner decision ahead of the D-012 counsel sign-off**                                  | Vercel env, 2026-10-01                          | Six x402 services answer 402; payout = operator EOA on Arc. One bug found live and fixed: the Gateway scheme clobbered the vanilla rail's EIP-3009 domain (PR #103).                                                                                                                                        |
| AgenticCommerce: the ERC-8183 reference vendored, deploy script + lifecycle tests                                          | PR #102                                         | **Not deployed.** Third-party escrow (`erc-8183/base-contracts@142e669`, MIT, UUPS) with no audit on record; the broadcast is held behind this gate. Server ABI pinned to the compiled artifact.                                                                                                            |
| Dedicated Arc RPC in production (R-006); x402 boot rejection and VAPID key-length bugs fixed; resolution-backfill workflow | PRs #97, #99, #98/#100                          | No rail change.                                                                                                                                                                                                                                                                                             |

## C2. Rails re-verified

Unchanged from B1/B2: security headers, route-guard audit and secret scan
run with the unit suite (1,314 server tests green on 2026-09-30; the one
local failure is the secret scan reading an untracked `.env`). New guards
since B: `agent-commerce.test.ts` (server ABI ↔ compiled ERC-8183
artifact), `active-provider-chain*.test.ts` (a trial Sportradar key never
serves the live tick), `x402-service.test.ts` boot-hygiene, and the
paywall test now models the real Gateway facilitator's kind `extra`.

## C3. M-01 — status, and a new finding it exposes

The monitoring M-01 asked for now exists: `frozen_not_final` is a
**critical** alert evaluated on every live-sync tick (5-minute grace;
`docs/ops/monitoring.md` §M-01) and surfaced on `/api/ops/alerts`. The
pager vendor (R-010) is still unconnected, so today it is a log line.

Preparing the ordering half of the mitigation ("write `FINAL` before
`Resolver.freeze()`") surfaced that it cannot be implemented yet:

- **K-01 — no keeper writes to the registry (Medium, new).** The server
  registers pools (`registerPool`) but nothing ever calls
  `MarketStateRegistry.updateMarket(poolId, modelProbability, confidence,
eventState)`. Per spec §22 a never-written pool is stale from the
  moment it is registered, so with markets open every pool would trade in
  the fail-closed regime permanently: playoff rate pinned at `MAX_RATE`
  (0.70%), trade cap pinned at `MIN_TRADE_CAP` ($100) for every pool, the
  deviation premium excluded, and the data-driven `FINAL` halt (§23)
  never firing — leaving only the 12-hour backstop and `Resolver.freeze()`
  to stop trading on a decided game. No user collateral is at risk and
  the backstop still bounds the window (§6), but the pricing model the
  fee review signed off on would not be the one running.
  **Disposition: engineering, not acceptance** — a keeper tick (same
  signer key as the resolver, DM-103) that posts probability / confidence
  / event state for every registered pool inside `STALE_AFTER`, and
  writes `FINAL` before the freeze. Must land before
  `MARKET_SIGNER_PRIVATE_KEY` is set. **Landed in code 2026-10-01** (`server/src/lib/sports/registry-keeper.ts` + `-plan.ts`, on the five-minute live-sync tick: live provider probability with the opening probability as fallback, confidence lowered on fallback or a delayed feed, refresh every 600 s < 900 s, state changes written immediately, terminal states never rewritten; planner pinned by 8 tests). **Proven on a fork 2026-10-01:** `npm run keeper:fork-proof -w @mantua/server` runs the real server loop (read → plan → simulate → write → receipt) against an `arc-anvil` fork of Arc Mainnet and the deployed registry (`0xEA8c…c7a6`, operator impersonated, keeper rotated to anvil's public account for the run — no key leaves the keystore): a new pool gets its opening state (PRE_GAME, 5500 bps, half confidence); an unchanged tick writes nothing; 600 s later it refreshes; kickoff writes LIVE at the provider's 6200 bps with full confidence; the final whistle writes FINAL; a FINAL pool is never written again — six of six steps, every write stamping `lastUpdate` with the tick's time. Still to do: the same on Arc itself, on the G-017 rehearsal, since the keeper key is the market signer that stays unset until then.

**Owner acceptance of M-01:** ⬜ pending — to be given once K-01 has
landed and the frozen-but-not-final alert pages a human (R-010).

## C4. L-03 — owner's note

L-03 (volatility griefing can lift the playoff rate by ≤ 0.15% while it
lasts; bounded, self-defeating, decays) is accepted for launch on the
reviewer's reasoning in `dynamic-market-fee-review.md`: the griefer pays
the fee they raise, the effect is capped by the driver's quarter share of
the headroom, and the regular season runs at 0% where it cannot apply.

**Owner's note:** ⬜ pending — reply "L-03 accepted" (or dictate wording).

## C5. Decisions recorded for the record

- **D-012 seller-revenue posture — seller env flipped before counsel
  sign-off (owner decision, 2026-10-01).** Exposure: paid API access to
  read/quote/calldata services, settled to an EOA the owner controls;
  trading itself remains closed. Counsel review (L-004 / MP-003) is still
  open and should confirm or reverse this.
- **AgenticCommerce stays undeployed** until the human audit covers the
  vendored escrow. No acceptance is requested for it in this addendum.
- **Dependency posture** unchanged from B3 (17 high advisories, each
  triaged in `launch-gate-review.md` §4, none on a request path with
  attacker-controlled input).

## C6. CSP report window

Still report-only. On 2026-10-01 the production log window carried zero
`/api/csp-report` submissions and zero violation lines; the window is
hours, not the dogfood week §7 asks for, so enforcement waits.

## C7. Human audit — scope and handover

Still outstanding (owner engages the auditor). Handover package, all in
the repo or recorded above: the four review documents in
`docs/security/`; Slither baselines in `docs/security/slither/`; the
deployed addresses, bytecode hash and verification links
(`deploy/dynamic-market/README.md`, `docs/security/hook-deployments.md`);
the contract suites (`forge test`, incl. the 100k-call invariant sweep)
and the Arc fork E2E on real USDC (`FORK_REAL_USDC=1 FOUNDRY_PROFILE=arc
arc-forge test --match-contract MarketLifecycleForkE2E`); the vendored
ERC-8183 at `contracts/lib/base-contracts` (142e669) with
`AgenticCommerceDeploy.t.sol`. Suggested scope in priority order: the
hook + registry + RiskPolicy with K-01's keeper in place, Resolver /
MarketFactory / Market, the server's signing paths (`markets-onchain.ts`,
`agent-commerce.ts`, `circle/execute.ts`), then the vendored escrow.

## C8. What this addendum does not do

It does not re-sign the ship gate. Before markets open, in order:

1. **K-01** — the keeper tick lands and is proven on a fork and on Arc. _Landed and fork-proven 2026-10-01 (C3); the Arc half rides G-017._
2. **M-01** written acceptance (C3) and the **L-03** note (C4).
3. **R-010** — the frozen-but-not-final alert reaches a pager.
4. The **human audit** (C7); the second-model review from A7/B4 is
   superseded by it.
5. Then `MARKET_SIGNER_PRIVATE_KEY` is set and funded (G-017 rehearsal,
   L-007/L-008).
