// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AgenticCommerce} from "../src/AgenticCommerce.sol";

/// Deploys the ERC-8183 AgenticCommerce escrow on Base Mainnet (8453):
/// UUPS implementation behind an ERC1967 proxy, initialized with the
/// canonical Base USDC as the payment token.
contract DeployAgenticCommerceBase is Script {
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        address treasury = vm.envAddress("TREASURY");
        address admin = vm.envAddress("ADMIN");

        vm.startBroadcast();
        AgenticCommerce impl = new AgenticCommerce();
        bytes memory init =
            abi.encodeCall(AgenticCommerce.initialize, (BASE_USDC, treasury, admin));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), init);
        vm.stopBroadcast();

        console2.log("Implementation:", address(impl));
        console2.log("Proxy (use this address):", address(proxy));
    }
}
