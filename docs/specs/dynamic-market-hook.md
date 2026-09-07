# Dynamic Market Hook Specification

> **Status:** Authoritative
> **Task:** 005 — Dynamic Market Hook
> **Resolves:** DM-110
> **Unblocks:** Phase B2 — market pages, pool listing
> **Target:** Base Mainnet
> **Chain ID:** 8453

---

## 0. Implementation record

Not specification. Pre-flight answers and outstanding blockers. §1 onward is
the spec as supplied.

### 0.1 Resolved pre-flight

**OutcomeToken decimals: 6 — confirmed, not assumed** (satisfies §9).
`Market`'s constructor reads `collateral.decimals()` and passes it to both
outcome tokens, so a YES/NO token always matches USDC's 6-decimal ERC-20
interface. Verified by `test_outcomeTokensInheritCollateralDecimals` in
`contracts/test/markets/Market.t.sol`.

**No scaling factor is required.** §9 mandates one only if decimals differ from
six. The registry should still store the value so a future non-6dp collateral
cannot silently break notional maths.

Base's native gas token (ETH) is 18 decimals; outcome tokens never touch that
side. Only gas math is 18-dp.

**Keeper identity: the market resolver key** (owner decision, 2026-08-17). The
registry keeper and `Market.resolver` are the same address.

> This couples fee-input authority to settlement authority — one compromised
> key can both skew fees and resolve markets. The §27 bounds still hold and the
> §6 time backstop fires from the registration timestamp regardless of keeper
> activity, so the blast radius is bounded to fee skew within bounds plus
> settlement (and, under D-103, an early data-driven freeze — a halt, never a
> theft). D-104 closed the key arrangement: signer and operator are rotatable
> seats on the `Resolver` contract; sign-off I-01 carries until the keys are
> split at mainnet deploy. Per §25 the keeper and **operator** roles stay
> distinct regardless, so keeper compromise cannot register pools, change
> limits, or pause.

### 0.2 Verified constants

Checked against the v4-core installed in `contracts/lib/`, not from memory:

| Item                        | Value            | Source                           |
| --------------------------- | ---------------- | -------------------------------- |
| `BEFORE_INITIALIZE_FLAG`    | `1 << 13`        | `Hooks.sol:29`                   |
| `BEFORE_ADD_LIQUIDITY_FLAG` | `1 << 11`        | `Hooks.sol:32`                   |
| `BEFORE_SWAP_FLAG`          | `1 << 7`         | `Hooks.sol:38`                   |
| `AFTER_SWAP_FLAG`           | `1 << 6`         | `Hooks.sol:39`                   |
| Sum of the four             | `0x28C0` (10432) | computed                         |
| `ALL_HOOK_MASK`             | `0x3FFF`         | `Hooks.sol:27` — `(1 << 14) - 1` |
| `DYNAMIC_FEE_FLAG`          | `0x800000`       | `LPFeeLibrary.sol:15`            |
| `OVERRIDE_FEE_FLAG`         | `0x400000`       | `LPFeeLibrary.sol:19`            |
| `MAX_LP_FEE`                | `1_000_000`      | `LPFeeLibrary.sol:25`            |

The §7 constraint `uint160(address(hook)) & 0x3FFF == 0x28C0` is correct for
exactly those four permissions.

### 0.3 Risk parameters (owner decision, 2026-08-17)

The spec deliberately supplied no numbers. These were chosen by the owner and
fill the §27 bounds. All are immutable after deployment; §44 makes it a failure
condition if any path can raise `MAX_FEE` or `ABS_MAX_TRADE`.

