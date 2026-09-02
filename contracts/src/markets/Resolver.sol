// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Market} from "./Market.sol";
import {MarketFactory} from "./MarketFactory.sol";

/// @title Resolver
/// @notice PURPOSE: the settlement authority for every market, addressed by
///         market id. B4-001 (resolve by id, signer authority, event),
///         B4-002 (freeze forwarding), B4-004 (operator override),
///         B4-005 (void path).
///
/// @dev **Why this exists as a contract rather than an EOA.** Each `Market`
///      burns its resolver address in as an immutable at creation. If that
///      address were a raw key, rotating the key would orphan every existing
///      market. Pointing the immutable at this contract instead means the
///      *authority* is fixed while the *keys behind it* rotate: the operator
///      can replace the automated signer, hand over its own seat (two-step),
///      and — once DM-103 closes — be replaced by a multisig, all without
///      touching a deployed market (B4-007).
///
///      **Two paths in, deliberately.** The `signer` is the automated
///      resolution service; the `operator` is the manual override (B4-004). A
///      wedged or lost automation key must never leave a finished game
///      unresolvable, and the override is also the path spec §3.5 escalates to
///      when providers disagree. The Resolver adds authority only — every
///      market's own state machine still governs, so resolve-before-freeze
///      stays impossible through this contract too.
///
///      **The factory pointer is one-shot.** Set once by the operator and
///      frozen; a mutable pointer would let a future operator re-aim
///      settlement authority at a different market set. It cannot live in the
///      constructor because the factory needs this contract's address first.
contract Resolver {
    address public operator;
    address public pendingOperator;
    /// @notice The automated resolution service key. Rotatable by the operator.
    address public signer;
    MarketFactory public factory;

    /// @notice B4-006 feeds on these: the public on-chain record of who
    ///         settled what. `caller` distinguishes the automated path from a
    ///         manual override without needing a separate event.
    event MarketResolved(bytes32 indexed marketId, address indexed market, uint8 outcome, address caller);
    event MarketVoided(bytes32 indexed marketId, address indexed market, address caller);
    event SignerSet(address indexed previousSigner, address indexed newSigner);
    event OperatorProposed(address indexed pendingOperator);
    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);
    event FactorySet(address indexed factory);

    error ZeroAddress();
    error NotOperator();
    error NotPendingOperator();
    error NotAuthorized();
    error FactoryNotSet();
    error FactoryAlreadySet();
    error UnknownMarket();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @dev Signer or operator. The override is not a separate function on
    ///      purpose: one code path means the manual route cannot drift from
    ///      the automated one, and the emitted `caller` still tells them apart.
    modifier onlyAuthorized() {
        if (msg.sender != signer && msg.sender != operator) revert NotAuthorized();
        _;
    }

    constructor(address operator_, address signer_) {
        if (operator_ == address(0) || signer_ == address(0)) revert ZeroAddress();
        operator = operator_;
        signer = signer_;
    }

    // ─── Wiring ──────────────────────────────────────────────────────────

    function setFactory(MarketFactory factory_) external onlyOperator {
        if (address(factory) != address(0)) revert FactoryAlreadySet();
        if (address(factory_) == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(address(factory_));
    }

    function _market(bytes32 marketId) private view returns (Market market) {
        if (address(factory) == address(0)) revert FactoryNotSet();
        market = factory.marketOf(marketId);
        if (address(market) == address(0)) revert UnknownMarket();
    }

    // ─── Settlement (B4-001, B4-005) ─────────────────────────────────────

    /// @notice Record the outcome for a market. 0 = YES won, 1 = NO won.
    function resolve(bytes32 marketId, uint8 outcome) external onlyAuthorized {
        Market market = _market(marketId);
        market.resolve(outcome);
        emit MarketResolved(marketId, address(market), outcome, msg.sender);
    }

    /// @notice Void a postponed, cancelled, or abandoned game. Holders then
    ///         redeem at cost via `redeemInvalid` (spec §3.7).
    function voidMarket(bytes32 marketId) external onlyAuthorized {
        Market market = _market(marketId);
        market.voidMarket();
        emit MarketVoided(marketId, address(market), msg.sender);
    }

    // ─── Freeze forwarding (B4-002) ──────────────────────────────────────

    /// @notice Freeze a market by id. Permissionless, exactly as the market's
    ///         own `freeze()` is — this is address-book convenience for the
    ///         cron sweep, not a new authority.
    function freeze(bytes32 marketId) external {
        _market(marketId).freeze();
    }

    // ─── Roles ───────────────────────────────────────────────────────────

    function setSigner(address next) external onlyOperator {
        if (next == address(0)) revert ZeroAddress();
        emit SignerSet(signer, next);
        signer = next;
    }

    /// @dev Two-step, same pattern as MarketStateRegistry: a mistyped address
    ///      has to act to claim the seat, so a typo cannot take it.
    function proposeOperator(address next) external onlyOperator {
        if (next == address(0)) revert ZeroAddress();
        pendingOperator = next;
        emit OperatorProposed(next);
    }

    function acceptOperator() external {
        if (msg.sender != pendingOperator) revert NotPendingOperator();
        emit OperatorTransferred(operator, msg.sender);
        operator = msg.sender;
        pendingOperator = address(0);
    }
}
