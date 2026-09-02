// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "solmate/tokens/ERC20.sol";

/// @title OutcomeToken
/// @notice One side of a binary prediction market — YES or NO. Minted only
///         against USDC collateral held by the owning market, burned on
///         merge and redeem.
/// @dev B1-001. Decimals are fixed to the collateral's decimals (6 for
///      USDC on Base) so that one token is exactly one unit of collateral
///      and `split`/`merge`/`redeem` need no scaling anywhere.
///      See B1-006 and `docs/specs/market-lifecycle.md`.
contract OutcomeToken is ERC20 {
    /// @notice The market that may mint and burn this token.
    address public immutable market;

    error OnlyMarket();

    modifier onlyMarket() {
        if (msg.sender != market) revert OnlyMarket();
        _;
    }

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address market_)
        ERC20(name_, symbol_, decimals_)
    {
        market = market_;
    }

    function mint(address to, uint256 amount) external onlyMarket {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyMarket {
        _burn(from, amount);
    }
}
