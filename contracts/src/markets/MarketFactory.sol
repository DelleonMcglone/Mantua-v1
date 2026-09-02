// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "solmate/tokens/ERC20.sol";
import {Market} from "./Market.sol";

/// @title MarketFactory
/// @notice Deploys one `Market` — and with it a YES/NO ERC-20 pair — per
///         prediction market. B1-001.
///
/// @dev Creation is keyed on the deterministic market id from
///      `server/src/lib/market-id.ts` (B0-004), which is what makes the
///      market generator safe to re-run: a repeated slate refresh finds the
///      market already deployed and reverts rather than creating a second
///      market for the same game with its own separate collateral pool.
///
///      Callers that want idempotence without a revert should read
///      `marketOf(marketId)` first — see `createMarketIfAbsent`.
contract MarketFactory {
    /// @notice USDC. Every market on this factory shares one collateral token.
    ERC20 public immutable collateral;
    /// @notice Authorised to resolve and void markets this factory creates.
    ///         Identity is DM-103, still open.
    address public immutable resolver;

    /// @notice marketId → deployed market. Zero when not yet created.
    mapping(bytes32 => Market) public marketOf;
    /// @notice Every market this factory has deployed, in creation order.
    bytes32[] public marketIds;

    event MarketCreated(bytes32 indexed marketId, address market, address yesToken, address noToken, uint64 startsAt);

    error MarketExists();
    error ZeroResolver();
    error StartInPast();

    constructor(ERC20 collateral_, address resolver_) {
        if (resolver_ == address(0)) revert ZeroResolver();
        collateral = collateral_;
        resolver = resolver_;
    }

    /// @notice Deploy the market for `marketId`. Reverts if it already exists.
    /// @param marketId Deterministic id per B0-004.
    /// @param startsAt Scheduled kickoff; the market freezes at this time.
    /// @param label    Human label used to name the outcome tokens.
    function createMarket(bytes32 marketId, uint64 startsAt, string calldata label) external returns (Market market) {
        if (address(marketOf[marketId]) != address(0)) revert MarketExists();
        // A market whose kickoff has already passed would be born frozen and
        // could never be traded — reject rather than deploy dead weight.
        if (startsAt <= block.timestamp) revert StartInPast();

        market = new Market(marketId, collateral, startsAt, resolver, label);
        marketOf[marketId] = market;
        marketIds.push(marketId);

        emit MarketCreated(marketId, address(market), address(market.yesToken()), address(market.noToken()), startsAt);
    }

    /// @notice Idempotent variant for the market generator (B3-006): returns
    ///         the existing market instead of reverting, so a slate refresh
    ///         over games it has already seen is a no-op.
    function createMarketIfAbsent(bytes32 marketId, uint64 startsAt, string calldata label)
        external
        returns (Market market, bool created)
    {
        market = marketOf[marketId];
        if (address(market) != address(0)) return (market, false);
        if (startsAt <= block.timestamp) revert StartInPast();

        market = new Market(marketId, collateral, startsAt, resolver, label);
        marketOf[marketId] = market;
        marketIds.push(marketId);
        created = true;

        emit MarketCreated(marketId, address(market), address(market.yesToken()), address(market.noToken()), startsAt);
    }

    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }
}
