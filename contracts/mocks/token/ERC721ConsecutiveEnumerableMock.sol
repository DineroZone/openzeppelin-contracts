// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {ERC721} from "../../token/ERC721/ERC721.sol";
import {ERC721Consecutive} from "../../token/ERC721/extensions/ERC721Consecutive.sol";
import {ERC721Enumerable} from "../../token/ERC721/extensions/ERC721Enumerable.sol";

contract ERC721ConsecutiveEnumerableMock is ERC721Consecutive, ERC721Enumerable {
    constructor(
        string memory name,
        string memory symbol,
        address[] memory receivers,
        uint96[] memory amounts
    ) ERC721(name, symbol) {
        for (uint256 i = 0; i < receivers.length; ++i) {
            _mintConsecutive(receivers[i], amounts[i]);
        }
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _ownerOf(uint256 tokenId) internal view virtual override(ERC721, ERC721Consecutive) returns (address) {
        return super._ownerOf(tokenId);
    }

    function _update(
        address to,
        uint256 tokenId,
        bytes32 optionalChecks
    ) internal virtual override(ERC721Consecutive, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, optionalChecks);
    }

    // solhint-disable-next-line func-name-mixedcase
    function __unsafe_increaseBalance(
        address account,
        uint256 amount
    ) internal virtual override(ERC721, ERC721Enumerable) {
        super.__unsafe_increaseBalance(account, amount);
    }
}
