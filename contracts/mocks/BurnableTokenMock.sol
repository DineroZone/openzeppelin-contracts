pragma solidity ^0.4.24;

import "../token/ERC20/BurnableToken.sol";


contract BurnableTokenMock is BurnableToken {

  constructor(address _initialAccount, uint256 _initialBalance) public {
    balances_[_initialAccount] = _initialBalance;
    totalSupply_ = _initialBalance;
  }

}
