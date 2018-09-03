pragma solidity ^0.4.24;

import "./ConditionalTokenEscrow.sol";
import "../token/ERC20/ERC20.sol";


/**
 * @title RefundTokenEscrow
 * @dev Escrow that holds tokens for a beneficiary, deposited from multiple parties.
 * The contract owner may close the deposit period, and allow for either withdrawal
 * by the beneficiary, or refunds to the depositors.
 */
contract RefundTokenEscrow is ConditionalTokenEscrow {
  enum State { Active, Refunding, Closed }

  event Closed();
  event RefundsEnabled();

  State public state;
  address public beneficiary;

  /**
   * @dev Constructor.
   * @param _token Address of the ERC20 token that will be put in escrow.
   * @param _beneficiary The beneficiary of the deposits.
   */
  constructor(ERC20 _token, address _beneficiary) public TokenEscrow(_token) {
    require(_beneficiary != address(0));
    beneficiary = _beneficiary;
    state = State.Active;
  }

  /**
   * @dev Stores tokens that may later be refunded.
   * @param _refundee The address tokens will be sent to if a refund occurs.
   * @param _amount The amount of tokens to store.
   */
  function deposit(address _refundee, uint256 _amount) public {
    require(state == State.Active);
    super.deposit(_refundee, _amount);
  }

  /**
   * @dev Allows for the beneficiary to withdraw their tokens, rejecting
   * further deposits.
   */
  function close() public onlyOwner {
    require(state == State.Active);
    state = State.Closed;
    emit Closed();
  }

  /**
   * @dev Allows for refunds to take place, rejecting further deposits.
   */
  function enableRefunds() public onlyOwner {
    require(state == State.Active);
    state = State.Refunding;
    emit RefundsEnabled();
  }

  /**
   * @dev Withdraws the beneficiary's tokens.
   */
  function beneficiaryWithdraw() public {
    require(state == State.Closed);
    uint256 amount = token.balanceOf(address(this));
    token.safeTransfer(beneficiary, amount);
  }

  /**
   * @dev Returns whether refundees can withdraw their deposits (be refunded).
   */
  function withdrawalAllowed(address _payee) public view returns (bool) {
    return state == State.Refunding;
  }
}
