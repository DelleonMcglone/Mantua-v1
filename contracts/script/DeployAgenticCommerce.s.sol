// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC8183} from "erc8183/ERC8183.sol";

/// @notice L-018 — the ERC-8183 AgenticCommerce escrow on Arc Mainnet (5042):
///         the vendored reference implementation (erc-8183/base-contracts at
///         commit 142e669, MIT) behind an ERC1967 proxy (UUPS), initialised with the
///         platform treasury and admin, and Arc USDC allow-listed as the only
///         payment token — the reference refuses `setBudget` on any token not
///         on its allowlist, so a deploy without this step escrows nothing.
///
///         Three transactions in one broadcast: implementation, proxy
///         (initialize), allowlist. `setPaymentTokenAllowed` is ADMIN_ROLE, so
///         the broadcasting key must be ADMIN.
///
/// Env (PUBLIC addresses only — never a private key):
///   TREASURY  — receives platform fees (platformFeeBP starts at 0)
///   ADMIN     — DEFAULT_ADMIN_ROLE + ADMIN_ROLE (upgrades, pause, allowlists)
///   USDC      — payment token; defaults to Arc USDC (0x3600…0000)
contract DeployAgenticCommerce is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        address treasury = vm.envAddress("TREASURY");
        address admin = vm.envAddress("ADMIN");
        address usdc = vm.envOr("USDC", ARC_USDC);
        require(treasury != address(0) && admin != address(0), "zero role address");
        require(msg.sender == admin, "broadcast sender must be ADMIN (allowlist is ADMIN_ROLE)");
        require(usdc.code.length > 0, "USDC has no code on this chain");

        vm.startBroadcast();
        ERC8183 impl = new ERC8183();
        bytes memory init = abi.encodeCall(ERC8183.initialize, (treasury, admin));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), init);
        ERC8183 commerce = ERC8183(address(proxy));
        commerce.setPaymentTokenAllowed(usdc, true);
        vm.stopBroadcast();

        require(commerce.platformTreasury() == treasury, "treasury not wired");
        require(commerce.hasRole(commerce.DEFAULT_ADMIN_ROLE(), admin), "admin role missing");
        require(commerce.allowedPaymentTokens(usdc), "USDC not allow-listed");
        require(commerce.jobCounter() == 0, "fresh proxy expected");

        console2.log("Implementation          ", address(impl));
        console2.log("Proxy (AGENTIC_COMMERCE)", address(proxy));
        console2.log("paymentToken            ", usdc);
        console2.log("treasury                ", treasury);
        console2.log("admin                   ", admin);
    }
}
