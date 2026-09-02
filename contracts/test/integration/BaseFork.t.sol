// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";

/**
 * Base Mainnet fork harness — shared setUp and on-chain addresses for
 * every integration test in this directory.
 *
 * Tests fork live Base Mainnet (8453) at `latest` (no pinned block) so
 * a freshly-deployed hook shows up immediately. Pinning a block is
 * appropriate for tests that depend on exact pool state — add
 * `vm.createSelectFork(rpc, BLOCK)` overrides per-test as needed.
 *
 * RPC source priority:
 *   1. `BASE_RPC_URL` env var (set in `.env` or CI secrets)
 *   2. Public endpoint `https://mainnet.base.org` (rate-limited; OK for
 *      bytecode/permission-flag checks; not great for high-fanout reads)
 *
 * Mantua's hooks have no Base Mainnet deployment yet, so their addresses
 * come from env vars rather than checked-in constants:
 *   `STABLE_PROTECTION_HOOK_ADDRESS`, `DYNAMIC_FEE_HOOK_ADDRESS`
 * Tests that need a hook call `_requireHook(...)` and skip cleanly while
 * the env var is unset — once the mainnet deploy lands, set the vars and
 * the suite runs in full.
 *
 * Run from repo root:
 *   forge test --match-path "contracts/test/integration/*.t.sol" -vv
 */
abstract contract BaseFork is Test {
    uint256 internal constant BASE_CHAIN_ID = 8453;

    /// Canonical Uniswap v4 PoolManager on Base Mainnet
    /// (developers.uniswap.org/contracts/v4/deployments).
    address internal constant V4_POOL_MANAGER_BASE = 0x498581fF718922c3f8e6A244956aF099B2652b2b;

    /// Mantua hook addresses — env-driven, address(0) until deployed.
    address internal STABLE_PROTECTION_HOOK;
    address internal DYNAMIC_FEE_HOOK;

    /// Lower 14 bits of a hook address encode its lifecycle permissions
    /// per Uniswap v4 Hooks.sol — see also contracts/script/verify-hooks.ts.
    uint16 internal constant FLAG_BEFORE_INITIALIZE = 1 << 13;
    uint16 internal constant FLAG_BEFORE_SWAP = 1 << 7;
    uint16 internal constant FLAG_AFTER_SWAP = 1 << 6;

    function setUp() public virtual {
        string memory rpc = _resolveRpc();
        vm.createSelectFork(rpc);
        require(block.chainid == BASE_CHAIN_ID, "fork: not Base Mainnet");
        STABLE_PROTECTION_HOOK = _envHook("STABLE_PROTECTION_HOOK_ADDRESS");
        DYNAMIC_FEE_HOOK = _envHook("DYNAMIC_FEE_HOOK_ADDRESS");
    }

    function _resolveRpc() internal returns (string memory) {
        try vm.envString("BASE_RPC_URL") returns (string memory url) {
            if (bytes(url).length > 0) return url;
        } catch {}
        return "https://mainnet.base.org";
    }

    /// Reads a hook address from the env; address(0) means "not deployed yet".
    function _envHook(string memory envVar) internal returns (address) {
        try vm.envAddress(envVar) returns (address hook) {
            return hook;
        } catch {}
        return address(0);
    }

    /// Skips the calling test while the hook's mainnet deployment is pending.
    function _requireHook(address hook) internal {
        if (hook == address(0)) vm.skip(true);
    }

    function _hookFlags(address hook) internal pure returns (uint16) {
        // Permission flags live in the lower 14 bits — truncation is the point.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(uint160(hook)) & 0x3FFF;
    }
}
