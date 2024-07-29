// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {IERC7579AccountConfig, IERC7579ModuleConfig} from "../../../interfaces/IERC7579Account.sol";
import {IERC7579Module, MODULE_TYPE_EXECUTOR} from "../../../interfaces/IERC7579Module.sol";
import {Account} from "../Account.sol";
import {ERC7579Account} from "../ERC7579Account.sol";
import {EnumerableSet} from "../../../utils/structs/EnumerableSet.sol";

abstract contract ERC7579AccountModuleExecutor is ERC7579Account {
    using EnumerableSet for *;

    EnumerableSet.AddressSet private _executors;

    /// @inheritdoc IERC7579AccountConfig
    function supportsModule(uint256 moduleTypeId) public view virtual override returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR || super.supportsModule(moduleTypeId);
    }

    /// @inheritdoc IERC7579ModuleConfig
    function isModuleInstalled(
        uint256 moduleTypeId,
        address module,
        bytes calldata additionalContext
    ) public view virtual override returns (bool) {
        return
            moduleTypeId == MODULE_TYPE_EXECUTOR
                ? _executors.contains(module)
                : super.isModuleInstalled(moduleTypeId, module, additionalContext);
    }

    /// @inheritdoc ERC7579Account
    function _installModule(uint256 moduleTypeId, address module, bytes calldata initData) internal virtual override {
        if (moduleTypeId == MODULE_TYPE_EXECUTOR) {
            if (!_executors.add(module)) revert ModuleAlreadyInstalled(moduleTypeId, module);
            IERC7579Module(module).onInstall(initData);
        } else {
            super._installModule(moduleTypeId, module, initData);
        }
    }

    /// @inheritdoc ERC7579Account
    function _uninstallModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata deInitData
    ) internal virtual override {
        if (moduleTypeId == MODULE_TYPE_EXECUTOR) {
            if (!_executors.remove(module)) revert ModuleNotInstalled(moduleTypeId, module);
            IERC7579Module(module).onUninstall(deInitData);
        } else {
            super._uninstallModule(moduleTypeId, module, deInitData);
        }
    }

    // TODO: enumerability?
}
