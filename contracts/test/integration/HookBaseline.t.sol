// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {BaseFork} from "./BaseFork.t.sol";

/**
 * On-chain baseline: each Mantua hook's bytecode is deployed at its
 * configured Base Mainnet address and its CREATE2-encoded permission
 * flags match what the hook source declares.
 *
 * This is the foundry-native counterpart to `npm run verify:hooks`
 * (which fetches via JSON-RPC + viem). Running both catches drift
 * between the off-chain registry in `verify-hooks.ts` and the
 * on-chain reality.
 *
 * Hook addresses come from env vars (see BaseFork) — while the mainnet
 * deployment is pending, the per-hook checks skip and only the canonical
 * PoolManager check runs.
 */
contract HookBaseline is BaseFork {
    function test_StableProtection_deployed() public {
        _requireHook(STABLE_PROTECTION_HOOK);
        assertGt(STABLE_PROTECTION_HOOK.code.length, 0, "StableProtectionHook not deployed");
        assertEq(
            _hookFlags(STABLE_PROTECTION_HOOK),
            FLAG_BEFORE_INITIALIZE | FLAG_BEFORE_SWAP | FLAG_AFTER_SWAP,
            "StableProtection: flag mismatch"
        );
    }

    function test_DynamicFee_deployed() public {
        _requireHook(DYNAMIC_FEE_HOOK);
        assertGt(DYNAMIC_FEE_HOOK.code.length, 0, "DynamicFeeHook not deployed");
        assertEq(
            _hookFlags(DYNAMIC_FEE_HOOK),
            FLAG_BEFORE_SWAP | FLAG_AFTER_SWAP,
            "DynamicFee: flag mismatch"
        );
    }

    function test_PoolManager_deployed() public view {
        assertGt(
            V4_POOL_MANAGER_BASE.code.length, 0, "Uniswap v4 PoolManager not deployed at expected address"
        );
    }
}
