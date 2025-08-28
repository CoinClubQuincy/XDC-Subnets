// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DDT} from "../contracts/Assets.sol";

contract DDT_Test {
    // some throwaway addresses to receive tokens
    address alice = address(uint160(uint256(keccak256("alice"))));
    address bob   = address(uint160(uint256(keccak256("bob"))));

    function test_InitialMintMath_And_Metadata() public {
        // deploy; owner will be *this test contract*
        DDT d = new DDT("Data Derivative Credit", "DDT", 1_000_000, "ipfs://ddt-meta");

        // decimals from OZ ERC20 defaults to 18
        require(d.decimals() == 18, "decimals should be 18");

        // total supply should be supply * 10**decimals, minted to deployer (this contract)
        uint256 expected = 1_000_000 * 10**18;
        require(d.totalSupply() == expected, "bad initial supply");
        require(d.balanceOf(address(this)) == expected, "deployer balance mismatch");

        // URI persisted
        require(keccak256(bytes(d.uri())) == keccak256(bytes("ipfs://ddt-meta")), "uri mismatch");
    }

    function test_NoFee_ByDefault_TransfersAll() public {
        DDT d = new DDT("DDT", "DDT", 1000, "uri");
        uint256 start = d.balanceOf(address(this));

        // no fee yet
        d.transfer(alice, 100 ether);

        require(d.balanceOf(alice) == 100 ether, "alice should get 100");
        require(d.balanceOf(address(this)) == start - 100 ether, "sender should lose 100");
    }

    function test_OwnerOnly_setFee_and_FeeAccounting() public {
        DDT d = new DDT("DDT", "DDT", 1000, "uri");

        // set fee: 100 bps = 1%, feeCollector -> bob
        d.setFee(100, bob);

        // send 100 tokens to alice; 1% fee -> 1 token to bob, 99 to alice
        d.transfer(alice, 100 ether);

        require(d.balanceOf(alice) == 99 ether, "alice should get 99 after 1% fee");
        require(d.balanceOf(bob)   == 1 ether,  "bob should get 1 as fee");
    }

    function test_setFee_Reverts_TooHigh() public {
        DDT d = new DDT("DDT", "DDT", 1000, "uri");
        // >1000 bps should revert
        bool reverted;
        try d.setFee(1001, address(1)) {
            // should not get here
        } catch {
            reverted = true;
        }
        require(reverted, "setFee should revert when fee > 10%");
    }

    function test_setFee_Reverts_ZeroCollector() public {
        DDT d = new DDT("DDT", "DDT", 1000, "uri");
        bool reverted;
        try d.setFee(100, address(0)) {
        } catch {
            reverted = true;
        }
        require(reverted, "setFee should revert when collector=0");
    }
}