// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v4.9.0) (token/ERC20/extensions/ERC20Pausable.sol)

pragma solidity ^0.8.19;

import "../ERC20.sol";
import "../../../security/Pausable.sol";

/**
 * @dev ERC20 token with pausable token transfers, minting and burning.
 *
 * Useful for scenarios such as preventing trades until the end of an evaluation
 * period, or having an emergency switch for freezing all token transfers in the
 * event of a large bug.
 *
 * IMPORTANT: This contract does not include public pause and unpause functions. In
 * addition to inheriting this contract, you must define both functions, invoking the
 * {Pausable-_pause} and {Pausable-_unpause} internal functions, with appropriate
 * access control, e.g. using {AccessControl} or {Ownable}. Not doing so will
 * make the contract unpausable.
 */
abstract contract ERC20Pausable is ERC20, Pausable {
    /**
     * @dev The token is paused.
     */
    error ERC20Paused();

    /**
     * @dev See {ERC20-_update}.
     *
     * Requirements:
     *
     * - the contract must not be paused.
     */
    function _update(address from, address to, uint256 amount) internal virtual override {
        if (paused()) {
            revert ERC20Paused();
        }
        super._update(from, to, amount);
    }
}