| Constant        | Value      | Meaning           | Why                                                                                                                                                                                                                                 |
| --------------- | ---------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_FEE`      | `3_000`    | 0.30%             | Conventional v4 mid tier. The §16 floor and the §18 directional minimum                                                                                                                                                             |
| `MAX_FEE`       | `50_000`   | 5.00%             | Leaves 4.70% of headroom across five premiums plus the directional adjustment. §22 clamps a stale market here — punitive without being prohibitive                                                                                  |
| `ABS_MAX_TRADE` | `10_000e6` | $10,000 USDC      | Large enough not to bind in normal flow, small enough that the §35 "above cap → reverts" test is reachable                                                                                                                          |
| `MIN_TRADE_CAP` | `100e6`    | $100 USDC         | The §21 floor, and where §22 clamps a stale market                                                                                                                                                                                  |
| `STALE_AFTER`   | `900`      | 15 minutes        | Keeper cadence tolerance before §22 fail-closed behaviour engages                                                                                                                                                                   |
| `MAX_EVENT_DURATION` | `43_200` | 12-hour backstop | **D-103 in-play trading** (supersedes `FREEZE_LEAD = 0`, which froze at kickoff). Trading runs through the game; the halt is the keeper's `FINAL` write, and this backstop — `kickoff + MAX_EVENT_DURATION`, keeper-independent — guarantees the halt even with the service down. Must equal `Market.MAX_EVENT_DURATION`, so the hook halts swaps at the same instant the market's permissionless `freeze()` unlocks (asserted in `Market.t.sol`) |

Fees are in v4 pips — `1_000_000` = 100%, so `3_000` = 0.30%. Note this differs
from the basis-point convention used for probability and confidence (§10, §12),
where `10_000` = 100%. `MarketMath` must not mix the two.

### 0.4 Task-record section references are stale

Task record `005` cites §1.1, §8, §9, §10, §11, §12.1, §12.2. Only §1.1 lands
where it expects:

| Task record cites          | Actual location                                     |
| -------------------------- | --------------------------------------------------- |
| §1.1 scope                 | §1.1 ✓                                              |
| §8 twelve success criteria | §45 Definition of Done (not enumerated as "twelve") |
| §9 failure conditions      | §44 Failure Conditions                              |
| §10 sixteen edge cases     | §33 Edge Cases (enumerated 1–16 ✓)                  |
| §11 execution checklist    | §46 Implementation Checklist                        |
| §12.1 decimals pre-flight  | §9 Outcome Token Decimals — resolved in §0.1        |
| §12.2 keeper pre-flight    | §25 Registry Authorization — resolved in §0.1       |

Work is tracked against §33, §44, §45, and §46. Note that §45 requires "all
twelve success criteria pass" but no list of twelve is enumerated anywhere in
this document.

### 0.5 One reuse source is unavailable

| §31 source                                                 | Available                                              | Note                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Nezlobin `FeeCalculator`, `DeviationMonitor`, `TwapOracle` | **Yes** — `contracts/hooks/dynamic-fee/src/libraries/` | Submodule was not checked out; initialised 2026-08-17                        |
| `ComplianceRegistry` two-step operator transfer + pause    | **No**                                                 | Lives in the RWAgate repo, not a submodule here. Pattern to be reimplemented |

---

## 1. Overview

The Dynamic Market Hook is a Uniswap v4 hook for Mantua's sports
prediction-market pools.

A single deployed hook instance serves multiple prediction markets. Each market
is represented by a pool containing a YES outcome token and USDC.

The hook adapts market execution parameters based on market conditions while
enforcing deterministic risk limits on-chain.

The initial implementation has exactly three responsibilities:

1. Adaptive LP fee
2. Per-swap notional size cap
3. Trading halt

The hook does **not** modify the AMM curve, provide liquidity, distribute
liquidity incentives, or control LP withdrawal.

### 1.1 Scope

#### In scope

- Dynamic LP fees
- Market imbalance fee adjustment
- Volatility fee adjustment
- Liquidity risk premium
- Event-state premium
- Model/market probability deviation premium
- Directional fee adjustment
- Per-swap USDC notional cap
- In-play trading with an event-`FINAL` halt and a `kickoff + MAX_EVENT_DURATION` (12 h) backstop (D-103; supersedes the kickoff freeze)
- Resolution halt
- Void halt
- Administrative pause
- Keeper-provided bounded market signals
- On-chain derivation of market state
- Fee-decomposition events
- Multi-pool state management
- Base Mainnet deployment

#### Out of scope

- Custom AMM curves
- Spread modification
- Direct probability setting by the hook
- Dynamic liquidity provisioning
- LP incentive distribution
- Automated LP rebalancing
- Parlays
- Correlated-market pricing
- Settlement oracle implementation
- Position accounting outside the swap cap
- `BEFORE_SWAP_RETURNS_DELTA`
- `BEFORE_REMOVE_LIQUIDITY`

The hook must never encode `BEFORE_SWAP_RETURNS_DELTA`.

The hook must return:

```solidity
BeforeSwapDeltaLibrary.ZERO_DELTA
```

LPs must always be able to remove liquidity.

## 2. Architecture

```text
                  ESPN / Sports Data
                         │
                         ▼
                ┌─────────────────┐
                │  Sports Agent   │
                │ Research        │
                │ Prediction      │
                │ Risk            │
                └────────┬────────┘
                         │
                  Market State
                         ▼
              ┌────────────────────┐
              │  Market Controller │
              │ probability        │
              │ volatility         │
              │ imbalance          │
              │ liquidity          │
              │ event state        │
              │ exposure           │
              └─────────┬──────────┘
                        │
                  validated params
                        ▼
              ┌────────────────────┐
              │ Dynamic Market Hook│
              │ pricing            │
              │ fees               │
              │ limits             │
              │ halt               │
              └─────────┬──────────┘
                        ▼
                 Prediction AMM
                        │
                  YES / NO shares
                        ▼
                     Traders
