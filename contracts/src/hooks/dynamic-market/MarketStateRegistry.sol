// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IMarketStateRegistry} from "./IMarketStateRegistry.sol";
import {MarketErrors} from "./MarketErrors.sol";

/// @title MarketStateRegistry
/// @notice PURPOSE: owns per-pool market state, the keeper/operator split, the
///         two-step operator transfer, and the pause. Spec §8, §25, §26, §24.
///
/// @dev **Two roles, deliberately.** The `operator` registers pools, pauses, and
///      rotates roles. The `keeper` writes exactly three fields (spec §4.1) and
///      nothing else. A compromised keeper — the key most exposed, since it
///      writes on every game tick — therefore cannot register a pool, pause,
///      move a kickoff timestamp, or take the operator role (spec §25).
///
///      Registration is once-only. There is no kickoff setter at all, because
///      a mutable kickoff would defeat the §6 freeze: the freeze reads that
///      timestamp, so anyone able to push it forward could keep a started game
///      tradeable.
contract MarketStateRegistry is IMarketStateRegistry {
    /// @inheritdoc IMarketStateRegistry
    address public override operator;
    /// @notice Proposed next operator, pending acceptance. Spec §26.
    address public pendingOperator;
    /// @inheritdoc IMarketStateRegistry
    address public override keeper;
    /// @inheritdoc IMarketStateRegistry
    bool public override globalPaused;

    mapping(PoolId => MarketState) private _states;

    uint16 private constant MAX_BPS = 10_000;

    modifier onlyOperator() {
        if (msg.sender != operator) revert MarketErrors.NotOperator();
        _;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert MarketErrors.NotKeeper();
        _;
    }

    constructor(address operator_, address keeper_) {
        if (operator_ == address(0) || keeper_ == address(0)) revert MarketErrors.ZeroAddress();
        operator = operator_;
        keeper = keeper_;
    }

    // ─── Registration (§8) ───────────────────────────────────────────────

    /// @notice Register a pool so the hook will permit its initialization.
    /// @param yesIsToken0 Whether YES sorted into token0. Recorded once so the
    ///        hook cannot get the ordering backwards when reading price.
    /// @param outcomeDecimals Outcome-token decimals (spec §9).
    function registerPool(
        PoolId poolId,
        uint64 kickoffTimestamp,
        uint64 resolutionTimestamp,
        bool yesIsToken0,
        uint8 outcomeDecimals
    ) external onlyOperator {
        MarketState storage s = _states[poolId];
        if (s.registered) revert MarketErrors.PoolAlreadyRegistered();
        if (kickoffTimestamp <= block.timestamp) revert MarketErrors.KickoffInPast();

        s.registered = true;
        s.kickoffTimestamp = kickoffTimestamp;
        s.resolutionTimestamp = resolutionTimestamp;
        s.yesIsToken0 = yesIsToken0;
        s.outcomeDecimals = outcomeDecimals;
        s.eventState = EventState.PRE_GAME;

        emit PoolRegistered(poolId, kickoffTimestamp, yesIsToken0, outcomeDecimals);
    }

    // ─── Keeper writes (§4.1, §28.4) ─────────────────────────────────────

    /// @notice Write the three keeper-controlled fields. Spec §4.1.
    /// @dev Bounds are checked before storage (spec §28.4), so an out-of-range
    ///      value never reaches state and cannot be read by a later fee
    ///      calculation. `lastUpdate` is stamped here and is what §22 staleness
    ///      measures from.
    function updateMarket(PoolId poolId, uint16 modelProbability, uint16 confidence, EventState eventState)
        external
        onlyKeeper
    {
        MarketState storage s = _states[poolId];
        if (!s.registered) revert MarketErrors.PoolNotRegistered();
        if (modelProbability > MAX_BPS) revert MarketErrors.ProbabilityOutOfRange(modelProbability);
        if (confidence > MAX_BPS) revert MarketErrors.ConfidenceOutOfRange(confidence);

        s.modelProbability = modelProbability;
        s.confidence = confidence;
        s.eventState = eventState;
        s.lastUpdate = uint64(block.timestamp);

        emit MarketUpdated(poolId, modelProbability, confidence, eventState);
    }

    // ─── Pause (§24) ─────────────────────────────────────────────────────

    function setPaused(PoolId poolId, bool paused) external onlyOperator {
        if (!_states[poolId].registered) revert MarketErrors.PoolNotRegistered();
        _states[poolId].paused = paused;
        emit PausedSet(poolId, paused);
    }

    function setGlobalPaused(bool paused) external onlyOperator {
        globalPaused = paused;
        emit GlobalPausedSet(paused);
    }

    // ─── Role management (§25, §26) ──────────────────────────────────────

    /// @dev Two steps so a mistyped address cannot take the role — it has to
    ///      act to claim it. Re-proposing overwrites a pending typo.
    function proposeOperator(address next) external onlyOperator {
        if (next == address(0)) revert MarketErrors.ZeroAddress();
        pendingOperator = next;
        emit OperatorProposed(next);
    }

    function acceptOperator() external {
        if (msg.sender != pendingOperator) revert MarketErrors.NotPendingOperator();
        emit OperatorTransferred(operator, msg.sender);
        operator = msg.sender;
        pendingOperator = address(0);
    }

    function setKeeper(address next) external onlyOperator {
        if (next == address(0)) revert MarketErrors.ZeroAddress();
        emit KeeperSet(keeper, next);
        keeper = next;
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function marketState(PoolId poolId) external view override returns (MarketState memory) {
        MarketState memory s = _states[poolId];
        if (!s.registered) revert MarketErrors.PoolNotRegistered();
        return s;
    }

    function isRegistered(PoolId poolId) external view override returns (bool) {
        return _states[poolId].registered;
    }
}
