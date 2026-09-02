// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

/// @title IMarketStateRegistry
/// @notice PURPOSE: the read surface the hook uses to reach market state, and
///         the shared types. Spec §30.
///
/// @dev The hook holds this as an immutable address (spec §28.5) and only ever
///      reads through it. Keeping the interface read-only from the hook's side
///      is what stops a hook callback from becoming a write path into keeper
///      state.
interface IMarketStateRegistry {
    /// @notice Event lifecycle. Spec §5.
    enum EventState {
        PRE_GAME,
        LIVE,
        CRITICAL,
        FINAL,
        RESOLVED,
        VOID
    }

    /// @notice Per-pool market state. Spec §4.
    /// @dev `modelProbability`, `confidence`, and `eventState` are the only
    ///      keeper-writable fields (spec §4.1). Everything the fee depends on
    ///      beyond these is derived on-chain from the pool (spec §4.2).
    struct MarketState {
        uint16 modelProbability;
        uint16 confidence;
        EventState eventState;
        uint64 kickoffTimestamp;
        uint64 resolutionTimestamp;
        bool registered;
        bool paused;
        /// @dev Timestamp of the keeper's last valid write. Zero means never
        ///      written, which `RiskPolicy.isStale` treats as stale.
        uint64 lastUpdate;
        /// @dev True when YES sorted into the token0 slot of the pool key.
        ///      Recorded at registration so the hook never has to re-derive it,
        ///      and cannot get it backwards.
        bool yesIsToken0;
        /// @dev Outcome-token decimals captured at registration. Spec §9
        ///      requires a scaling factor if this is not 6; it is 6 today
        ///      (spec §0.1) but storing it means a future non-6dp collateral
        ///      cannot silently break notional maths.
        uint8 outcomeDecimals;
    }

    event PoolRegistered(PoolId indexed poolId, uint64 kickoffTimestamp, bool yesIsToken0, uint8 outcomeDecimals);
    event MarketUpdated(PoolId indexed poolId, uint16 modelProbability, uint16 confidence, EventState eventState);
    event PausedSet(PoolId indexed poolId, bool paused);
    event GlobalPausedSet(bool paused);
    event OperatorProposed(address indexed pendingOperator);
    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);
    event KeeperSet(address indexed previousKeeper, address indexed newKeeper);

    /// @notice Full state for a pool. Reverts if the pool is not registered.
    function marketState(PoolId poolId) external view returns (MarketState memory);

    /// @notice Whether a pool has been registered. Spec §8.
    function isRegistered(PoolId poolId) external view returns (bool);

    /// @notice The address permitted to write the three keeper fields. Spec §25.
    function keeper() external view returns (address);

    /// @notice The address permitted to register pools, pause, and transfer the
    ///         role. Distinct from `keeper` (spec §25).
    function operator() external view returns (address);

    /// @notice Global fail-safe. When true every market halts. Spec §24.
    function globalPaused() external view returns (bool);
}
