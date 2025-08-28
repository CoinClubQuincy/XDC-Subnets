// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IDC} from "../contracts/Assets.sol";

contract IDC_Test {
    address collector = address(uint160(uint256(keccak256("collector"))));
    address user      = address(uint160(uint256(keccak256("user"))));

    function test_MetadataAndSupply() public {
        IDC t = new IDC("Insight Derivative Credit", "IDC", 5_000, "ipfs://idc-meta");
        require(t.decimals() == 18, "decimals");
        require(t.totalSupply() == 5_000 * 10**18, "supply");
        require(keccak256(bytes(t.uri())) == keccak256(bytes("ipfs://idc-meta")), "uri");
    }

    function test_FeePath_Basic() public {
        IDC t = new IDC("IDC", "IDC", 100, "uri");
        t.setFee(250, collector); // 2.5%

        // transfer 40 -> user should receive 39, collector gets 1
        t.transfer(user, 40 ether);
        require(t.balanceOf(user) == 39 ether, "user should get 39");
        require(t.balanceOf(collector) == 1 ether, "collector fee 1");
    }
}