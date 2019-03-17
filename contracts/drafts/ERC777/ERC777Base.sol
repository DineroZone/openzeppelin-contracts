pragma solidity ^0.4.24;

import "./IERC777.sol";
import "./IERC777TokensRecipient.sol";
import "./IERC777TokensSender.sol";
import "../../math/SafeMath.sol";
import "../../utils/Address.sol";
import "../../introspection/ERC1820Client.sol";

/**
 * @title ERC777 token implementation to inherit from
 * @author etsvigun <utgarda@gmail.com>, Bertrand Masius <github@catageeks.tk>
 * @dev see https://github.com/ethereum/EIPs/blob/master/EIPS/eip-777.md
 * @dev inherit from this contract, do not use directly
 */
contract ERC777Base is IERC777, ERC1820Client {
    using SafeMath for uint256;
    using Address for address;

    string private _name;

    string private _symbol;

    mapping(address => uint256) private _balances;

    uint256 private _totalSupply;

    uint256 private _granularity;

    address[] private _defaultOpsArray;

    bytes32 constant sendHash = keccak256("ERC777TokensSender");
    bytes32 constant receivedHash = keccak256("ERC777TokensRecipient");

    mapping(address => bool) private _defaultOps;
    mapping(address => mapping(address => bool)) private _revokedDefaultOps;
    mapping(address => mapping(address => bool)) private _ops;

    constructor(
        string name,
        string symbol,
        uint256 granularity,
        address[] defaultOperators
    ) internal {
        require(granularity > 0);
        _name = name;
        _symbol = symbol;
        _granularity = granularity;
        _defaultOpsArray = defaultOperators;
        for (uint i = 0; i < defaultOperators.length; i++) {
            _defaultOps[defaultOperators[i]] = true;
        }
        // register interface
        setInterfaceImplementer(
            address(this),
            keccak256("ERC777Token"),
            address(this)
        );
    }

    /**
    * @dev Send the amount of tokens from the address msg.sender to the address to
    * @param to address recipient address
    * @param amount uint256 amount of tokens to transfer
    * @param data bytes information attached to the send, and intended for the recipient (to)
     */
    function send(
        address to,
        uint256 amount,
        bytes data
    ) external {
        _send(
            msg.sender,
            msg.sender,
            to,
            amount,
            data,
            ""
        );
    }

    /**
    * @dev Send the amount of tokens on behalf of the address from to the address to
    * @param from address token holder address. Set to 0x0 to use msg.sender as token holder
    * @param to address recipient address
    * @param amount uint256 amount of tokens to transfer
    * @param data bytes information attached to the send, and intended for the recipient (to)
    * @param operatorData bytes extra information provided by the operator (if any)
     */
    function operatorSend(
        address from,
        address to,
        uint256 amount,
        bytes data,
        bytes operatorData
    )
    external
    {
        address holder = from == address(0) ? msg.sender : from;
        _send(
            msg.sender,
            holder,
            to,
            amount,
            data,
            operatorData
        );
    }

    /**
    * @dev Burn the amount of tokens from the address msg.sender
    * @param amount uint256 amount of tokens to transfer
    * @param data bytes extra information provided by the token holder
     */
    function burn(uint256 amount, bytes data) external {
        _burn(
            msg.sender, 
            msg.sender,
            amount,
            data,
            ""
        );
    }

    /**
    * @dev Burn the amount of tokens on behalf of the address from
    * @param from address token holder address. Set to 0x0 to use msg.sender as token holder
    * @param amount uint256 amount of tokens to transfer
    * @param data bytes extra information provided by the token holder
    * @param operatorData bytes extra information provided by the operator (if any)
     */
    function operatorBurn(
        address from,
        uint256 amount,
        bytes data,
        bytes operatorData
    )
    external
    {
        address holder = from == address(0) ? msg.sender : from;
        _burn(
            msg.sender,
            holder,
            amount,
            data,
            operatorData
        );
    }

    /**
    * @return the name of the token.
    */
    function name() public view returns (string) {
        return _name;
    }

    /**
    * @return the symbol of the token.
    */
    function symbol() public view returns (string) {
        return _symbol;
    }

    /**
     * @dev Total number of tokens in existence
     */
    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    /**
    * @dev Gets the balance of the specified address.
    * @param tokenHolder The address to query the balance of.
        * @return uint256 representing the amount owned by the specified address.
     */
    function balanceOf(address tokenHolder) public view returns (uint256) {
        return _balances[tokenHolder];
    }

    /**
    * @dev Gets the token's granularity,
    * i.e. the smallest number of tokens (in the basic unit)
    * which may be minted, sent or burned at any time
    * @return uint256 granularity
     */
    function granularity() public view returns (uint256) {
        return _granularity;
    }

    /**
    * @dev Get the list of default operators as defined by the token contract.
    * @return address[] default operators
    */
    function defaultOperators() public view returns (address[]) {
        return _defaultOpsArray;
    }

    /**
    * @dev Authorize an operator for the sender
    * @param operator address to be authorized as operator
     */
    function authorizeOperator(address operator) public {
        require(msg.sender != operator);
        if (_defaultOps[operator]) {
            _reAuthorizeDefaultOperator(operator);
        } else _authorizeOperator(operator);
    }

    /**
     * @dev Revoke operator rights from one of the default operators
     * @param operator address to revoke operator rights from
     */
    function revokeOperator(address operator) public {
        require(operator != msg.sender);
        if (_defaultOps[operator]) {
            _revokeDefaultOperator(operator);
        } else _revokeOperator(operator);
    }

    /**
    * @dev Indicate whether an address
    * is an operator of the tokenHolder address
    * @param operator address which may be an operator of tokenHolder
    * @param tokenHolder address of a token holder which may have the operator
    * address as an operator.
     */
    function isOperatorFor(
        address operator,
        address tokenHolder
    ) public view returns (bool) {
        return
        operator == tokenHolder ||
            _defaultOps[operator] && !_revokedDefaultOps[tokenHolder][operator] ||
            _ops[tokenHolder][operator];
    }

    /**
     * @dev Burn tokens
     * @param operator address operator requesting the operation
     * @param from address token holder address
     * @param amount uint256 amount of tokens to burn
     * @param data bytes extra information provided by the token holder
     * @param operatorData bytes extra information provided by the operator (if any)
     */
    function _burn(
        address operator,
        address from,
        uint256 amount,
        bytes data,
        bytes operatorData
    )
    internal
    {
        require(from != address(0));
        require(isOperatorFor(msg.sender, from));

        _callTokensToSend(
            operator,
            from,
            address(0),
            amount,
            data,
            operatorData
        );

        // Update state variables
        _totalSupply = _totalSupply.sub(amount);
        _balances[from] = _balances[from].sub(amount);
        require((_balances[from] % _granularity) == 0);

        emit Burned(
            operator,
            from,
            amount,
            data,
            operatorData
        );
    }

    /**
     * @dev Mint tokens. Does not check authorization of operator
     * @dev the caller may ckeck that operator is authorized before calling
     * @param operator address operator requesting the operation
     * @param to address token recipient address
     * @param amount uint256 amount of tokens to mint
     * @param userData bytes extra information defined by the token recipient (if any)
     * @param operatorData bytes extra information provided by the operator (if any)
     */
    function _mint(
        address operator,
        address to,
        uint256 amount,
        bytes userData,
        bytes operatorData
    )
    internal
    {
        require(to != address(0));

        // revert if 'to' is a contract not implementing tokensReceived()
        require(
            _callTokensReceived(
                operator,
                address(0),
                to,
                amount,
                userData,
                operatorData
        )
        );

        // Update state variables
        _totalSupply = _totalSupply.add(amount);
        _balances[to] = _balances[to].add(amount);
        require((_balances[to] % _granularity) == 0);

        emit Minted(
            operator,
            to,
            amount,
            userData,
            operatorData
        );
    }

    /**
    * @dev Authorize an operator for the sender
    * @param operator address to be authorized as operator
     */
    function _authorizeOperator(address operator) private {
        _ops[msg.sender][operator] = true;
        emit AuthorizedOperator(operator, msg.sender);
    }

    /**
    * @dev Re-authorize a previously revoked default operator
    * @param operator address to be re-authorized as operator
     */
    function _reAuthorizeDefaultOperator(address operator) private {
        delete _revokedDefaultOps[msg.sender][operator];
        emit AuthorizedOperator(operator, msg.sender);
    }

    /**
    * @dev Revoke operator rights from one of the default operators
    * @param operator address to revoke operator rights from
    */
    function _revokeDefaultOperator(address operator) private {
        _revokedDefaultOps[msg.sender][operator] = true;
        emit RevokedOperator(operator, msg.sender);
    }

    /**
    * @dev Revoke an operator for the sender
    * @param operator address to revoke operator rights from
    */
    function _revokeOperator(address operator) private {
        delete _ops[msg.sender][operator];
        emit RevokedOperator(operator, msg.sender);
    }

    /**
     * @dev Send tokens
     * @param operator address operator requesting the transfer
     * @param from address token holder address
     * @param to address recipient address
     * @param amount uint256 amount of tokens to transfer
     * @param userData bytes extra information provided by the token holder (if any)
     * @param operatorData bytes extra information provided by the operator (if any)
     */
    function _send(
        address operator,
        address from,
        address to,
        uint256 amount,
        bytes userData,
        bytes operatorData
    )
    private
    {
        require(from != address(0));
        require(to != address(0));
        require(isOperatorFor(msg.sender, from));

        _callTokensToSend(
            operator,
            from,
            to,
            amount,
            userData,
            operatorData
        );

        // Update state variables
        _balances[from] = _balances[from].sub(amount);
        _balances[to] = _balances[to].add(amount);
        require((_balances[from] % _granularity) == 0);
        require((_balances[to] % _granularity) == 0);

        _callTokensReceived(
            operator,
            from,
            to,
            amount,
            userData,
            operatorData
        );

        emit Sent(
            msg.sender,
            from,
            to,
            amount,
            userData,
            operatorData
        );
    }

    /**
     * @dev Call from.tokensToSend() if the interface is registered
     * @param operator address operator requesting the transfer
     * @param from address token holder address
     * @param to address recipient address
     * @param amount uint256 amount of tokens to transfer
     * @param userData bytes extra information provided by the token holder (if any)
     * @param operatorData bytes extra information provided by the operator (if any)
     */
    function _callTokensToSend(
        address operator,
        address from,
        address to,
        uint256 amount,
        bytes userData,
        bytes operatorData
    )
    private
    {
        address implementer = getInterfaceImplementer(from, sendHash);
        if (implementer != address(0)) {
            IERC777TokensSender(implementer).tokensToSend(
                operator,
                from,
                to,
                amount,
                userData,
                operatorData
            );
        }
    }

    /**
    * @dev Call to.tokensReceived() if the interface is registered
    * @param operator address operator requesting the transfer
    * @param from address token holder address
    * @param to address recipient address
    * @param amount uint256 amount of tokens to transfer
    * @param userData bytes extra information provided by the token holder (if any)
        * @param operatorData bytes extra information provided by the operator (if any)
            * @return false if the recipient is a contract but tokensReceived() was not
                *         registered for the recipient
                    */
    function _callTokensReceived(
        address operator,
        address from,
        address to,
        uint256 amount,
        bytes userData,
        bytes operatorData
    )
    private
    returns(bool)
    {
        address implementer = getInterfaceImplementer(to, receivedHash);
        if (implementer == address(0)) {
            return(! to.isContract());
        }
        IERC777TokensRecipient(implementer).tokensReceived(
            operator,
            from,
            to,
            amount,
            userData,
            operatorData
        );
        return true;
    }
}
