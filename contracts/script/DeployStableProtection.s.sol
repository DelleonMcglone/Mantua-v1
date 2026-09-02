// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

// ─── v4-core ─────────────────────────────────────────────────────────────────
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

// ─── HookMiner — vendored from v4-periphery@eeb3eff (see src/lib/HookMiner.sol) ──
import {HookMiner} from "../src/lib/HookMiner.sol";

// ─── vendored hook (submodule, see contracts/hooks/stable-protection) ────────
import {StableProtectionHook} from "stable-protection/StableProtectionHook.sol";

/// @title  DeployStableProtection
/// @notice Deploys StableProtectionHook to Base Mainnet (8453) against the
///         canonical Uniswap v4 PoolManager. Parameterized: PoolManager
///         address comes from an env var so the same script can target any
///         chain where v4 is deployed.
///
///         This script is **not run by CI**. Manual run procedure lives in
///         `contracts/script/README.md`. Deployment is gated on security
///         sign-off (`docs/security/sign-off.md`).
///
///         Differences from the upstream `Deploy.s.sol` in
///         `hooks/stable-protection/script/`:
///           - PoolManager via env (was: hardcoded for another chain)
///           - No mock stablecoins / liquidity / test swap — pool creation
///             runs separately via the existing client flow, using the
///             canonical Base Mainnet USDC/EURC. Keeps this script focused
///             on a single deliverable: hook deployed at a verified address.
///           - solc 0.8.27 to match the monorepo's foundry.toml.
contract DeployStableProtection is Script {
    /// @dev Canonical v4 PoolManager on Base Mainnet (8453). Verified
    ///      against developers.uniswap.org/contracts/v4/deployments.
    ///      Override via `POOL_MANAGER` env var.
    address constant DEFAULT_POOL_MANAGER_BASE = 0x498581fF718922c3f8e6A244956aF099B2652b2b;

    /// @dev Standard CREATE2 deterministic deployer used by `forge script
    ///      --broadcast`. Same address on every chain.
    address constant CREATE2_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @dev Permission bits that exactly match
    ///      StableProtectionHook.getHookPermissions():
    ///      beforeInitialize (bit 13) | beforeSwap (bit 7) | afterSwap (bit 6).
    ///      The mined hook address must encode these bits in its lower 14 bits
    ///      or the v4 PoolManager rejects pool initialization.
    uint160 constant HOOK_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

    function run() external returns (address hookAddr) {
        // ── parameters ─────────────────────────────────────────────────────
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address poolManager = vm.envOr("POOL_MANAGER", DEFAULT_POOL_MANAGER_BASE);

        console2.log("Network chain ID:", block.chainid);
        console2.log("PoolManager:", poolManager);
        console2.log("Deployer:", vm.addr(pk));

        // Sanity: bytecode must be present at the configured PoolManager. If
        // it isn't, --rpc-url is wrong or the address is wrong — fail loud
        // before mining a salt against a non-existent contract.
        require(poolManager.code.length > 0, "PoolManager has no bytecode on this chain");

        // NOTE: the vendored hook takes only the PoolManager — the peg-
        // reference owner/keeper interface the server's peg-sync expects is
        // not in this submodule revision. Pin the hook submodule to the
        // revision carrying setPegReference before the mainnet deploy.

        // ── mine CREATE2 salt for a valid hook address ─────────────────────
        bytes32 salt;
        (hookAddr, salt) = HookMiner.find(
            CREATE2_PROXY,
            HOOK_FLAGS,
            type(StableProtectionHook).creationCode,
            abi.encode(address(poolManager))
        );
        console2.log("Mined hook address:", hookAddr);
        console2.logBytes32(salt);

        // ── deploy ─────────────────────────────────────────────────────────
        vm.startBroadcast(pk);
        StableProtectionHook hook = new StableProtectionHook{salt: salt}(IPoolManager(poolManager));
        vm.stopBroadcast();

        require(address(hook) == hookAddr, "Mined and deployed addresses diverged");

        console2.log("Hook deployed:", address(hook));
        console2.log("Permission flags (lower 14 bits):", uint256(uint160(address(hook)) & 0x3FFF));
    }
}
