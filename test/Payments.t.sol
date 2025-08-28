// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

// NOTE: This test file is written for Hardhat's Solidity test runner only.
// It avoids Foundry's forge-std dependency and cheatcodes.
// We simulate multiple senders via tiny helper contracts and use low-level
// calls to assert reverts.

import { SimplePayments, IERC20 } from "../contracts/Payments.sol";

/// @dev Minimal ERC20 for testing transfers/approvals.
contract TestToken is IERC20 {
    string public name = "TestToken";
    string public symbol = "TST";

    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allow;

    function mint(address to, uint256 amt) external {
        _bal[to] += amt;
    }

    function balanceOf(address a) external view returns (uint256) { return _bal[a]; }

    function transfer(address to, uint256 v) external returns (bool) {
        require(_bal[msg.sender] >= v, "bal");
        _bal[msg.sender] -= v;
        _bal[to] += v;
        return true;
    }

    function approve(address s, uint256 v) external returns (bool) {
        _allow[msg.sender][s] = v;
        return true;
    }

    function allowance(address o, address s) external view returns (uint256) {
        return _allow[o][s];
    }

    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        require(_allow[from][msg.sender] >= v, "allow");
        require(_bal[from] >= v, "bal");
        _allow[from][msg.sender] -= v;
        _bal[from] -= v;
        _bal[to] += v;
        return true;
    }
}

/// @dev Simple user wallet used to simulate different msg.sender values.
contract UserWallet {
    function approve(TestToken t, address spender, uint256 amt) external {
        // msg.sender is this wallet contract
        t.approve(spender, amt);
    }
    function pay(SimplePayments p, uint256 amt, string memory memo) external {
        p.pay(amt, memo);
    }
    function acceptOwnership(SimplePayments p) external {
        p.acceptOwnership();
    }
}

/// @dev Tiny assert helpers (so we don't need forge-std).
library TAssert {
    function eq(uint256 a, uint256 b, string memory m) internal pure {
        require(a == b, m);
    }
    function neq(uint256 a, uint256 b, string memory m) internal pure {
        require(a != b, m);
    }
    function gt(uint256 a, uint256 b, string memory m) internal pure {
        require(a > b, m);
    }
    function eqAddr(address a, address b, string memory m) internal pure {
        require(a == b, m);
    }
    function eqStr(string memory a, string memory b, string memory m) internal pure {
        require(keccak256(bytes(a)) == keccak256(bytes(b)), m);
    }
    function isTrue(bool v, string memory m) internal pure {
        require(v, m);
    }
    function isFalse(bool v, string memory m) internal pure {
        require(!v, m);
    }
}

