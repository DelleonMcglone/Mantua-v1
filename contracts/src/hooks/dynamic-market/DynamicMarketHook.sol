// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IMarketStateRegistry as I} from "./IMarketStateRegistry.sol";
import {MarketErrors} from "./MarketErrors.sol";
import {MarketFeeCalculator as Calc} from "./MarketFeeCalculator.sol";
import {MarketFlow} from "./MarketFlow.sol";
import {MarketMath} from "./MarketMath.sol";

/// @title DynamicMarketHook
/// @notice PURPOSE: the four callbacks — adaptive fee, per-swap size cap, and
///         trading halt for every Mantua prediction-market pool. Spec §1, §19.
///
/// @dev **Exactly four permissions**, so the address must satisfy
///      `addr & 0x3FFF == 0x28C0` (§7). Two absences are deliberate: no
///      `BEFORE_REMOVE_LIQUIDITY`, so an LP can always exit mid-halt (§23), and
///      no `BEFORE_SWAP_RETURNS_DELTA`, so the hook can never take a cut (§1.1).
///      Unpermissioned callbacks are not implemented at all — v4 dispatches only
///      what the address bits allow, so they are unreachable.
///
///      One instance serves N pools keyed by `PoolId` (§8); nothing is
///      upgradeable and the registry address is immutable (§28.5).
contract DynamicMarketHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using MarketFlow for MarketFlow.Data;

    IPoolManager public immutable poolManager;
    I public immutable registry;

    mapping(PoolId => MarketFlow.Data) public flowOf;

    /// @dev Reentrancy latch. Spec §28.3.
    uint256 private _locked = 1;

    /// @notice Fee decomposition for the UI market-adaptation panel. Spec §29.
    /// @dev Carries the `Breakdown` struct rather than nine flat parameters: the
    ///      ABI encoding is identical for consumers, and adding a premium later
    ///      does not change this signature.
    event MarketFeeUpdated(PoolId indexed poolId, Calc.Breakdown breakdown, uint24 effectiveFee);

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert MarketErrors.NotPoolManager();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert MarketErrors.Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IPoolManager poolManager_, I registry_) {
        if (address(poolManager_) == address(0) || address(registry_) == address(0)) {
            revert MarketErrors.ZeroAddress();
        }
        poolManager = poolManager_;
        registry = registry_;
    }

    /// @notice Gate initialization on registration and a dynamic fee. Spec §8.
    /// @dev Without `DYNAMIC_FEE_FLAG` the PoolManager ignores a fee override, so
    ///      a static-fee pool would silently run at its fixed tier.
    function beforeInitialize(address, PoolKey calldata key, uint160) external view onlyPoolManager returns (bytes4) {
        if (!registry.isRegistered(key.toId())) revert MarketErrors.PoolNotRegistered();
        if (!LPFeeLibrary.isDynamicFee(key.fee)) revert MarketErrors.StaticFeePoolRejected();
        return IHooks.beforeInitialize.selector;
    }

    /// @notice Halt liquidity adds alongside trading. Spec §23.
    function beforeAddLiquidity(address, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        MarketFlow.requireTradeable(registry, registry.marketState(key.toId()));
        return IHooks.beforeAddLiquidity.selector;
    }

    /// @notice Price the swap and enforce the size cap. Spec §19, §20, §28.2.
    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        nonReentrant
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        I.MarketState memory s = registry.marketState(id);
        MarketFlow.requireTradeable(registry, s);

        (Calc.Inputs memory inputs, uint256 probBps) = flowOf[id].conditions(poolManager, id, s, params);
        (uint24 fee, Calc.Breakdown memory b) = Calc.calculate(inputs);

        uint256 notional = MarketMath.usdcNotional(
            params.amountSpecified, params.zeroForOne, s.yesIsToken0, probBps, s.outcomeDecimals
        );
        uint256 cap = Calc.tradeCap(inputs);
        if (notional > cap) revert MarketErrors.TradeExceedsCap(notional, cap);

        emit MarketFeeUpdated(id, b, fee);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    /// @notice Fold the completed swap into flow and volatility. Spec §13, §14.
    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta, bytes calldata)
        external
        onlyPoolManager
        nonReentrant
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        I.MarketState memory s = registry.marketState(id);
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(id);
        // Accumulate in USDC so both sides of the imbalance share one unit.
        uint256 notional = MarketMath.usdcNotional(
            params.amountSpecified,
            params.zeroForOne,
            s.yesIsToken0,
            MarketMath.probabilityBps(sqrtPriceX96, s.yesIsToken0),
            s.outcomeDecimals
        );
        flowOf[id].record(params, notional, sqrtPriceX96, uint64(block.timestamp));
        return (IHooks.afterSwap.selector, int128(0));
    }
}
