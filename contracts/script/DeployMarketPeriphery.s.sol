// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {PositionDescriptor} from "@uniswap/v4-periphery/src/PositionDescriptor.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {StateView} from "@uniswap/v4-periphery/src/lens/StateView.sol";
import {V4Quoter} from "@uniswap/v4-periphery/src/lens/V4Quoter.sol";

/// @title  DeployMarketPeriphery
/// @notice The v4 periphery for the Dynamic Market Hook's PoolManager
///         (B2-005 deployed the manager bare — settlement plumbing only).
///         This adds everything the app's calldata builders talk to:
///
///           V4Quoter                → price outcome-token swaps (B7-003)
///           PoolSwapTest            → execute swaps (DM-112 direct leg)
///           PoolModifyLiquidityTest → market-pool liquidity (B7-004)
///           PositionManager         → production liquidity positions
///           StateView               → pool state reads (prices → P&L, B6-009)
///
///         No CREATE2 mining — periphery addresses carry no permission bits.
///
/// @dev    PositionManager needs via-ir + runs=200 to fit EIP-170; both are
///         the project defaults in foundry.toml. run() deliberately returns
///         nothing (a returning run() breaks --broadcast serialization).
contract DeployMarketPeriphery is Script {
    IAllowanceTransfer constant PERMIT2 =
        IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    uint256 constant UNSUBSCRIBE_GAS_LIMIT = 300_000;

    function run() external {
        // The dedicated dynamic-market PoolManager (from DeployDynamicMarket).
        // Base Mainnet deployment pending — see docs/tasks/v2-roadmap.md — so
        // there is no checked-in default; pass the address explicitly.
        IPoolManager POOL_MANAGER = IPoolManager(vm.envAddress("POOL_MANAGER"));
        require(
            address(POOL_MANAGER).code.length > 0,
            "PoolManager has no code on this chain (wrong RPC?)"
        );

        vm.startBroadcast();

        PoolSwapTest swapRouter = new PoolSwapTest(POOL_MANAGER);
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(POOL_MANAGER);
        StateView stateView = new StateView(POOL_MANAGER);
        V4Quoter quoter = new V4Quoter(POOL_MANAGER);

        PositionDescriptor descriptor =
            new PositionDescriptor(POOL_MANAGER, address(0), bytes32("USDC"));
        PositionManager positionManager = new PositionManager(
            POOL_MANAGER,
            PERMIT2,
            UNSUBSCRIBE_GAS_LIMIT,
            IPositionDescriptor(address(descriptor)),
            IWETH9(address(0))
        );

        vm.stopBroadcast();

        console2.log("PoolManager (existing):", address(POOL_MANAGER));
        console2.log("PoolSwapTest:          ", address(swapRouter));
        console2.log("PoolModifyLiquidity:   ", address(lpRouter));
        console2.log("StateView:             ", address(stateView));
        console2.log("V4Quoter:              ", address(quoter));
        console2.log("PositionDescriptor:    ", address(descriptor));
        console2.log("PositionManager:       ", address(positionManager));
    }
}
