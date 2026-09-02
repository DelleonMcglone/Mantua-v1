// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";
import {Resolver} from "../src/markets/Resolver.sol";
import {MarketFactory} from "../src/markets/MarketFactory.sol";

/// @notice B4 wiring — deploys the settlement authority and the market
///         factory in the only order that works:
///
///           1. Resolver(operator, signer)        — the fixed authority address
///           2. MarketFactory(USDC, resolver)     — burns the resolver in as immutable
///           3. resolver.setFactory(factory)      — one-shot back-pointer
///
///         Every Market the factory creates inherits the Resolver's address
///         as its immutable resolver, so keys behind the Resolver rotate
///         without ever redeploying a market (see Resolver.sol).
///
/// Env (PUBLIC addresses only — never a private key):
///   MARKET_OPERATOR  — Resolver operator (manual override + role rotation)
///   MARKET_RESOLVER  — automated settlement signer (keeper key, spec §0.1)
///   USDC             — collateral token; defaults to canonical Base Mainnet USDC.
contract DeployMarkets is Script {
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        address operator = vm.envAddress("MARKET_OPERATOR");
        address signer = vm.envAddress("MARKET_RESOLVER");
        address usdc = vm.envOr("USDC", BASE_USDC);

        require(operator != address(0) && signer != address(0), "zero role address");
        // setFactory is operator-only and must land in this same broadcast —
        // so the broadcasting key HAS to be the operator. (Run with
        // --sender "$(cast wallet address --account mantua-deployer)" and
        // MARKET_OPERATOR set to that same address.)
        require(msg.sender == operator, "broadcast sender must be MARKET_OPERATOR");
        require(usdc.code.length > 0, "USDC has no code on this chain");

        vm.startBroadcast();
        Resolver resolver = new Resolver(operator, signer);
        MarketFactory factory = new MarketFactory(ERC20(usdc), address(resolver));
        resolver.setFactory(factory);
        vm.stopBroadcast();

        require(address(resolver.factory()) == address(factory), "setFactory not wired");
        require(factory.resolver() == address(resolver), "factory resolver mismatch");

        console2.log("Resolver      ", address(resolver));
        console2.log("MarketFactory ", address(factory));
        console2.log("collateral    ", usdc);
        console2.log("operator      ", operator);
        console2.log("signer        ", signer);
    }
}
