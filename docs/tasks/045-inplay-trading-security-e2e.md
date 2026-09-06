# 045 — In-play trading, markets security review, mainnet-fork E2E

**Status:** ✅ done 2026-09-06
**Branch:** `045-inplay-trading-security-e2e`
**Closes:** P-004 (in-play semantics), P-013 (markets security review),
P-014 (mainnet-fork lifecycle E2E)
**Decisions:** D-103 (market mechanism / in-play trading), D-104 (resolution
engine & authority) — `docs/decisions/v2-open-decisions.md`

Three linked pieces of work: change the contracts from freeze-at-kickoff to
in-play trading, review what that produced, and prove the whole journey on a
Base Mainnet fork with real USDC. Contracts and specs only — no `server/`,
no `client/`.

## 1. Semantics diff — the freeze model

The shipped design closed trading at kickoff on two independent clocks. D-103
replaced that with trading that runs *through* the event, closing on data with
a time backstop underneath.

| Surface                       | Old (shipped)                                       | New (D-103)                                                                                                       |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `Market.freeze()`             | Permissionless, at `startsAt`. No early path at all | **Resolver-only** from `startsAt` (data-driven, on final); **permissionless** from `startsAt + MAX_EVENT_DURATION` |
| `Market.MAX_EVENT_DURATION`   | —                                                   | New `public constant` = **12 hours**. Constant, not immutable: the factory passes no duration and no NFL game nears it |
| `Market.isTradeable()`        | `state == OPEN`                                     | `state == OPEN && now < startsAt + MAX_EVENT_DURATION` — an un-frozen zombie past the backstop no longer reports tradeable |
| `Resolver.freeze(marketId)`   | Permissionless forward                              | **`onlyAuthorized`** (signer or operator) — see §3, this was a real hole                                          |
| Hook swap gate                | `RiskPolicy.isFrozen(kickoff, now)` — pure time     | `eventState == FINAL` **or** `RiskPolicy.isPastBackstop(kickoff, now)`                                            |
| `RiskPolicy.FREEZE_LEAD = 0`  | Halt exactly at kickoff                             | **Removed.** Replaced by `MAX_EVENT_DURATION = 12 hours`, asserted equal to `Market.MAX_EVENT_DURATION`           |
| `split` / `merge`             | Closed at kickoff (with trading)                    | **Open while trading is open** — full collateral makes set-minting against a known score harmless; still close at freeze |
| Registry `kickoffTimestamp`   | Immutable, no setter                                | **Unchanged** — still immutable, now anchoring the backstop and the fee dynamics rather than the halt              |
| Resolve                       | Requires FROZEN                                     | **Unchanged** — resolve-before-freeze still rejected                                                              |
| Void                          | From OPEN or FROZEN                                 | **Unchanged**                                                                                                     |
| LP exit during halt           | Always open (no `BEFORE_REMOVE_LIQUIDITY` bit)      | **Unchanged** — re-asserted in both E2Es                                                                          |

### Who can freeze, when — exactly

```text
                startsAt                        startsAt + 12h
   ────────────────┼───────────────────────────────────┼──────────────►
    pre-game       │          event window             │   backstop
    ─────────      │          ────────────             │   ─────────
 freeze: NOBODY    │  freeze: RESOLVER ONLY            │  freeze: ANYONE
 (void is the      │  (signer or operator, via         │  (permissionless,
  path for a       │   Resolver.freeze on "final")     │   service-independent)
  called-off game) │                                   │
 swaps: YES        │  swaps: YES (in-play)             │  swaps: NO
 split/merge: YES  │  split/merge: YES                 │  split/merge: YES until frozen
```

The hook halts swaps on the same clock from the other side: `eventState =
FINAL` (the keeper's write, mirroring the resolver's freeze) **or**
`kickoff + MAX_EVENT_DURATION` evaluated from the block clock alone, so a
dead keeper cannot extend the window. Both layers share one constant and the
equality is asserted in `Market.t.sol::test_backstopMatchesTheHook`.

Deliberately, there is **no freeze before kickoff on either path**: the
resolver must not be able to close a market people are still pricing pre-game,
and a called-off game is `voidMarket`'s job.

`RiskPolicy.isPastBackstop` computes by subtraction
(`now - kickoff >= MAX_EVENT_DURATION`) rather than addition, so a kickoff near
`type(uint64).max` cannot overflow into a market that never closes;
`Market.freeze`/`isTradeable` widen to `uint256` for the same reason.

## 2. Spec rewrites

The specs are the stated authority for what each state permits, so they were
rewritten to match the new code exactly rather than annotated.

