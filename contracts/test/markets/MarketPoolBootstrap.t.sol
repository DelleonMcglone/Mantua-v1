// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/test/utils/mocks/MockERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {Market} from "../../src/markets/Market.sol";
import {MarketFactory} from "../../src/markets/MarketFactory.sol";
import {MarketPoolBootstrap} from "../../src/markets/MarketPoolBootstrap.sol";

/// @dev Thin wrapper so the internal library can be called from tests.
contract BootstrapHarness {
    function poolKeyFor(Market market, address usdc, uint24 fee, int24 tickSpacing, address hook)
        external
        view
        returns (PoolKey memory key, bool yesIsToken0)
    {
        return MarketPoolBootstrap.poolKeyFor(market, usdc, fee, tickSpacing, hook);
    }

    function initializePool(IPoolManager manager, PoolKey memory key, uint160 sqrtPriceX96)
        external
        returns (PoolId poolId, int24 tick)
    {
        return MarketPoolBootstrap.initializePool(manager, key, sqrtPriceX96);
    }
}

/// @notice B1-009 — pool bootstrap at the opening implied probability.
contract MarketPoolBootstrapTest is Test {
    using StateLibrary for IPoolManager;

    MockERC20 usdc;
    MarketFactory factory;
    Market market;
    PoolManager manager;
    BootstrapHarness harness;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        factory = new MarketFactory(usdc, makeAddr("resolver"));
        market = factory.createMarket(
            keccak256("nfl-401671789-moneyline-0"), uint64(block.timestamp + 1 days), "NFL Chiefs"
        );
        manager = new PoolManager(address(this));
        harness = new BootstrapHarness();
    }

    function test_poolKeySortsCurrenciesByAddress() public view {
        (PoolKey memory key, bool yesIsToken0) =
            harness.poolKeyFor(market, address(usdc), FEE, TICK_SPACING, address(0));

        address token0 = Currency.unwrap(key.currency0);
        address token1 = Currency.unwrap(key.currency1);
        assertLt(uint160(token0), uint160(token1), "v4 requires currency0 < currency1");

        // The reported ordering must match reality — the caller computes
        // sqrtPriceX96 from this flag, and getting it wrong seeds 1 - p.
        assertEq(yesIsToken0, address(market.yesToken()) < address(usdc));
        assertEq(yesIsToken0 ? token0 : token1, address(market.yesToken()));
    }

    function test_poolKeyCarriesFeeSpacingAndHook() public view {
        address hook = address(0);
        (PoolKey memory key,) = harness.poolKeyFor(market, address(usdc), FEE, TICK_SPACING, hook);
        assertEq(key.fee, FEE);
        assertEq(key.tickSpacing, TICK_SPACING);
        assertEq(address(key.hooks), hook);
    }

    function test_initializesPoolAtGivenPrice() public {
        (PoolKey memory key, bool yesIsToken0) =
            harness.poolKeyFor(market, address(usdc), FEE, TICK_SPACING, address(0));

        // 0.62 implied probability, from probabilityToSqrtPriceX96(0.62, …).
        uint160 sqrtPriceX96 = _sqrtPriceForProbability(62, yesIsToken0);
        (PoolId poolId,) = harness.initializePool(manager, key, sqrtPriceX96);

        (uint160 stored,,,) = StateLibrary.getSlot0(IPoolManager(address(manager)), poolId);
        assertEq(stored, sqrtPriceX96, "pool must open at the seeded price");
    }

    function test_evenOddsOpenAtHalfNotParity() public {
        (PoolKey memory key, bool yesIsToken0) =
            harness.poolKeyFor(market, address(usdc), FEE, TICK_SPACING, address(0));

        uint160 sqrtPriceX96 = _sqrtPriceForProbability(50, yesIsToken0);
        (PoolId poolId, int24 tick) = harness.initializePool(manager, key, sqrtPriceX96);

        // A 50% chance means a YES is worth 0.5 USDC, so the pool ratio is
        // 0.5 — not 1. Parity would mean a YES costs a full dollar, i.e. a
        // certainty. ln(0.5)/ln(1.0001) ≈ -6932, mirrored when YES is token1.
        assertEq(tick, yesIsToken0 ? int24(-6932) : int24(6931));

        (uint160 stored,,,) = StateLibrary.getSlot0(IPoolManager(address(manager)), poolId);
        assertEq(stored, sqrtPriceX96, "pool must open at the seeded price");
    }

    function test_seedingWithTheWrongOrderingOpensAtTheComplement() public {
        // The failure this guards against is silent: pass the wrong
        // `yesIsToken0` and the market opens at 1 - p with no error anywhere.
        (, bool yesIsToken0) = harness.poolKeyFor(market, address(usdc), FEE, TICK_SPACING, address(0));

        uint160 correct = _sqrtPriceForProbability(25, yesIsToken0);
        uint160 reversed = _sqrtPriceForProbability(25, !yesIsToken0);
        assertTrue(correct != reversed, "ordering must change the seeded price");
    }

    function test_cannotInitializeTwice() public {
        (PoolKey memory key, bool yesIsToken0) =
            harness.poolKeyFor(market, address(usdc), FEE, TICK_SPACING, address(0));
        uint160 sqrtPriceX96 = _sqrtPriceForProbability(62, yesIsToken0);

        harness.initializePool(manager, key, sqrtPriceX96);
        vm.expectRevert();
        harness.initializePool(manager, key, sqrtPriceX96);
    }

    /// @dev Mirrors `probabilityToSqrtPriceX96` for whole-percent inputs.
    ///      Kept simple and local: the production conversion lives in
    ///      `server/src/lib/probability.ts`, and this only has to produce a
    ///      valid price to initialise with.
    function _sqrtPriceForProbability(uint256 percent, bool yesIsToken0) private pure returns (uint160) {
        // ratio = p (YES is token0) or 1/p (YES is token1), in Q64.96.
        uint256 numerator = yesIsToken0 ? percent : 100;
        uint256 denominator = yesIsToken0 ? 100 : percent;
        uint256 ratioX192 = (numerator << 192) / denominator;
        return uint160(_sqrt(ratioX192));
    }

    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
