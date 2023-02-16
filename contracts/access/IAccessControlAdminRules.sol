// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.9.0 (access/IAccessControlAdminRules.sol)

pragma solidity ^0.8.0;

import "./IAccessControl.sol";

/**
 * @dev External interface of AccessControlAdminRules declared to support ERC165 detection.
 *
 * _Available since v4.9._
 */
interface IAccessControlAdminRules is IAccessControl {
    /**
     * @dev Emitted when an `DEFAULT_ADMIN_ROLE` transfer is started, setting `newDefaultAdmin`
     * as the next default admin to be claimed after `delayedUntil` is met.
     */
    event DefaultAdminRoleChangeStarted(address indexed newDefaultAdmin, uint48 delayedUntil);

    /**
     * @dev Returns the address of the current `DEFAULT_ADMIN_ROLE` holder.
     */
    function defaultAdmin() external view returns (address);

    /**
     * @dev Returns the timestamp in which the pending default admin can claim the
     * `DEFAULT_ADMIN_ROLE`.
     */
    function delayedUntil() external view returns (uint48);

    /**
     * @dev Returns the address of the pending `DEFAULT_ADMIN_ROLE` holder.
     */
    function pendingDefaultAdmin() external view returns (address);

    /**
     * @dev Starts a `DEFAULT_ADMIN_ROLE` transfer by setting a pending default admin
     * and a timer to be met.
     *
     * Requirements:
     *
     * - There shouldn't be another default admin transfer in progress. See {cancelDefaultAdminTransfer}.
     * - Only can be called by the current `DEFAULT_ADMIN_ROLE` holder.
     *
     * Emits a {DefaultAdminRoleChangeStarted}.
     */
    function beginDefaultAdminTransfer(address newAdmin) external;

    /**
     * @dev Completes a `DEFAULT_ADMIN_ROLE` transfer.
     *
     * Requirements:
     *
     * - Caller should be the pending default admin.
     * - `DEFAULT_ADMIN_ROLE` should be granted to the caller.
     * - `DEFAULT_ADMIN_ROLE` should be revoked from the previous holder.
     * - Should allow to call {beginDefaultAdminTransfer} again.
     */
    function acceptDefaultAdminTransfer() external;

    /**
     * @dev Cancels a `DEFAULT_ADMIN_ROLE` transfer.
     *
     * Requirements:
     *
     * - Should allow to call {beginDefaultAdminTransfer} again.
     * - Can be called even after the timer is met.
     * - Can only be called by the current `DEFAULT_ADMIN_ROLE` holder.
     */
    function cancelDefaultAdminTransfer() external;
}
