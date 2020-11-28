// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import '../cryptography/EIP712.sol';

contract EIP712External is EIP712 {
    constructor(string memory name, string memory version) EIP712(name, version) public {}

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function domainSeparator(bytes32 salt) external view returns (bytes32) {
        return _domainSeparator(salt);
    }
}
