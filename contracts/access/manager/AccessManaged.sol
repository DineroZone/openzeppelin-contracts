// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {IAuthority} from "./IAuthority.sol";
import {IManaged} from "./IManaged.sol";
import {Context} from "../../utils/Context.sol";

/**
 * @dev This contract module makes available a {restricted} modifier. Functions decorated with this modifier will be
 * permissioned according to an "authority": a contract like {AccessManager} that follows the {IAuthority} interface,
 * implementing a policy that allows certain callers to access certain functions.
 *
 * IMPORTANT: The `restricted` modifier should never be used on `internal` functions, judiciously used in `public`
 * functions, and ideally only used in `external` functions. See {restricted}.
 */
abstract contract AccessManaged is Context, IManaged {
    address private _authority;

    /**
     * @dev Initializes the contract connected to an initial authority.
     */
    constructor(address initialAuthority) {
        _setAuthority(initialAuthority);
    }

    /**
     * @dev Restricts access to a function as defined by the connected Authority for this contract and the
     * caller and selector of the function that entered the contract.
     *
     * [IMPORTANT]
     * ====
     * In general, this modifier should only be used on `external` functions. It is okay to use it on `public` functions
     * that are used as external entry points and are not called internally. Unless you know what you're doing, it
     * should never be used on `internal` functions. Failure to follow these rules can have critical security
     * implications! This is because the permissions are determined by the function that entered the contract, i.e. the
     * function at the bottom of the call stack, and not the function where the modifier is visible in the source code.
     * ====
     *
     * [NOTE]
     * ====
     * Selector collisions are mitigated by scoping permissions per contract, but some edge cases must be considered:
     *
     * * If the https://docs.soliditylang.org/en/latest/contracts.html#receive-ether-function[`receive()`] function is restricted,
     * any other function with a `0x00000000` selector will share permissions with `receive()`.
     * * Similarly, if there's no `receive()` function but a `fallback()` instead, the fallback might be called with empty `calldata`,
     * sharing the `0x00000000` selector permissions as well.
     * * For any other selector, if the restricted function is set on an upgradeable contract, an upgrade may remove the restricted
     * function and replace it with a new method whose selector replaces the last one, keeping the previous permissions.
     * ====
     */
    modifier restricted() {
        _checkCanCall(_msgSender(), address(this), msg.sig);
        _;
    }

    /**
     * @dev Returns the current authority.
     */
    function authority() public view virtual returns (address) {
        return _authority;
    }

    /**
     * @dev Transfers control to a new authority. The caller must be the current authority.
     */
    function updateAuthority(address newAuthority) public virtual {
        address caller = _msgSender();
        if (caller != authority()) {
            revert AccessManagedUnauthorized(caller);
        }
        if (newAuthority.code.length == 0) {
            revert AccessManagedInvalidAuthority(newAuthority);
        }
        _setAuthority(newAuthority);
    }

    /**
     * @dev Transfers control to a new authority. Internal function with no access restriction.
     */
    function _setAuthority(address newAuthority) internal virtual {
        _authority = newAuthority;
        emit AuthorityUpdated(newAuthority);
    }

    /**
     * @dev Reverts if the caller is not allowed to call the function identified by a selector.
     */
    function _checkCanCall(address caller, address target, bytes4 selector) internal view virtual {
        if (!IAuthority(authority()).canCall(caller, target, selector)) {
            revert AccessManagedUnauthorized(caller);
        }
    }
}
