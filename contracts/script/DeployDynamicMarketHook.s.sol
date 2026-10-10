// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "../src/lib/HookMiner.sol";
import {DynamicMarketHook} from "../src/hooks/dynamic-market/DynamicMarketHook.sol";
import {IMarketStateRegistry} from "../src/hooks/dynamic-market/IMarketStateRegistry.sol";

/// @title  DeployDynamicMarketHook
/// @notice PURPOSE: deploys a new `DynamicMarketHook` against an existing
///         PoolManager and MarketStateRegistry — the hook-only redeploy that
///         a fee-model change needs (task 076: the dynamic fee in every
///         season). The PoolManager, the registry, the periphery bound to
///         that PoolManager, and every pool on the old hook stay as they are;
///         new markets point at the new address through the server's
///         `DYNAMIC_MARKET_BY_CHAIN.hook`.
///
/// @dev    Same salt mine as `DeployDynamicMarket.s.sol`: v4 reads a hook's
///         permissions from its address, so the mined CREATE2 address must
///         satisfy `addr & 0x3FFF == 0x28C0`. The initcode includes the
///         constructor arguments, so the salt is mined against the exact
///         `(poolManager, registry)` pair passed in — a salt from the
///         original stack deploy is worthless here because the hook's
///         bytecode changed.
///
///         Reads (public addresses only):
///           POOL_MANAGER     the live PoolManager (`hook.poolManager()` of the old hook)
///           MARKET_REGISTRY  the live MarketStateRegistry (`hook.registry()` of the old hook)
///
///         Run (from contracts/), or through `deploy/dynamic-market/deploy.sh hook-only`:
///           forge script script/DeployDynamicMarketHook.s.sol \
///             --rpc-url https://rpc.mainnet.arc.io \
///             --account mantua-deployer --sender <deployer> \
///             --broadcast --verify --verifier blockscout --verifier-url https://explorer.arc.io/api
contract DeployDynamicMarketHook is Script {
    /// @notice Canonical CREATE2 proxy, same address on every chain. Spec §38.
    address constant CREATE2_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @notice The four permissions from spec §7. Their sum is 0x28C0.
    uint160 constant PERMISSIONS =
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

    function run() external {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        IMarketStateRegistry registry = IMarketStateRegistry(vm.envAddress("MARKET_REGISTRY"));
        // A typo in either address would mine a valid-looking salt against a
        // contract that does not exist; refuse before spending anything.
        require(address(manager).code.length > 0, "POOL_MANAGER has no code");
        require(address(registry).code.length > 0, "MARKET_REGISTRY has no code");
        // The registry's read surface is what the hook depends on; a wrong
        // contract at that address reverts here, not at the first swap.
        registry.globalPaused();

        bytes memory args = abi.encode(manager, registry);
        (address predicted, bytes32 salt) =
            HookMiner.find(CREATE2_PROXY, PERMISSIONS, type(DynamicMarketHook).creationCode, args);

        vm.startBroadcast();
        DynamicMarketHook hook = new DynamicMarketHook{salt: salt}(manager, registry);
        vm.stopBroadcast();

        require(address(hook) == predicted, "mined address mismatch");
        require(uint160(address(hook)) & Hooks.ALL_HOOK_MASK == PERMISSIONS, "permission bits wrong");
        require(address(hook.poolManager()) == address(manager), "hook not wired to POOL_MANAGER");
        require(address(hook.registry()) == address(registry), "hook not wired to MARKET_REGISTRY");

        console2.log("PoolManager (reused)", address(manager));
        console2.log("Registry (reused)   ", address(registry));
        console2.log("DynamicMarketHook   ", address(hook));
        console2.log("salt                ", vm.toString(salt));
        console2.log("permission bits     ", uint256(uint160(address(hook)) & Hooks.ALL_HOOK_MASK));
    }
}
