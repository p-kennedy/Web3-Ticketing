// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// =============================================================================
// IERC20 Interface
// Defined inline — no external imports — to demonstrate direct implementation
// of the ERC-20 standard.
// =============================================================================

interface IERC20 {
    /// @notice Returns the total token supply
    function totalSupply() external view returns (uint256);

    /// @notice Returns the token balance of a given account
    /// @param account The address to query
    function balanceOf(address account) external view returns (uint256);

    /// @notice Transfers tokens from the caller to a recipient
    /// @param recipient The address receiving the tokens
    /// @param amount The number of tokens to transfer
    /// @return success True if the transfer succeeded
    function transfer(address recipient, uint256 amount) external returns (bool);

    /// @notice Returns the remaining allowance a spender has on behalf of an owner
    /// @param owner The address that owns the tokens
    /// @param spender The address permitted to spend them
    function allowance(address owner, address spender) external view returns (uint256);

    /// @notice Approves a spender to transfer up to a given amount on the caller's behalf
    /// @param spender The address being approved
    /// @param amount The maximum amount the spender may transfer
    /// @return success True if approval succeeded
    function approve(address spender, uint256 amount) external returns (bool);

    /// @notice Transfers tokens on behalf of an owner, consuming their allowance
    /// @param sender The address tokens are drawn from
    /// @param recipient The address receiving the tokens
    /// @param amount The number of tokens to transfer
    /// @return success True if the transfer succeeded
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

// =============================================================================
// TicketToken Contract
// An ERC-20 token representing event tickets. The entire supply is held by the
// contract itself at deployment. Tickets can be purchased with ETH via
// buyToken(), and the contract owner can withdraw accumulated ETH at any time.
// =============================================================================

contract TicketToken is IERC20 {

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @dev The address that deployed the contract; has exclusive withdraw rights
    address private immutable _owner;

    string public name;
    string public symbol;

    /// @dev Intentionally 0 — tickets are whole units; fractions are meaningless
    uint8 public constant decimals = 0;

    uint256 private _totalSupply;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    /// @dev Price in wei per ticket (0.00001 ETH)
    uint256 public constant TICKET_PRICE = 0.00001 ether;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a ticket is purchased via buyToken()
    /// @param buyer The purchasing address
    /// @param quantity Number of tickets purchased
    /// @param ethPaid Total ETH paid in wei
    event TicketPurchased(address indexed buyer, uint256 quantity, uint256 ethPaid);

    /// @notice Emitted when the owner withdraws ETH from the contract
    /// @param owner The owner address
    /// @param amount ETH amount withdrawn in wei
    event Withdrawn(address indexed owner, uint256 amount);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    /// @dev Restricts a function to the contract deployer only
    modifier onlyOwner() {
        require(msg.sender == _owner, "TicketToken: caller is not the owner");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @notice Deploys the TicketToken contract
    /// @dev The entire initial supply is allocated to the contract's own address
    ///      so that buyToken() can transfer tickets directly from contract stock.
    ///      The deployer holds no tokens but owns the contract for admin purposes.
    /// @param _name Human-readable token name (e.g. "Concert Ticket")
    /// @param _symbol Token ticker symbol (e.g. "TKT")
    /// @param initialSupply Total number of tickets to mint (whole units, decimals = 0)
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 initialSupply
    ) {
        require(initialSupply > 0, "TicketToken: supply must be greater than zero");

        _owner    = msg.sender;
        name      = _name;
        symbol    = _symbol;

        _totalSupply              = initialSupply;
        _balances[address(this)]  = initialSupply;   // supply held by contract, not deployer

        emit Transfer(address(0), address(this), initialSupply);
    }

    // -------------------------------------------------------------------------
    // IERC20 — View Functions
    // -------------------------------------------------------------------------

    /// @inheritdoc IERC20
    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    /// @inheritdoc IERC20
    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    /// @inheritdoc IERC20
    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    // -------------------------------------------------------------------------
    // IERC20 — State-Changing Functions
    // -------------------------------------------------------------------------

    /// @inheritdoc IERC20
    function transfer(address recipient, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    /// @inheritdoc IERC20
    function approve(address spender, uint256 amount) external override returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    /// @inheritdoc IERC20
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external override returns (bool) {
        uint256 currentAllowance = _allowances[sender][msg.sender];
        require(currentAllowance >= amount, "TicketToken: transfer amount exceeds allowance");

        // Checks-Effects-Interactions: reduce allowance before transferring
        _approve(sender, msg.sender, currentAllowance - amount);
        _transfer(sender, recipient, amount);
        return true;
    }

    // -------------------------------------------------------------------------
    // Core Purchase Function
    // -------------------------------------------------------------------------

    /// @notice Purchase one or more tickets by sending ETH to this function.
    /// @dev Implements checks-effects-interactions:
    ///      1. CHECKS  — validates ETH sent is sufficient for at least one ticket
    ///                   and that the contract holds enough stock to fulfil the order.
    ///      2. EFFECTS — updates balances before any value movement.
    ///      3. INTERACTIONS — refunds any excess ETH to the caller last.
    ///      ETH accumulates in the contract until the owner calls withdraw().
    /// @return quantity The number of tickets issued to the caller
    function buyToken() external payable returns (uint256 quantity) {
        // --- CHECKS ---
        require(msg.value >= TICKET_PRICE, "TicketToken: insufficient ETH; price is 0.00001 ETH per ticket");

        quantity = msg.value / TICKET_PRICE;
        require(quantity > 0, "TicketToken: calculated quantity is zero");
        require(_balances[address(this)] >= quantity, "TicketToken: not enough tickets remaining in contract");

        // --- EFFECTS ---
        // Update balances before any ETH is moved (guards against reentrancy)
        _balances[address(this)] -= quantity;
        _balances[msg.sender]    += quantity;
        emit Transfer(address(this), msg.sender, quantity);
        emit TicketPurchased(msg.sender, quantity, msg.value);

        // --- INTERACTIONS ---
        // Refund any ETH sent above the exact cost of whole tickets
        uint256 totalCost = quantity * TICKET_PRICE;
        uint256 excess    = msg.value - totalCost;
        if (excess > 0) {
            (bool refunded, ) = msg.sender.call{value: excess}("");
            require(refunded, "TicketToken: ETH refund failed");
        }

        return quantity;
    }

    // -------------------------------------------------------------------------
    // Admin Functions
    // -------------------------------------------------------------------------

    /// @notice Withdraws all accumulated ETH from ticket sales to the owner's wallet.
    /// @dev Only callable by the original deployer. Uses call() over transfer() to
    ///      avoid gas limit issues, with a require on success.
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "TicketToken: no ETH available to withdraw");

        // Effects before interaction
        emit Withdrawn(_owner, balance);

        (bool sent, ) = _owner.call{value: balance}("");
        require(sent, "TicketToken: ETH withdrawal failed");
    }

    /// @notice Returns the address of the contract owner
    function owner() external view returns (address) {
        return _owner;
    }

    /// @notice Returns the number of tickets still available for purchase
    function remainingSupply() external view returns (uint256) {
        return _balances[address(this)];
    }

    // -------------------------------------------------------------------------
    // Internal Helpers
    // -------------------------------------------------------------------------

    /// @dev Core transfer logic shared by transfer(), transferFrom(), and buyToken()
    function _transfer(address sender, address recipient, uint256 amount) internal {
        require(sender    != address(0), "TicketToken: transfer from the zero address");
        require(recipient != address(0), "TicketToken: transfer to the zero address");
        require(_balances[sender] >= amount, "TicketToken: transfer amount exceeds balance");

        _balances[sender]    -= amount;
        _balances[recipient] += amount;
        emit Transfer(sender, recipient, amount);
    }

    /// @dev Core approval logic shared by approve() and transferFrom()
    function _approve(address tokenOwner, address spender, uint256 amount) internal {
        require(tokenOwner != address(0), "TicketToken: approve from the zero address");
        require(spender    != address(0), "TicketToken: approve to the zero address");

        _allowances[tokenOwner][spender] = amount;
        emit Approval(tokenOwner, spender, amount);
    }
}