```

### 2.1 Critical design principle

**The agent proposes. The protocol enforces.**

The AI agent must never have unrestricted authority to modify on-chain pricing,
fees, trade limits, or market state.

The keeper may only write explicitly permitted market signals.

The hook independently derives market conditions and applies immutable protocol
bounds.

## 3. Market Model

Each Mantua sports prediction market is represented by a Uniswap v4 pool:

```text
YES / USDC
```

The YES token represents the positive outcome of the underlying event.

The market probability is inferred from the pool price. The hook does not
directly set the probability. Instead:

```text
Pool Price → Market Probability → Market State → Risk / Fee Calculation → Effective Fee
```

The external prediction system may provide model probability, confidence, and
event state. These are treated as market-risk inputs rather than authoritative
prices.

## 4. Market State

Each registered pool has a normalized market state.

```solidity
struct MarketState {
    uint16 modelProbability;
    uint16 confidence;
    EventState eventState;

    uint64 kickoffTimestamp;
    uint64 resolutionTimestamp;

    bool registered;
    bool paused;
}
```

Derived values are not stored as keeper-controlled state. They are calculated
from the pool and current block state.

### 4.1 Keeper-controlled values

The keeper may write exactly three values:

```text
modelProbability
confidence
eventState
```

Nothing else.

### 4.2 Derived values

The protocol derives:

```text
marketProbability
liquidity
volume
volatility
net flow
time to kickoff
model/market deviation
directional imbalance
```

This prevents the keeper from fabricating market conditions.

## 5. Event State

```solidity
enum EventState {
    PRE_GAME,
    LIVE,
    CRITICAL,
    FINAL,
    RESOLVED,
    VOID
}
```

**PRE_GAME** — normal trading.

**LIVE** — the event has started. Trading remains available subject to
live-market risk parameters.

**CRITICAL** — a material event has occurred: injury, red card, major lineup
change, game interruption, or other market-moving event. The keeper may
transition the market into this state.

**FINAL** — the event has ended and trading is halted pending resolution.

**RESOLVED** — the market has resolved. Trading is permanently halted.

**VOID** — the market has been voided. Trading is permanently halted.

## 6. Freeze — In-Play Trading with a Time Backstop

> Revised per D-103 (2026-09-06). The original section froze at kickoff; that
> design shipped and was superseded by the owner's in-play decision.

Trading is **in-play**: kickoff halts nothing, and swaps continue through
`LIVE` and `CRITICAL`. The halt has two layers, and both must be evaluated
on-chain in `beforeSwap` (and `beforeAddLiquidity`, §23):

1. **State-driven (normal path).** The keeper writes
   `eventState = FINAL` when the event ends; the hook rejects swaps from that
   write on. This mirrors the resolver's data-driven `Market.freeze()` on the
   markets side.
2. **Time backstop (failure path).** The hook must reject swaps once
   `kickoffTimestamp + MAX_EVENT_DURATION` has been reached, using only the
   registration timestamp and the block clock. The keeper does not need to
   submit an update for the backstop to activate.

The backstop exists specifically to prevent a stale or offline keeper from
leaving a market tradable after its event can possibly still be running.

```text
registration → kickoffTimestamp → … in-play trading … → FINAL write → halted
                                └→ kickoff + MAX_EVENT_DURATION reached → halted (keeper-independent)