- **`docs/specs/market-lifecycle.md`** — header (`Open: DM-103` → decided,
  D-103/D-104 + the trading window), §2 state table (in-play `OPEN`, both
  freeze entry conditions, a footnote for the backstop capping the window
  inside `OPEN`), §3.4 Freeze fully rewritten (two freeze paths, two
  enforcement layers, split/merge staying open, the degradation ladder), §4
  failure modes (provider-down split into during-game / at-final /
  after-freeze rows). The deferral note ("no in-play trading at launch") is
  replaced by a superseded-by-D-103 pointer.
- **`docs/specs/dynamic-market-hook.md`** — §0.1 keeper note (D-104 closed
  the key arrangement), §0.3 constants table (`FREEZE_LEAD` row → the
  `MAX_EVENT_DURATION` row with its rationale), **§6 retitled and rewritten**
  ("Freeze — In-Play Trading with a Time Backstop", two layers, revised-by
  banner), §22 stale-state, §23 halt conditions, §27 `RiskPolicy` contents,
  §33 edge case 15, §35 halt matrix, §36 keeper-failure diagram, §43
  architecture questions, §44 failure conditions, §45 DoD, §46 checklist.

## 3. Security review (P-013)

`docs/security/markets-contracts-review.md` — Trail of Bits methodology over
`contracts/src/markets/` (Market, OutcomeToken, MarketFactory, Resolver,
MarketPoolBootstrap) plus the four hook files this task changed, with the new
freeze/backstop surface reviewed explicitly.

**Verdict: 0 HIGH.** Findings by severity:

| ID   | Severity      | Finding                                                                                               | Status                          |
| ---- | ------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------- |
| —    | (fixed)       | Permissionless `Resolver.freeze()` forward handed the resolver-only early-freeze window to any caller  | **Fixed + regression-tested**   |
| M-01 | MEDIUM        | Hook halt (`FINAL` write) and market freeze are two different writes by the same service — a half-operating service leaves a decided market trading until the stale clamp + backstop | Open — **ops requirement**, needs owner acceptance |
| L-01 | LOW           | `redeemInvalid` burns a lone odd token unit for zero payout (rounds to the vault)                      | Open, documented                |
| L-02 | LOW           | `createMarket` is permissionless; a squatter could pre-create a canonical id with a wrong `startsAt`, which now also mis-anchors the backstop | Open, pre-existing; generator should verify `startsAt` before listing |
| I-01 | Informational | Losing-side tokens survive redemption by design                                                        | Open, documented                |
| I-02 | Informational | Resolver can freeze-then-resolve with no on-chain delay (dispute window is server-side, D-104)          | Open, carries B10-007 I-01      |

### The bug this task found and fixed

`Resolver.freeze(marketId)` was permissionless — correct under the old model,
where `Market.freeze()` was itself permissionless at kickoff. Under the new
model every call routed through the Resolver arrives at `Market.freeze()` with
`msg.sender == resolver`, which unlocks the **resolver-only** early window. An
open forward would therefore have let anyone close a live market at kickoff —
exactly the griefing the new model exists to prevent. `freeze` is now
`onlyAuthorized`; regression:
`Resolver.t.sol::test_strangerCannotFreezeThroughTheResolver`.

### Slither

The previous review cited `docs/security/slither/` while the directory held
only `.gitkeep`. **The cause was `.gitignore`**, not a missing run:
`docs/security/slither/*` sat under the file's "# Logs" heading, so every
output was ignored as regenerable noise. Cited evidence has to be tracked, so
the rule now negates per-artifact. Slither 0.11.4 is installed and run, and
the raw outputs are checked in:

```bash
# contracts/script/security/run-slither.sh, extended by this task
slither . --foundry-out-directory out \
  --filter-paths "lib/|test/|script/|hooks/stable-protection|hooks/dynamic-fee" \
  --no-fail-pedantic --json docs/security/slither/markets-dynamic-market.json
```

**27 findings: 0 High, 9 Medium, 18 Low/Info.** Every Medium is triaged in §5
of the review as a false positive (strict-equality checks against counters the
contract itself decrements; "reentrancy" through the market's own
`onlyMarket` OutcomeToken, which has no callbacks; a deliberately
zero-defaulted local; partial `getSlot0` destructuring). Outputs:
`docs/security/slither/markets-dynamic-market.{txt,json}`. The vendored hook
submodules still fail to compile standalone in this environment and remain
uncovered — stated in the doc rather than faked.

### Sign-off

`docs/security/sign-off.md` gained a dated addendum (A1–A6). The signed
2026-08-18 content is untouched; the addendum records the semantics change,
corrects the §2 "Freeze integrity" rail (which described the pre-D-103 three
time-layer design), carries the review verdict, and marks M-01 as **pending
owner acceptance**. It explicitly does not re-sign the ship gate.

## 4. Fork E2E (P-014)

