// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "../src/lib/HookMiner.sol";
import {DynamicMarketHook} from "../src/hooks/dynamic-market/DynamicMarketHook.sol";
import {MarketStateRegistry} from "../src/hooks/dynamic-market/MarketStateRegistry.sol";
import {IMarketStateRegistry} from "../src/hooks/dynamic-market/IMarketStateRegistry.sol";

/// @title  DeployDynamicMarket
/// @notice Deploys the Dynamic Market Hook stack to Base Mainnet (chain 8453):
///         a dedicated PoolManager, the MarketStateRegistry, and the hook itself
///         at a CREATE2 address whose low bits encode exactly the four
///         permissions. Spec §37, §38.
///
/// @dev    **The salt mine is the load-bearing step.** v4 reads a hook's
///         permissions from its address, so the deployed address must satisfy
///         `addr & 0x3FFF == 0x28C0`. Mining happens against the canonical
///         CREATE2 proxy, so the resulting address depends only on
///         (proxy, salt, initcode) — it is reproducible from this script and
///         independent of the deployer's nonce.
///
///         Run (from contracts/):
///           forge script script/DeployDynamicMarket.s.sol \
///             --rpc-url https://mainnet.base.org \
///             --broadcast --via-ir --optimizer-runs 200 \
///             --verify --etherscan-api-key "$BASESCAN_API_KEY"
contract DeployDynamicMarket is Script {
    /// @notice Canonical CREATE2 proxy, same address on every chain. Spec §38.
    address constant CREATE2_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @notice The four permissions from spec §7. Their sum is 0x28C0.
    uint160 constant PERMISSIONS =
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

    function run() external {
        address operator = vm.envAddress("MARKET_OPERATOR");
        // Spec §0.1: the keeper is the market resolver key.
        address keeper = vm.envAddress("MARKET_RESOLVER");

        vm.startBroadcast();

        PoolManager manager = new PoolManager(operator);
        MarketStateRegistry registry = new MarketStateRegistry(operator, keeper);

        bytes memory args = abi.encode(IPoolManager(address(manager)), IMarketStateRegistry(address(registry)));
        (address predicted, bytes32 salt) =
            HookMiner.find(CREATE2_PROXY, PERMISSIONS, type(DynamicMarketHook).creationCode, args);

        DynamicMarketHook hook = new DynamicMarketHook{salt: salt}(
            IPoolManager(address(manager)), IMarketStateRegistry(address(registry))
        );
        require(address(hook) == predicted, "mined address mismatch");
        // Belt and braces: assert the property the mine exists to guarantee, so
        // a bad deploy fails here rather than at the first pool initialize.
        require(uint160(address(hook)) & Hooks.ALL_HOOK_MASK == PERMISSIONS, "permission bits wrong");

        vm.stopBroadcast();

        console2.log("PoolManager        ", address(manager));
        console2.log("MarketStateRegistry", address(registry));
        console2.log("DynamicMarketHook  ", address(hook));
        console2.log("salt               ", vm.toString(salt));
        console2.log("permission bits    ", uint256(uint160(address(hook)) & Hooks.ALL_HOOK_MASK));
    }
}
