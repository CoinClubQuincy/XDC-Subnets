// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal ERC20 interface (no external deps)
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/// @title SimplePayments
/// @notice Accepts payments in a single ERC20 and lets the owner withdraw.
contract SimplePayments {
    address public owner;
    IERC20  public immutable token;

    // --- Pause switch ---
    bool public paused;

    // --- Two-step ownership transfer ---
    address public pendingOwner;

    // --- Reentrancy guard (minimal, no deps) ---
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        require(_status != _ENTERED, "Reentrancy");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
    }

    // --- Safe ERC20 helpers (support tokens that return no bool) ---
    function _safeTransfer(address to, uint256 amount) internal {
        (bool success, bytes memory data) =
            address(token).call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) =
            address(token).call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transferFrom failed");
    }

    struct Payment {
        address payer;
        uint256 amount;
        string memo;
        uint40 timestamp;
    }

    Payment[] private _payments;
    mapping(address => uint256) public totalPaidBy;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PaymentReceived(address indexed payer, uint256 amount, string memo);
    event Withdraw(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address tokenAddress) {
        require(tokenAddress != address(0), "Token=0");
        owner = msg.sender;
        token = IERC20(tokenAddress);
        _status = _NOT_ENTERED;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Transfer contract ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner=0");
        pendingOwner = newOwner;
    }

    /// @notice Pending owner must call this to accept control.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pendingOwner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /// @notice Payer must approve this contract for `amount` first.
    /// @param amount Amount of tokens to pay.
    /// @param memo Free-form memo (order id, invoice, memo).
    function pay(uint256 amount, string calldata memo) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount=0");
        require(bytes(memo).length <= 256, "memo too long");

        uint256 beforeBal = token.balanceOf(address(this));
        _safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - beforeBal;
        require(received > 0, "No tokens received");

        _payments.push(Payment({
            payer: msg.sender,
            amount: received,
            memo: memo,
            timestamp: uint40(block.timestamp)
        }));

        // checked addition (remove the unchecked block)
        totalPaidBy[msg.sender] = totalPaidBy[msg.sender] + received;

        emit PaymentReceived(msg.sender, received, memo);
    }

    /// @notice Owner withdraws specific amount to an address.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        require(amount > 0, "Amount=0");
        _safeTransfer(to, amount);
        emit Withdraw(to, amount);
    }

    /// @notice Owner withdraws full token balance (“liquidate”).
    function withdrawAll(address to) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        uint256 bal = token.balanceOf(address(this));
        _safeTransfer(to, bal);
        emit Withdraw(to, bal);
    }

    /// @notice Convenience view for current token balance.
    function balance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Number of payments recorded in the on-chain ledger.
    function paymentsLength() external view returns (uint256) {
        return _payments.length;
    }

    /// @notice Get a single payment by index.
    function getPayment(uint256 index)
        external
        view
        returns (address payer, uint256 amount, string memory memo, uint256 timestamp)
    {
        Payment storage p = _payments[index];
        return (p.payer, p.amount, p.memo, uint256(p.timestamp));
    }

    /// @notice Get a slice of payments for simple pagination (best-effort; do not use with huge ranges).
    /// @param start The starting index (inclusive).
    /// @param count The max number of items to return.
    function getPayments(uint256 start, uint256 count) external view returns (Payment[] memory out) {
        uint256 len = _payments.length;
        if (start >= len) return new Payment[](0);
        uint256 end = start + count;
        if (end > len) end = len;
        uint256 n = end - start;
        out = new Payment[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = _payments[start + i];
        }
    }

    /// @notice Get metadata about the accepted ERC20 token.
    function tokenInfo() external view returns (string memory tokenName, string memory tokenSymbol, address tokenAddress) {
        tokenAddress = address(token);
        try token.name() returns (string memory n) { tokenName = n; } catch {}
        try token.symbol() returns (string memory s) { tokenSymbol = s; } catch {}
    }

    /// @notice Rescue foreign ERC20s accidentally sent to this contract (not the accepted token).
    function sweep(address erc20, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        require(erc20 != address(token), "use withdraw");
        (bool ok, bytes memory data) = erc20.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "sweep failed");
    }

    /// @notice Reject accidental ETH transfers.
    receive() external payable { revert("No ETH"); }
    fallback() external payable { revert("No ETH"); }
}