`contracts/test/integration/MarketLifecycleForkE2E.t.sol` — the lifecycle on
forked Base Mainnet (8453) with **real canonical USDC**
(`0x8335…2913`, a FiatToken proxy — six decimals, upgradeable, blacklistable;
none of which a `MockERC20` exercises), dealt to the actors.

The stack is deployed inside the fork the way the deploy scripts deploy it,
not planted: a **dedicated PoolManager** (DM-112 routing — the DM stack
self-deploys its manager; the canonical v4 PoolManager is not used), the hook
at a **CREATE2-mined** address via `HookMiner` with the `0x28C0` permission
bits asserted (not `deployCodeTo`), `Resolver → MarketFactory → setFactory` in
the only order that works, and the periphery routers pointed at the DM
PoolManager (task 032, finding 3).

The journey, one continuous test:

| Stage | What it proves |
| ----- | -------------- |
| Create market | Factory deploys against real USDC as collateral |
| Split both sides | Real USDC escrowed 1:1; `outstandingSets` == vault balance |
| Open hooked pool at implied p | `MarketPoolBootstrap.poolKeyFor` + registry registration + init at p = 0.50, price computed for whichever ordering YES sorted into |
| LP | Liquidity added through the hook's `beforeAddLiquidity` gate |
| Trade both directions pre-kickoff | Buy YES for USDC, sell a quarter back — dynamic fee applies both ways |
| **Warp past kickoff → trade in-play** | **The leg the old design forbade.** Keeper marks `LIVE`; the swap succeeds and delivers YES; `market.isTradeable()` is true; `split` still works mid-game |
| Stranger cannot freeze | `TooEarlyToFreeze` inside the event window |
| Resolver freeze on "final" | Keeper writes `FINAL`, resolver freezes; **swaps revert, `split` reverts, LP exit succeeds** |
| Resolve | Signer path, `FROZEN → RESOLVED` |
| Redeem | Winning YES → 1:1 real USDC for both holders; a NO-only holder gets `NothingToRedeem` |
| Accounting | Vault holds exactly `outstandingSets`; `outstandingSets == yes.totalSupply()`; `collateralSurplus() >= 0`; **every USDC unit conserved** across actors + vault + pool |

**Run command and result** (2026-09-06, public endpoint, no `.env` RPC
configured locally):

```bash
cd contracts && BASE_RPC_URL=https://mainnet.base.org \
  forge test --match-contract MarketLifecycleForkE2E -vv
# [PASS] test_forkLifecycle_inPlayTradingFreezeOnFinalResolveRedeem() (gas: 3710249)
# Suite result: ok. 1 passed; 0 failed; 0 skipped
```

**Flakiness caveat.** `https://mainnet.base.org` is the rate-limited public
endpoint and returns Cloudflare 502s under fanout; CI already wraps the fork
job in a 3-attempt retry for this reason and reads `BASE_RPC_URL` from a
secret when set. This test forks at `latest` (BaseFork convention) and deploys
everything it touches, so it depends on mainnet only for the USDC contract and
chain id — it has no dependency on live pool state and should not drift.

Two solc mechanics worth recording: the test compiles at `^0.8.27` (BaseFork's
pragma) while v4-core pins `PoolManager` to `=0.8.26`, so the manager is
deployed with `deployCode("PoolManager.sol:PoolManager")` rather than a
concrete import; and the in-test CREATE2 mine targets `address(this)` where the
script targets the canonical proxy — the property under test (low 14 bits ==
`0x28C0`) is identical.

## 5. Test deltas

Non-fork suite: **209 passed / 0 failed** — **+12 test functions** over the
branch point (`Market.t.sol` 30→35, `Resolver.t.sol` 16→20,
`DynamicMarketHook.t.sol` 25→28, `RiskPolicy.t.sol` 24→24 with the whole
`isFrozen` block replaced), plus several rewritten in place and the invariant
handler widened.

