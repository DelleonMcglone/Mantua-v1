// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";

/**
 * Arc Mainnet fork harness — shared setUp and on-chain addresses for
 * every integration test in this directory.
 *
 * Tests fork live Arc Mainnet (5042) at `latest` (no pinned block) so
 * a freshly-deployed hook shows up immediately. Pinning a block is
 * appropriate for tests that depend on exact pool state — add
 * `vm.createSelectFork(rpc, BLOCK)` overrides per-test as needed.
 *
 * RPC source priority:
 *   1. `ARC_RPC_URL` env var (set in `.env` or CI secrets)
 *   2. Public endpoint `https://rpc.mainnet.arc.io` (rate-limited; OK for
 *      bytecode/permission-flag checks; not great for high-fanout reads)
 *
 * Mantua's PoolManager address comes from the `POOL_MANAGER` env var
 * rather than a checked-in constant. Tests that need it call
 * `_requirePoolManager()` and skip cleanly while the var is unset.
 *
 * Run from repo root:
 *   forge test --match-path "contracts/test/integration/*.t.sol" -vv
 */
abstract contract ArcFork is Test {
    uint256 internal constant ARC_CHAIN_ID = 5042;

    /// Arc has NO canonical Uniswap v4 PoolManager (checked 2026-09-29 against
    /// docs.arc.io/arc/references/contract-addresses). The only v4 stack on
    /// Arc is Mantua's own, deployed by DeployDynamicMarket.s.sol — read from
    /// the `POOL_MANAGER` env var, address(0) until that deploy lands.
    address internal V4_POOL_MANAGER;

    function setUp() public virtual {
        string memory rpc = _resolveRpc();
        vm.createSelectFork(rpc);
        require(block.chainid == ARC_CHAIN_ID, "fork: not Arc Mainnet");
        V4_POOL_MANAGER = _envHook("POOL_MANAGER");
    }

    function _resolveRpc() internal returns (string memory) {
        try vm.envString("ARC_RPC_URL") returns (string memory url) {
            if (bytes(url).length > 0) return url;
        } catch {}
        return "https://rpc.mainnet.arc.io";
    }

    /// Reads an address from the env; address(0) means "not deployed yet".
    function _envHook(string memory envVar) internal returns (address) {
        try vm.envAddress(envVar) returns (address hook) {
            return hook;
        } catch {}
        return address(0);
    }

    /// Skips the calling test until Mantua's PoolManager is deployed on Arc
    /// and named in `POOL_MANAGER`.
    function _requirePoolManager() internal {
        if (V4_POOL_MANAGER == address(0)) vm.skip(true);
    }
}
