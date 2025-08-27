// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FeeERC20
 * @notice ERC20 base with optional transfer fee (in basis points) sent to a fee collector.
 *         Designed to be fully analogous across tokens and compatible with Uniswap v2 Router.
 */
abstract contract NRC20 is ERC20, Ownable {
    /// @notice fee in basis points (100 bps = 1%)
    uint16 public feeBps;

    /// @notice address that receives accrued fees
    address public feeCollector;

    event FeeParamsUpdated(uint16 feeBps, address feeCollector);

    constructor(string memory name_, string memory symbol_, address initialOwner)
        ERC20(name_, symbol_)
        Ownable(initialOwner)
    {}

    /**
     * @dev OpenZeppelin ERC20 (v5) transfer hook.
     * Applies fee on regular transfers (not on mint/burn) when feeBps > 0.
     */
    function _update(address from, address to, uint256 value) internal virtual override {
        // No fee on mints or burns, or if fee is disabled, or if value==0
        if (feeBps == 0 || value == 0 || from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * feeBps) / 10_000; // basis points
        uint256 sendAmount = value - fee;

        if (fee > 0) {
            super._update(from, feeCollector, fee);
        }
        super._update(from, to, sendAmount);
    }

    /**
     * @notice Owner can configure the fee basis points and collector address.
     * @param _feeBps Fee in basis points (max 1000 = 10%).
     * @param _collector Address to receive fees.
     */
    function setFee(uint16 _feeBps, address _collector) external onlyOwner {
        require(_feeBps <= 1000, "fee too high"); // cap at 10%
        require(_collector != address(0), "collector=0");
        feeBps = _feeBps;
        feeCollector = _collector;
        emit FeeParamsUpdated(_feeBps, _collector);
    }
}

/**
 * @title Data Derivative Credit
 * @dev ERC20 with optional fee, URI metadata, and correct initial mint math.
 */
contract DDT is NRC20 {
    string public uri;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _supply,
        string memory _uri
    ) NRC20(_name, _symbol, msg.sender) {
        uri = _uri;
        _mint(msg.sender, _supply * (10 ** uint256(decimals())));
    }
}

/**
 * @title Insight Derivative Credit 
 * @dev ERC20 with optional fee, URI metadata, and correct initial mint math.
 */
contract IDC is NRC20 {
    string public uri;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _supply,
        string memory _uri
    ) NRC20(_name, _symbol, msg.sender) {
        uri = _uri;
        _mint(msg.sender, _supply * (10 ** uint256(decimals())));
    }
}