| File | Change |
| ---- | ------ |
| `test/markets/Market.t.sol` | `test_freezeRejectedBeforeKickoff` → `…OnBothPaths` (resolver *and* stranger rejected pre-kickoff); `test_freezeIsPermissionlessAfterKickoff` → **`test_freezeIsPermissionlessAfterTheBackstop`**; **+`test_resolverFreezesFromKickoff`**, **+`test_strangerCannotFreezeDuringTheEventWindow`** (the anti-griefing property), **+`test_tradingStaysOpenDuringTheGame`** (split/merge mid-event), **+`test_isTradeableFalsePastBackstopEvenBeforeAnyoneFreezes`**, **+`test_backstopMatchesTheHook`** (cross-layer constant equality); every freeze in the resolve/redeem helpers routed through the resolver |
| `test/markets/Resolver.t.sol` | `test_freezeByIdIsPermissionlessAfterKickoff` → **`test_signerFreezesByIdFromKickoff`** + `…operatorFreezes…`; **+`test_strangerCannotFreezeThroughTheResolver`** (the fixed hole), **+`test_freezeBeforeKickoffStillRejectedByTheMarket`**, **+`test_backstopFreezeIsPermissionlessOnTheMarketItself`**; all existing freeze call sites now prank an authorized key |
| `test/markets/MarketInvariant.t.sol` | Handler `freeze()` → `freeze(bool viaBackstop)` so the fuzzer reaches **both** freeze paths. 128k calls, 0 reverts, all four solvency invariants green |
| `test/hooks/dynamic-market/RiskPolicy.t.sol` | `isFrozen` block → **`isPastBackstop`** block: silent pre-kickoff, **silent during the game**, fires exactly at `kickoff + 12h`, no overflow near `uint64` max, monotonic; `FREEZE_LEAD` assertion → `MAX_EVENT_DURATION` |
| `test/hooks/dynamic-market/DynamicMarketHook.t.sol` | `test_swapRevertsAfterKickoffWithoutAnyKeeperUpdate` → **`test_swapRevertsAtBackstopWithoutAnyKeeperUpdate`** (edge case 15 preserved, moved to the backstop); **+`test_swapAllowedAtAndAfterKickoff`**, **+`test_swapAllowedInPlayEvenWithKeeperOffline`** (stale clamps the fee but must not halt), **+`test_swapRevertsOnceEventIsFinal`** |
| `test/e2e/FullLifecycle.t.sol` | Renamed to `…TradeInPlayFreezeResolveRedeem`; **gained the in-game leg** — warp past kickoff, keeper `LIVE`, mid-game swap succeeds, mid-game `split` succeeds, stranger's freeze rejected, then keeper `FINAL` + resolver freeze, swaps and split blocked, LP exit open, resolve → redeem → solvent-empty |
| `test/integration/MarketLifecycleForkE2E.t.sol` | **New** (§4) |

## 6. Gates

All from `contracts/`:

| Gate | Command | Result |
| ---- | ------- | ------ |
| Build | `forge build` | ✅ clean (0 errors) |
| Non-fork tests | `forge test --no-match-path "test/integration/*"` | ✅ **209 passed / 0 failed** |
| Full suite | `BASE_RPC_URL=https://mainnet.base.org forge test` | ✅ **211 passed / 0 failed / 8 skipped** (skips are the pre-existing env-gated hook tests awaiting `STABLE_PROTECTION_HOOK_ADDRESS` etc.) |
| Fork E2E | `BASE_RPC_URL=… forge test --match-contract MarketLifecycleForkE2E -vv` | ✅ 1 passed (gas 3,710,249) |
| Slither | `contracts/script/security/run-slither.sh` | ✅ 0 High, 9 Medium (all triaged false positives), 18 Low/Info |

## 7. Bugs found

1. **Permissionless `Resolver.freeze()` forward** (would have been HIGH-ish
   griefing once the resolver-only window existed) — found during the P-013
   review of the surface this task created, fixed in the same task, regression
   test added. Detail in §3.
2. **M-01 freeze/halt coupling** (MEDIUM, open) — not a code bug so much as a
   consequence of the two-layer design; mitigation is operational and is
   flagged for owner acceptance in the sign-off addendum.

Nothing else. No existing security property was weakened: once-only
registration, the absent kickoff setter, dynamic-fee-only pools,
`onlyPoolManager` callbacks, the missing `BEFORE_REMOVE_LIQUIDITY` bit, and
resolve-before-freeze rejection were each re-verified and re-tested.

## 8. Files

**Contracts**

- `contracts/src/markets/Market.sol` — `MAX_EVENT_DURATION`, two-window
  `freeze()`, backstop-aware `isTradeable()`
- `contracts/src/markets/Resolver.sol` — `freeze` is `onlyAuthorized`
- `contracts/src/markets/MarketFactory.sol` — comments only (kickoff now
  anchors the backstop)
- `contracts/src/hooks/dynamic-market/RiskPolicy.sol` — `FREEZE_LEAD` /
  `isFrozen` → `MAX_EVENT_DURATION` / `isPastBackstop`
- `contracts/src/hooks/dynamic-market/MarketFlow.sol` — `requireTradeable`
  is state-driven with the time backstop
- `contracts/src/hooks/dynamic-market/MarketErrors.sol`,
  `MarketStateRegistry.sol` — doc comments

**Tests** — the seven files in §5.

**Docs** — `docs/specs/market-lifecycle.md`,
`docs/specs/dynamic-market-hook.md`,
`docs/security/markets-contracts-review.md` (new),
`docs/security/sign-off.md` (addendum only),
`docs/security/slither/markets-dynamic-market.{txt,json}` (new),
`contracts/script/security/run-slither.sh` (extended).

`docs/tasks/prediction-market-protocol.md` is deliberately **not** edited —
the ledger is updated by the coordinator after merge.
