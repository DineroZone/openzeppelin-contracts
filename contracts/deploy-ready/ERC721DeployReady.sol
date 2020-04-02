pragma solidity ^0.6.0;

import "../access/AccessControl.sol";
import "../GSN/Context.sol";
import "../token/ERC721/ERC721.sol";
import "../token/ERC721/ERC721Burnable.sol";
import "../token/ERC721/ERC721Pausable.sol";

contract ERC721DeployReady is Context, AccessControl, ERC721Burnable, ERC721Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    constructor(string memory name, string memory symbol) public ERC721(name, symbol) {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());

        _setupRole(MINTER_ROLE, _msgSender());
        _setupRole(PAUSER_ROLE, _msgSender());
    }

    function mint(address to, uint256 tokenId) public {
        require(hasRole(MINTER_ROLE, _msgSender()), "ERC721DeployReady: must have minter role to mint");
        _mint(to, tokenId);
    }

    function pause() public {
        require(hasRole(PAUSER_ROLE, _msgSender()), "ERC721DeployReady: must have pauser role to pause");
        _pause();
    }

    function unpause() public {
        require(hasRole(PAUSER_ROLE, _msgSender()), "ERC721DeployReady: must have pauser role to unpause");
        _unpause();
    }

    function _beforeTokenTransfer(address from, address to, uint256 tokenId) internal override(ERC721, ERC721Pausable) {
        super._beforeTokenTransfer(from, to, tokenId);
    }
}
