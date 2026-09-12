// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: H-017 — manipulation resistance of the fee inputs. Each gameable
// input (liquidity, volatility, flow, keeper fields, price) moves the rate by
// a bounded amount, never outside [MIN_RATE, MAX_RATE], manipulation makes
// fees higher rather than lower, and its effect decays.

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {DynamicMarketHook} from "../../../src/hooks/dynamic-market/DynamicMarketHook.sol";
import {MarketStateRegistry} from "../../../src/hooks/dynamic-market/MarketStateRegistry.sol";
import {IMarketStateRegistry as I} from "../../../src/hooks/dynamic-market/IMarketStateRegistry.sol";
import {MarketFeeCalculator as C} from "../../../src/hooks/dynamic-market/MarketFeeCalculator.sol";
import {MarketMath} from "../../../src/hooks/dynamic-market/MarketMath.sol";
import {RiskPolicy} from "../../../src/hooks/dynamic-market/RiskPolicy.sol";

contract FeeManipulationTest is Test {
    using PoolIdLibrary for PoolKey;

    uint256 constant BPS = 10_000;
    uint160 constant SQRT_P50 = 56_022_770_974_786_139_918_731_938_228;

    PoolManager manager;
    MarketStateRegistry registry;
    DynamicMarketHook hook;
    address operator = makeAddr("operator");
    address keeper = makeAddr("keeper");
    PoolKey key;
    PoolId id;

    function setUp() public {
        vm.warp(1_000_000);
        manager = new PoolManager(address(this));
        registry = new MarketStateRegistry(operator, keeper);
        address target = address(uint160(0x22220000 | uint160(0x28C0)));
        deployCodeTo(
            "DynamicMarketHook.sol:DynamicMarketHook",
            abi.encode(IPoolManager(address(manager)), I(address(registry))),
            target
        );
        hook = DynamicMarketHook(target);
        key = PoolKey(
            Currency.wrap(address(0x1111)),
            Currency.wrap(address(0x2222)),
            LPFeeLibrary.DYNAMIC_FEE_FLAG,
            60,
            IHooks(target)
        );
        id = key.toId();
        vm.prank(operator);
        registry.registerPool(id, uint64(block.timestamp + 1 days), uint64(block.timestamp + 2 days), true, 6, true);
        vm.prank(keeper);
        registry.updateMarket(id, 5000, 8000, I.EventState.PRE_GAME);
        manager.initialize(key, SQRT_P50);
    }

    function _calm() internal pure returns (C.Inputs memory) {
        return C.Inputs(5000, 5000, 8000, 0, 0, 1_000_000e6, I.EventState.PRE_GAME, false, false, true);
    }

    function _quote() internal view returns (C.Breakdown memory b) {
        (, b,,) = hook.quoteFee(key, SwapParams(true, -1e6, 0));
    }

    function _rate() internal view returns (uint24) {
        return _quote().rate;
    }

    function _swapAt(uint160 sqrtPrice, int256 amount) internal {
        // Move the pool's recorded price the way a swap would, then let the
        // hook fold the swap into its accumulators.
        vm.store(
            address(manager), keccak256(abi.encodePacked(PoolId.unwrap(id), uint256(6))), bytes32(uint256(sqrtPrice))
        );
        vm.prank(address(manager));
        hook.afterSwap(address(this), key, SwapParams(true, amount, 0), BalanceDeltaLibrary.ZERO_DELTA, "");
    }

    // ─── Liquidity (an LP can add or pull at will) ───────────────────────

    function test_liquidityManipulationMovesTheRateByAtMostItsShare() public pure {
        C.Inputs memory i = _calm();
        uint24 deep = C.rate(i).rate;
        i.liquidity = 0;
        uint24 empty = C.rate(i).rate;
        assertEq(empty - deep, 1500, "pulling every drop of liquidity adds exactly 0.15%");
        assertLe(empty, RiskPolicy.MAX_RATE);
        assertGe(deep, RiskPolicy.MIN_RATE, "adding liquidity can never push the rate below the floor");
    }

    // ─── Volatility (any trader can move the price) ──────────────────────

    function test_oneManipulatingSwapRaisesVolatilityByAtMostAlpha() public {
        C.Breakdown memory before = _quote();
        _swapAt(SQRT_P50, -1e6); // establishes the reference price
        _swapAt(SQRT_P50 * 2, -1e6); // a violent move: sqrtPrice doubles, a 50% observation
        (,,, uint32 vol,) = hook.flowOf(id);
        assertEq(vol, 1000, "EWMA admits 20% of the observed move per swap");
        C.Breakdown memory after1 = _quote();
        assertLe(
            after1.volatilityPremium - before.volatilityPremium,
            300,
            "one swap lifts the volatility term by at most 0.03%"
        );
        assertGe(after1.rate, before.rate, "manipulation never lowers the rate");
        assertLe(after1.rate, RiskPolicy.MAX_RATE);
    }

    function test_volatilityGriefingSaturatesAtTheCeilingAndDecays() public {
        _swapAt(SQRT_P50, -1e6);
        for (uint256 n = 0; n < 40; n++) {
            // Thrash the price by 1000x each way: a 99.9% move every swap.
            _swapAt(n % 2 == 0 ? SQRT_P50 * 1000 : SQRT_P50, -1e6);
        }
        (,,, uint32 vol,) = hook.flowOf(id);
        assertGt(vol, 9000, "sustained thrashing saturates volatility");
        assertLe(_rate(), RiskPolicy.MAX_RATE, "and still cannot exceed the ceiling");
        // Calm swaps at a steady price bleed it off: 20% per observation.
        for (uint256 n = 0; n < 20; n++) {
            _swapAt(SQRT_P50, -1e6);
        }
        (,,, uint32 later,) = hook.flowOf(id);
        assertLt(later, 200, "the griefer's volatility is gone after twenty calm swaps");
    }

    // ─── Flow (a whale can lean on one side) ─────────────────────────────

    function test_oneSidedFlowDecaysAndAgesOut() public pure {
        uint256 liquidity = 1000e6;
        uint256 buy = 5000e6; // a whale's one-sided flow
        assertEq(MarketMath.imbalanceBps(buy, 0, liquidity), BPS, "saturated imbalance");
        uint256 halved = MarketMath.decayFlow(buy, MarketMath.FLOW_HALF_LIFE);
        assertEq(halved, buy / 2, "one half-life halves it");
        assertEq(MarketMath.decayFlow(buy, MarketMath.FLOW_MAX_AGE), 0, "old flow drops out entirely");
        // Even saturated, the activity share is bounded: imbalance + direction.
        C.Inputs memory i = _calm();
        i.imbalanceBps = BPS;
        i.increasesRisk = true;
        assertEq(C.rate(i).activityPremium, 1500, "0.15% is the most flow can add");
    }

    function test_relievingTheImbalanceIsCheaperThanAddingToIt() public pure {
        C.Inputs memory i = _calm();
        i.imbalanceBps = BPS;
        i.increasesRisk = true;
        uint24 toxic = C.rate(i).rate;
        i.increasesRisk = false;
        assertLt(C.rate(i).rate, toxic, "the side that restores balance pays less");
    }

    // ─── Keeper (the most exposed key) ───────────────────────────────────

    function test_keeperCanMoveTheRateOnlyWithinTheUncertaintyShare() public pure {
        C.Inputs memory i = _calm();
        uint24 agreed = C.rate(i).rate;
        i.modelProbBps = 0;
        i.confidenceBps = BPS;
        i.eventState = I.EventState.CRITICAL;
        uint24 worstAtEvenOdds = C.rate(i).rate;
        assertEq(worstAtEvenOdds - agreed, 1050, "at 50/50 the keeper can add at most 0.105%");
        i.marketProbBps = BPS; // the widest possible disagreement
        uint24 worst = C.rate(i).rate;
        assertEq(worst - agreed, 1500, "every keeper field at its extreme adds exactly 0.15%");
        assertLe(worst, RiskPolicy.MAX_RATE);
    }

    function test_keeperCannotTouchTheSeasonFlag() public {
        assertTrue(registry.marketState(id).playoffs);
        vm.prank(keeper);
        registry.updateMarket(id, 0, uint16(BPS), I.EventState.CRITICAL);
        assertTrue(registry.marketState(id).playoffs, "no keeper write reaches the season switch");
        assertEq(_rate() <= RiskPolicy.MAX_RATE, true);
    }

    // ─── Price (the fee follows p, so p is the obvious target) ───────────

    function test_pushingThePriceCannotLowerThePerContractFeeBelowTheFloorShape() public pure {
        // Whatever p a manipulator sets, the rate is ≥ MIN_RATE and the fee is
        // exactly rate × (1 − p): cheaper per input at high p, but each of
        // those inputs buys fewer contracts. Per contract, r · p · (1 − p).
        C.Inputs memory i = _calm();
        for (uint256 p = 0; p <= BPS; p += 500) {
            i.marketProbBps = p;
            (uint24 fee, C.Breakdown memory b) = C.calculate(i);
            assertGe(b.rate, RiskPolicy.MIN_RATE);
            assertEq(fee, uint24((uint256(b.rate) * (BPS - p)) / BPS));
        }
    }
}