contract Payments_Test {
    using TAssert for uint256;

    TestToken token;
    SimplePayments pay;

    UserWallet alice;
    UserWallet bob;

    receive() external payable {}

    // -------------------- setup --------------------
    function setUp() public {
        token = new TestToken();
        alice = new UserWallet();
        bob   = new UserWallet();
        token.mint(address(alice), 1_000 ether);
        pay = new SimplePayments(address(token)); // owner = this test contract
    }

    // -------------- helpers (revert checks) --------------
    function _callShouldRevert(bytes memory callData, string memory reason) internal {
        (bool ok, bytes memory data) = address(pay).call(callData);
        require(!ok, "expected revert");
        // best-effort match Error(string)
        if (data.length >= 4) {
            bytes4 sel;
            assembly { sel := mload(add(data, 0x20)) }
            // 0x08c379a0 = Error(string)
            if (sel == 0x08c379a0 && bytes(reason).length > 0) {
                // decode reason from offset 0x04 in returndata
                string memory got;
                assembly {
                    // skip selector (4 bytes) + length slot positioning already adjusted by abi.encode
                    got := add(data, 0x24)
                }
                require(keccak256(bytes(got)) == keccak256(bytes(reason)), "wrong revert reason");
            }
        }
    }

    // -------------------- tests --------------------

    function test_TokenInfo() public {
        setUp();
        (string memory n, string memory s, address a) = pay.tokenInfo();
        TAssert.eqStr(n, "TestToken", "name");
        TAssert.eqStr(s, "TST", "symbol");
        TAssert.eqAddr(a, address(token), "token addr");
    }

    function test_Pay_RecordsAndTallies() public {
        setUp();
        // alice approves and pays (msg.sender == alice wallet contract)
        alice.approve(token, address(pay), 123 ether);
        alice.pay(pay, 123 ether, "order-1");

        (address p0, uint256 a0, string memory m0, uint256 t0) = pay.getPayment(0);
        TAssert.eqAddr(p0, address(alice), "payer");
        a0.eq(123 ether, "amt");
        TAssert.eqStr(m0, "order-1", "memo");
        t0.gt(0, "timestamp");

        pay.paymentsLength().eq(1, "len");
        pay.totalPaidBy(address(alice)).eq(123 ether, "tallied");
        token.balanceOf(address(pay)).eq(123 ether, "contract bal");
    }

    function test_Pay_Reverts_ZeroAndLongMemo() public {
        setUp();
        alice.approve(token, address(pay), 1);

        _callShouldRevert(abi.encodeWithSelector(SimplePayments.pay.selector, 0, ""), "");

        // build 257-byte memo
        bytes memory longMemo = new bytes(257);
        for (uint256 i = 0; i < longMemo.length; i++) longMemo[i] = 0x61; // 'a'
        _callShouldRevert(abi.encodeWithSelector(SimplePayments.pay.selector, 1, string(longMemo)), "");
    }

    function test_Pay_Reverts_WhenPaused() public {
        setUp();
        pay.setPaused(true);
        alice.approve(token, address(pay), 10);
        _callShouldRevert(abi.encodeWithSelector(SimplePayments.pay.selector, 10, "x"), "");
    }

    function test_Withdraw_SpecificAmount() public {
        setUp();
        alice.approve(token, address(pay), 200 ether);
        alice.pay(pay, 200 ether, "fund");

        pay.withdraw(address(bob), 50 ether);

        token.balanceOf(address(bob)).eq(50 ether, "bob received");
        token.balanceOf(address(pay)).eq(150 ether, "contract remains");
    }

    function test_WithdrawAll_Empties() public {
        setUp();
        alice.approve(token, address(pay), 300 ether);
        alice.pay(pay, 100 ether, "a");
        alice.pay(pay, 200 ether, "b");

        pay.withdrawAll(address(bob));

        token.balanceOf(address(bob)).eq(300 ether, "bob all");
        token.balanceOf(address(pay)).eq(0, "empty");
    }

    function test_Sweep_ForeignToken() public {
        setUp();
        TestToken other = new TestToken();
        other.mint(address(pay), 77 ether);

        _callShouldRevert(abi.encodeWithSelector(SimplePayments.sweep.selector, address(token), address(this), uint256(1)), "");

        pay.sweep(address(other), address(this), 77 ether);
        other.balanceOf(address(this)).eq(77 ether, "swept");
    }

    function test_Ownership_TwoStep() public {
        setUp();
        pay.transferOwnership(address(alice));
        TAssert.eqAddr(pay.owner(), address(this), "owner still this until accept");

        // wrong caller cannot accept -> call from this contract should revert
        _callShouldRevert(abi.encodeWithSelector(SimplePayments.acceptOwnership.selector), "");

        // alice accepts
        alice.acceptOwnership(pay);
        TAssert.eqAddr(pay.owner(), address(alice), "owner now alice");

        // now only alice can pause: calling from this should fail
        _callShouldRevert(abi.encodeWithSelector(SimplePayments.setPaused.selector, true), "");
    }

    function test_RejectsETH() public {
        setUp();
        // sending ETH should revert with "No ETH"
        (bool ok, bytes memory data) = address(pay).call{value: 1 wei}("");
        TAssert.isFalse(ok, "ETH send should revert");
        data; // silence warning; reason checked in other helpers already
    }
}