```

The kickoff timestamp stays registered and immutable — it anchors this
backstop and the fee dynamics, even though it no longer halts trading itself.

## 7. Hook Permissions

Exactly four permissions:

```text
BEFORE_INITIALIZE    = 1 << 13
BEFORE_ADD_LIQUIDITY = 1 << 11
BEFORE_SWAP          = 1 << 7
AFTER_SWAP           = 1 << 6
```

The resulting permission bitmap must be `0x28C0`. Therefore the deployed CREATE2
address must satisfy:

```solidity
uint160(address(hook)) & 0x3FFF == 0x28C0
```

No other hook permissions may be enabled.

## 8. Pool Registration

The hook is multi-pool. One deployment may serve markets A…N. All
market-specific state is keyed by `PoolId`.

A pool must be registered before it may be initialized. The registration record
must contain all information required to enforce market-specific policy. At
minimum:

```text
PoolId
OutcomeToken
USDC token
kickoff timestamp
resolution timestamp
market status
```

The pool must use `LPFeeLibrary.DYNAMIC_FEE_FLAG` as its pool fee
configuration. A pool using a static fee must not be accepted by the hook.

## 9. Outcome Token Decimals

The implementation must not assume that the outcome token uses six decimals
unless this is confirmed during implementation.

USDC uses six decimals.

If `OutcomeToken.decimals()` is not six, the registry must store a scaling
factor during registration. `MarketMath` must apply this scaling factor when
converting outcome-token amounts into USDC-equivalent notional values. The
scaling factor is immutable for a registered market.

> **Resolved: decimals are 6.** See §0.1.

## 10. Probability Calculation

The hook derives market probability from the pool's current price:

```text
sqrtPriceX96 → price → YES probability → probabilityBps
```

Probability is in basis points: `0` = 0%, `10_000` = 100%, so `5000` = 50%.

The calculation must correctly support both token orderings. The implementation
must not assume `currency0 = YES` or the reverse. Token ordering must be
determined from the pool configuration.

## 11. Market Probability vs Model Probability

**Market probability** — derived from the AMM price.

**Model probability** — provided by the keeper.

Example:

```text
Market probability: 51%
Model probability:  43%
Confidence:         91%
```

The hook does not automatically replace 51% with 43%. It calculates
`modelMarketDeviation` and uses the deviation as a risk input. This preserves
the distinction between what the market currently prices and what the
prediction model believes.

## 12. Confidence

Confidence is in basis points: `0` = 0%, `10_000` = 100%.

The keeper input must be bounds-checked before storage. Invalid confidence
values must revert.

Confidence affects the model-deviation premium. Low-confidence model signals
must have limited impact; high-confidence signals may receive a larger bounded
risk premium. No confidence value may bypass the immutable fee ceiling.

## 13. Volatility

Market volatility is derived on-chain, using an EWMA-style calculation. It
must:

- use recent market observations
- decay older observations
- remain bounded
- avoid unbounded storage growth
- operate in deterministic integer arithmetic

Volatility must not be directly written by the keeper. The keeper can provide
model state, but realized volatility is derived from on-chain observations.

## 14. Flow and Imbalance

The hook derives directional market flow from swaps, tracking the relationship
between YES buying and YES selling and the resulting directional imbalance.

Flow must decay over time so that old activity does not permanently affect
fees.

The implementation must handle zero flow, zero liquidity, same-block swaps,
opposite-direction swaps, and both token orderings.

No unbounded loop may be used to calculate flow.

## 15. Liquidity

Liquidity is read directly from the pool state. The hook must gracefully handle
`liquidity == 0`.

Zero liquidity must never cause a division-by-zero or arithmetic failure
outside the explicitly intended risk behavior.

When liquidity is insufficient, the fee calculation should move toward the
configured risk maximum and the trade-size cap toward its minimum.

## 16. Fee Calculation

A five-premium fee stack:

```text
Effective Fee =
    Base Fee
    + Volatility Premium
    + Imbalance Premium
    + Liquidity Premium
    + Event Risk Premium
