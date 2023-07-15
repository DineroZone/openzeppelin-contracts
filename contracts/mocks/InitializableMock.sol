// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {Initializable} from "../proxy/utils/Initializable.sol";

/**
 * @title InitializableMock
 * @dev This contract is a mock to test initializable functionality
 */
contract InitializableMock is Initializable {
    bool public initializerRan;
    bool public onlyInitializingRan;
    uint256 public x;

    function isInitializing() public view returns (bool) {
        return _isInitializing();
    }

    function initialize() public initializer {
        initializerRan = true;
    }

    function initializeOnlyInitializing() public onlyInitializing {
        onlyInitializingRan = true;
    }

    function onlyInitializingNested() public initializer {
        initializeOnlyInitializing();
    }

    function initializeWithX(uint256 _x) public payable initializer {
        x = _x;
    }

    function nonInitializable(uint256 _x) public payable {
        x = _x;
    }

    function fail() public pure {
        require(false, "InitializableMock forced failure");
    }
}

contract ConstructorInitializableMock is Initializable {
    bool public initializerRan;
    bool public onlyInitializingRan;

    constructor() initializer {
        initialize();
        initializeOnlyInitializing();
    }

    function initialize() public initializer {
        initializerRan = true;
    }

    function initializeOnlyInitializing() public onlyInitializing {
        onlyInitializingRan = true;
    }
}

contract ReinitializerMock is Initializable {
    uint256 public counter;

    function getInitializedVersion() public view returns (uint64) {
        return _getInitializedVersion();
    }

    function initialize() public initializer {
        doStuff();
    }

    function reinitialize(uint64 i) public reinitializer(i) {
        doStuff();
    }

    function nestedReinitialize(uint64 i, uint64 j) public reinitializer(i) {
        reinitialize(j);
    }

    function chainReinitialize(uint64 i, uint64 j) public {
        reinitialize(i);
        reinitialize(j);
    }

    function disableInitializers() public {
        _disableInitializers();
    }

    function doStuff() public onlyInitializing {
        counter++;
    }
}

contract DisableOk is Initializable {
    constructor() {
        _disableInitializers();
    }
}

contract DisableBad is Initializable {
    constructor() initializer {
        _disableInitializers();
    }
}
