// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: B2-002 / spec §38 — prove that mining a CREATE2 salt actually yields
// a hook address satisfying `addr & 0x3FFF == 0x28C0`, and that deploying with
// that salt lands on the mined address. Without this, the constraint is only
// asserted against a hand-placed test address; here it is asserted against the
// real initcode and the real proxy, which is what deployment will use.

import {Test} from "forge-std/Test.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {HookMiner} from "../../../src/lib/HookMiner.sol";
import {DynamicMarketHook} from "../../../src/hooks/dynamic-market/DynamicMarketHook.sol";
import {MarketStateRegistry} from "../../../src/hooks/dynamic-market/MarketStateRegistry.sol";
import {IMarketStateRegistry as I} from "../../../src/hooks/dynamic-market/IMarketStateRegistry.sol";

/// @dev Minimal stand-in for the canonical CREATE2 proxy at
///      0x4e59b448…, which is not present in a fresh Foundry EVM. Same
///      semantics: `CREATE2(0, salt, initcode)` with the salt as the first
///      32 bytes of calldata, so mined addresses match what the real proxy
///      would produce for the same (deployer, salt, initcode).
contract Create2Proxy {
    fallback() external payable {
        bytes32 salt;
        assembly {
            salt := calldataload(0)
            let size := sub(calldatasize(), 32)
            let code := mload(0x40)
            calldatacopy(code, 32, size)
            let deployed := create2(0, code, size, salt)
            if iszero(deployed) { revert(0, 0) }
            mstore(0, deployed)
            return(12, 20)
        }
    }
}

contract SaltMineTest is Test {
    uint160 constant PERMISSIONS =
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    uint160 constant EXPECTED_BITS = 0x28C0;

    PoolManager manager;
    MarketStateRegistry registry;
    Create2Proxy proxy;

    function setUp() public {
        manager = new PoolManager(address(this));
        registry = new MarketStateRegistry(makeAddr("operator"), makeAddr("keeper"));
        proxy = new Create2Proxy();
    }

    function _args() internal view returns (bytes memory) {
        return abi.encode(IPoolManager(address(manager)), I(address(registry)));
    }

    function test_permissionConstantEqualsTheSpecMask() public pure {
        assertEq(PERMISSIONS, EXPECTED_BITS, "the four flags must sum to 0x28C0");
    }

    function test_mineFindsAnAddressWithTheRequiredBits() public view {
        (address predicted,) =
            HookMiner.find(address(proxy), PERMISSIONS, type(DynamicMarketHook).creationCode, _args());
        assertEq(uint160(predicted) & Hooks.ALL_HOOK_MASK, EXPECTED_BITS);
    }

    /// @dev The one that matters: deploying with the mined salt must actually
    ///      land on the mined address. If initcode and args drift apart between
    ///      mining and deployment the salt is worthless.
    function test_deployingWithTheMinedSaltLandsOnTheMinedAddress() public {
        (address predicted, bytes32 salt) =
            HookMiner.find(address(proxy), PERMISSIONS, type(DynamicMarketHook).creationCode, _args());

        bytes memory initcode = abi.encodePacked(type(DynamicMarketHook).creationCode, _args());
        (bool ok, bytes memory ret) = address(proxy).call(abi.encodePacked(salt, initcode));
        assertTrue(ok, "CREATE2 deploy failed");

        address deployed = address(uint160(bytes20(ret)));
        assertEq(deployed, predicted, "deployed address must equal the mined address");
        assertEq(uint160(deployed) & Hooks.ALL_HOOK_MASK, EXPECTED_BITS);
        assertGt(deployed.code.length, 0, "hook must have code");
    }

    /// @dev The deployed hook must hold the constructor wiring, or a compliant
    ///      address would be pointing at a mis-wired contract.
    function test_deployedHookIsWiredToTheManagerAndRegistry() public {
        (, bytes32 salt) = HookMiner.find(address(proxy), PERMISSIONS, type(DynamicMarketHook).creationCode, _args());
        bytes memory initcode = abi.encodePacked(type(DynamicMarketHook).creationCode, _args());
        (bool ok, bytes memory ret) = address(proxy).call(abi.encodePacked(salt, initcode));
        assertTrue(ok);

        DynamicMarketHook hook = DynamicMarketHook(address(uint160(bytes20(ret))));
        assertEq(address(hook.poolManager()), address(manager));
        assertEq(address(hook.registry()), address(registry));
    }

    function test_minedAddressExcludesTheForbiddenPermissions() public view {
        (address predicted,) =
            HookMiner.find(address(proxy), PERMISSIONS, type(DynamicMarketHook).creationCode, _args());
        assertEq(uint160(predicted) & Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG, 0);
        assertEq(uint160(predicted) & Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG, 0);
    }
}