```

The implementation must also account for model/market deviation and directional
risk according to the configured calculator logic.

Every premium is individually bounded. The final fee must be clamped:

```text
BASE_FEE <= fee <= MAX_FEE
```

No governance or keeper path may increase `MAX_FEE`.

## 17. Fee Components

### 17.1 Base Fee

The minimum fee charged under normal conditions: `BASE_FEE`.

### 17.2 Volatility Premium

Increases as realized market volatility increases.

### 17.3 Imbalance Premium

Increases as directional YES/NO imbalance increases.

### 17.4 Liquidity Premium

Increases as available liquidity becomes insufficient relative to trading
activity.

### 17.5 Event Risk Premium

Accounts for event state and proximity to material market events.

The final calculator may apply directional adjustments based on whether a swap
increases or decreases the market's current risk exposure.

## 18. Directional Fee Adjustment

The fee calculator must reuse the existing Mantua directional fee logic rather
than implementing a second independent version.

A trade that increases existing directional risk should receive the appropriate
risk adjustment. A trade that reduces directional exposure may receive a lower
adjustment, subject to the immutable minimum fee.

The directional adjustment must never produce `fee < BASE_FEE` or
`fee > MAX_FEE`.

## 19. Adaptive Fee Callback

`beforeSwap` is responsible for returning the current dynamic fee. The callback
must:

1. Verify the caller is the PoolManager.
2. Load the pool's registered market state.
3. Verify the pool is eligible for trading.
4. Derive current market conditions.
5. Calculate the fee.
6. Enforce the trade-size cap.
7. Return the dynamic fee.
8. Return `ZERO_DELTA`.

The fee must be returned using `LPFeeLibrary.OVERRIDE_FEE_FLAG`. No custom swap
delta may be returned.

## 20. Per-Swap Size Cap

Each market has a maximum permitted swap notional, expressed in
USDC-equivalent value.

For each swap:

```text
swap amount → USDC notional → compare against trade cap
```

If `notional > maxTradeCap` the hook must revert.

The cap applies independently to each swap. The hook must not aggregate
transactions through unbounded loops.

## 21. Dynamic Trade Cap

The trade cap is derived from market risk. The cap may decrease as volatility
increases, market imbalance increases, liquidity decreases, or event risk
increases.

The cap must never exceed `ABS_MAX_TRADE` and must never fall below
`MIN_TRADE_CAP` unless trading is completely halted.

These bounds are immutable. No keeper or governance function may increase
`ABS_MAX_TRADE`.

## 22. Stale State

Keeper state becomes stale after `STALE_AFTER` has elapsed since the keeper's
last valid update.

Stale state must not cause the market to revert solely because the keeper is
offline. Instead:

```text
fee               → MAX_FEE
trade cap         → MIN_TRADE_CAP
deviation premium → excluded
```

The deterministic §6 time backstop continues to operate normally — stale
state degrades pricing, it never extends the trading window.

This provides a fail-closed risk posture without making the market permanently
dependent on keeper availability.

## 23. Trading Halt

Trading must halt when any of the following is true:

```text
event FINAL (keeper write — the data-driven freeze, D-103)
kickoff + MAX_EVENT_DURATION reached (time backstop, keeper-independent)
market resolved
market voided
market paused
```

The halt is enforced in `beforeSwap` and `beforeAddLiquidity`.

LP removal is not blocked. There must be no `BEFORE_REMOVE_LIQUIDITY`
permission. Therefore:

```text
Trading     → halted
Adding LP   → halted
Removing LP → permitted
```

This is intentional.

## 24. Pause

The registry supports an administrative pause as a fail-safe mechanism. When
paused:

```text
beforeSwap         → revert
beforeAddLiquidity → revert
```

LP removal remains available. The pause mechanism must not permit modification
of immutable risk ceilings.

## 25. Registry Authorization

`MarketStateRegistry` manages market registration and keeper state. It must
provide pool registration, keeper authorization, keeper state updates, operator
management, pause, and market status management.

The keeper role is separate from the operator role. The keeper cannot:

- register arbitrary pools
- change risk limits
- change operator permissions
- modify immutable bounds
- bypass pause
- modify kickoff timestamps after registration

## 26. Operator Transfer

Operator transfer must use a two-step process:

```text
current operator → propose new operator → pending operator → accept → new operator
```

The implementation should reuse Mantua's existing two-step operator-transfer
pattern rather than duplicate a separate authorization mechanism.

> See §0.5 — the `ComplianceRegistry` source is not available in this repo, so
> the pattern is reimplemented rather than imported.

## 27. Immutable Risk Policy

`RiskPolicy` contains immutable protocol bounds. At minimum:

```text
BASE_FEE
MAX_FEE
ABS_MAX_TRADE
MIN_TRADE_CAP
STALE_AFTER
MAX_EVENT_DURATION (the §6 time backstop)
```

Risk checks should be pure where possible. No external caller may increase
`MAX_FEE` or `ABS_MAX_TRADE` after deployment.

> **Values set — see §0.3.**

## 28. Security Model

The Dynamic Market Hook is a financial execution boundary. Security
requirements are mandatory.

### 28.1 PoolManager-only callbacks

Every hook callback must verify that the caller is the configured PoolManager.
No user or keeper may directly invoke callback logic.

### 28.2 CEI

Mutating callbacks must follow Checks → Effects → Interactions where
applicable.

### 28.3 Reentrancy

Mutating paths must use reentrancy protection.

### 28.4 Keeper validation

Every keeper input must be bounds-checked before storage.

### 28.5 Registry immutability

The registry address stored by the hook must be immutable.

### 28.6 Forbidden patterns

The implementation must not use `tx.origin`, `delegatecall`, or unbounded
loops. The hook must not provide a governance path that bypasses risk limits.

## 29. Fee Decomposition Event

Every successful swap must emit a fee-decomposition event containing the
individual fee contributions, exposing enough information for the Mantua UI's
market-adaptation panel to explain why the fee changed.

```solidity
event MarketFeeUpdated(
    PoolId indexed poolId,
    uint256 baseFee,
    uint256 volatilityPremium,
    uint256 imbalancePremium,
    uint256 liquidityPremium,
    uint256 eventRiskPremium,
    uint256 directionalAdjustment,
    uint256 effectiveFee
);
```

The exact ABI should be finalized during implementation to minimize event cost
while preserving all information required by the UI.

## 30. Required Contracts

Each Solidity file must be no more than 150 lines. Every file must begin with a
file-purpose statement.

**`DynamicMarketHook.sol`** — hook permissions, four callbacks, callback
authorization, orchestration, fee calculation, trade-cap enforcement, halt
enforcement.

**`MarketStateRegistry.sol`** — pool registration, pool state, keeper
authorization, keeper updates, two-step operator transfer, pause, market
lifecycle state.

**`MarketMath.sol`** — `sqrtPriceX96` → probability, decimal normalization,
EWMA volatility, flow decay, imbalance calculations, USDC notional
calculations.

**`MarketFeeCalculator.sol`** — five-premium stack, directional adjustment,
stale-state behavior, fee clamping.

**`RiskPolicy.sol`** — immutable risk limits, pure bound checks, fee bounds,
trade-cap bounds.

**`IMarketStateRegistry.sol`** — external registry interface.

**`MarketErrors.sol`** — centralized custom errors.

## 31. Reuse Requirements

Do not duplicate existing Mantua mechanisms.

**Directional fee logic** — reuse the Nezlobin directional `FeeCalculator`
logic from the existing dynamic-fee hook.

**Operator management** — reuse the two-step operator transfer and pause
pattern from `ComplianceRegistry`.

The new hook should compose existing mechanisms rather than create competing
implementations.

> See §0.5 for availability of each.

## 32. Testing Strategy

Testing follows strict TDD. For each module:

1. Define expected behavior.
2. Write a failing test.
3. Implement the minimum behavior.
4. Make the test pass.
5. Refactor.
6. Repeat.

No production implementation should be written before its corresponding
behavior is represented by a failing test.

## 33. Edge Cases

All sixteen edge cases must have explicit tests:

1. YES token as currency0
2. YES token as currency1
3. USDC as currency0
4. USDC as currency1
5. Zero liquidity
6. Zero volume
7. Zero volatility
8. Maximum volatility
9. Zero imbalance
10. Maximum imbalance
11. Same-block swaps
12. Opposite-direction swaps
13. Keeper-offline state
14. Stale keeper state
15. Time-backstop halt without keeper update (kickoff + MAX_EVENT_DURATION)
16. Paused / resolved / void market

No edge case may rely solely on incidental coverage from another test.

## 34. Fuzz Testing

A fee fuzz test must execute at least **100,000 calls** across all reachable
market states. The invariant is:

```solidity
BASE_FEE <= fee
fee <= MAX_FEE
```

The fuzz suite must include variation across probability, confidence,
liquidity, volume, volatility, imbalance, flow, time to event, event state,
token ordering, and stale state.

No fuzzed state may produce a fee outside the immutable bounds.

## 35. Integration Testing

**Registration**

```text
unregistered pool → initialization rejected
registered pool   → initialization permitted
```

**Fee**

```text
normal market   → normal fee
high volatility → higher fee
high imbalance  → higher fee
low liquidity   → higher fee
high event risk → higher fee
```

**Trade cap**

```text
below cap → succeeds
at cap    → succeeds
above cap → reverts
```

**Halt** (D-103 in-play semantics)

```text
pre-kickoff        → trade permitted
in-play (LIVE)     → trade permitted
event FINAL        → trade rejected
past kickoff + MAX_EVENT_DURATION → trade rejected (no keeper write needed)
resolved           → trade rejected
void               → trade rejected
paused             → trade rejected
```

**Liquidity**

```text
add liquidity while active    → permitted
add liquidity while halted    → rejected
remove liquidity while halted → permitted
```

## 36. Keeper Failure Testing

```text
keeper updates market
        ↓
