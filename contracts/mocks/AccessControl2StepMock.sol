// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "../access/AccessControl2Step.sol";

contract AccessControl2StepMock is AccessControl2Step {
    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    function setRoleAdmin(bytes32 roleId, bytes32 adminRoleId) public {
        _setRoleAdmin(roleId, adminRoleId);
    }

    function senderProtected(bytes32 roleId) public onlyRole(roleId) {}
}