keeper disappears
        ↓
state becomes stale
        ↓
fee clamps to MAX_FEE
trade cap clamps to MIN_TRADE_CAP
        ↓
trading continues in-play, clamped (D-103)
        ↓
kickoff + MAX_EVENT_DURATION arrives
        ↓
trading halts regardless of keeper availability
```

The keeper must never be a single point of failure for the freeze: a dead
keeper degrades pricing, and the time backstop still closes the market.

## 37. Deployment

Target Base Mainnet, chain ID 8453. Deploy against the canonical Base Mainnet
Uniswap v4 stack:

```text
PoolManager      0x498581fF718922c3f8e6A244956aF099B2652b2b
PositionManager  0x7C5f5A4bBd8fD63184577525326123B519429bDc
StateView        0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71
V4Quoter         0x0d5e0F971ED27FBfF6c2837bf31316121532048D
```

The Dynamic Market Hook must be deployed against this canonical stack.

## 38. CREATE2 Deployment

Deploy through the CREATE2 proxy
`0x4e59b44847b379578588920cA78FbF26c0B4956C`.

The salt must be mined until:

```solidity
uint160(address(hook)) & 0x3FFF == 0x28C0
```

The deployment process must be deterministic and reproducible. The resulting
hook address must be recorded.

## 39. Build Configuration

Build with `--via-ir --optimizer-runs 200`.

Required dependencies: `forge-std`, `solmate`, OpenZeppelin, `v4-core`,
`v4-periphery`. These are not vendored under `contracts/lib/` and must be
installed as part of the contract development environment.

## 40. Verification

Verify against BaseScan (`https://basescan.org`) using `--verifier etherscan`
with a BaseScan API key.

## 41. Backend Integration

Record the deployment in `server/src/lib/v4-contracts.ts` (env-driven
address), then verify `getV4StackForHook()` routes to the Base Mainnet
deployment correctly.

The backend must use the actual deployed addresses. No addresses may be
hardcoded in multiple locations.

## 42. Deployment Artifacts

Create `deploy/dynamic-market/` with deployment scripts, configuration, a
deployment README, deployed addresses, initialization information, and
verification information.

The deployment README must document chain, chain ID, PoolManager,
PositionManager, StateView, V4Quoter, DynamicMarketHook,
registry, deployment salt, resulting hook permissions, and verification status.

## 43. Architecture Decision

Update `docs/architecture.md` to document the Dynamic Market Hook. The decision
must explain:

1. Why Mantua uses a single hook instance across multiple markets.
2. Why market state is keyed by `PoolId`.
3. Why the keeper cannot directly control pricing.
4. Why risk bounds are immutable.
5. Why the freeze backstop is timestamp-driven (and the freeze itself data-driven, D-103).
6. Why stale keeper state fails closed instead of reverting.
7. Why LP removal remains available during a halt.
8. Why the initial implementation limits itself to fee, size cap, and halt.

## 44. Failure Conditions

The implementation is considered failed if any of the following occurs:

- A keeper can increase `MAX_FEE`.
- A keeper can increase `ABS_MAX_TRADE`.
- An unregistered pool can initialize.
- A static-fee pool can use the hook.
- A user can directly invoke hook callbacks.
- The freeze backstop depends on a keeper update (the backstop must fire keeper-offline).
- Stale keeper state permanently bricks the market.
- LPs cannot remove liquidity during a halt.
- `BEFORE_REMOVE_LIQUIDITY` is enabled.
- `BEFORE_SWAP_RETURNS_DELTA` is enabled.
- A fee falls below `BASE_FEE`.
- A fee exceeds `MAX_FEE`.
- A trade above the cap succeeds.
- A halted market accepts a swap.
- A zero-liquidity market causes an unintended arithmetic revert.
- Token ordering changes market math incorrectly.
- Keeper inputs are accepted outside their bounds.
- The hook uses `tx.origin`.
- The hook uses `delegatecall`.
- Any callback contains an unbounded loop.
- Any file exceeds 150 lines.
- Any TODO or placeholder remains.
- Deployment does not satisfy `0x28C0`.
- Backend routing points to the wrong deployment.
- Tests do not cover every specified edge case.
- The 100k-call fee invariant fails.

## 45. Definition of Done

Complete only when all of the following are true:

- All twelve success criteria pass.
- No failure condition exists.
- All sixteen edge cases have explicit tests.
- OutcomeToken decimals are confirmed.
- Decimal scaling is implemented if required.
- Keeper identity is configured.
- All seven contract modules are implemented.
- Every file is ≤150 lines.
- Every file has a purpose statement.
- Strict TDD has been followed.
- Fee decomposition events are emitted.
- 100k+ fee fuzz test passes.
- Both token orderings pass.
- Zero-liquidity behavior passes.
- Same-block behavior passes.
- Stale keeper behavior passes.
- Keeper-offline backstop halt passes.
- Pause behavior passes.
- Resolution behavior passes.
- Void behavior passes.
- LP removal remains possible during halts.
- Hook permissions equal exactly `0x28C0`.
- PoolManager-only callback checks pass.
- Reentrancy protection is present.
- CEI requirements are satisfied.
- Immutable risk bounds are enforced.
- No `tx.origin`.
- No `delegatecall`.
- No unbounded loops.
- Canonical Base Mainnet v4 stack addresses are confirmed.
- Hook is CREATE2 deployed.
- BaseScan verification succeeds.
- Deployment registry is updated.
- `getV4StackForHook()` routes correctly.
- `docs/architecture.md` is updated.
- Deployment README is complete.
- Trail of Bits `not-so-smart-contracts` audit passes.
- Gemini 2.5 Pro review is completed.
- Review feedback is applied.
- Full test suite passes.
- No TODOs, placeholders, or incomplete implementation remain.

## 46. Implementation Checklist

**Pre-flight**

- [x] Confirm OutcomeToken decimals — 6, see §0.1
- [x] Determine decimal scaling requirement — none, see §0.1
- [x] Configure keeper identity — market resolver key, see §0.1
- [ ] Confirm Base Mainnet addresses for the v4 stack
- [x] Install required Foundry dependencies — see §0.2

**Contracts**

- [ ] Implement `RiskPolicy.sol` — **blocked, see §0.3**
- [ ] Implement `MarketErrors.sol`
- [ ] Implement `IMarketStateRegistry.sol`
- [ ] Implement `MarketStateRegistry.sol`
- [ ] Implement `MarketMath.sol`
- [ ] Implement `MarketFeeCalculator.sol`
- [ ] Implement `DynamicMarketHook.sol`

**Tests**

- [ ] Registry tests
- [ ] Permission tests
- [ ] Registration tests
- [ ] Probability tests
- [ ] Decimal-scaling tests
- [ ] Volatility tests
- [ ] Flow tests
- [ ] Imbalance tests
- [ ] Fee tests
- [ ] Trade-cap tests
- [ ] Halt tests
- [ ] Pause tests
- [ ] Stale-state tests
- [ ] Keeper-offline tests
- [ ] Token-ordering tests
- [ ] Same-block tests
- [ ] Zero-liquidity tests
- [ ] 100k+ fuzz invariant

**Deployment**

- [ ] Deploy v4 stack
- [ ] Deploy registry
- [ ] Deploy hook
- [ ] Mine CREATE2 salt
- [ ] Confirm `0x28C0` permissions
- [ ] Register market
- [ ] Initialize test pool
- [ ] Execute test swaps
- [ ] Test dynamic fee
- [ ] Test size cap
- [ ] Test freeze (FINAL halt + time backstop)
- [ ] Verify contracts
- [ ] Record addresses

**Backend**

- [ ] Update the hook deployment registry in `server/src/lib/v4-contracts.ts`
- [ ] Verify `getV4StackForHook()`
- [ ] Confirm frontend/backend resolve the same deployment

**Documentation**

- [ ] Update `docs/architecture.md`
- [ ] Create deployment README
- [ ] Document deployed addresses
- [ ] Document market registration
- [ ] Document keeper permissions
- [ ] Document fee-decomposition event

**Final Review**

- [ ] Run full Foundry test suite
- [ ] Run security checks
- [ ] Audit against Trail of Bits `not-so-smart-contracts`
- [ ] Run Gemini 2.5 Pro review
- [ ] Apply all agreed feedback
- [ ] Re-run tests
- [ ] Confirm no TODOs/placeholders
- [ ] Confirm all files ≤150 lines
- [ ] Confirm definition of done
