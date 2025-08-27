import { expect } from "chai";
import { ethers } from "hardhat";

describe("SimplePayments (ERC20 receiver)", function () {
  const NAME = "Data Derivative Token";
  const SYMBOL = "DDT";
  const SUPPLY_WHOLE = "1000000";
  const URI = "ipfs://your-ddt-metadata";

  async function deployPair() {
    const [deployer, payer, recipient] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("DDT");
    const token = await Token.deploy(NAME, SYMBOL, SUPPLY_WHOLE, URI);
    await token.deployed?.();
    const decimals = await token.decimals();

    const Payments = await ethers.getContractFactory("SimplePayments");
    const payments = await Payments.deploy(token.address);
    await payments.deployed?.();

    return { deployer, payer, recipient, token, payments, decimals };
  }

  it("stores token address and exposes tokenInfo()", async () => {
    const { token, payments } = await deployPair();
    const info = await payments.tokenInfo(); // (name, symbol, tokenAddress)
    expect(info[0]).to.equal(NAME);
    expect(info[1]).to.equal(SYMBOL);
    expect(info[2]).to.equal(token.address);
  });

  it("accepts payments via pay() after approval and updates balances", async () => {
    const { payer, token, payments, decimals } = await deployPair();

    // Move some tokens to payer
    const seed = ethers.utils.parseUnits("5000", decimals);
    await token.transfer(payer.address, seed);
    expect(await token.balanceOf(payer.address)).to.eq(seed);

    // Approve & pay
    const payAmt = ethers.utils.parseUnits("1500", decimals);
    await token.connect(payer).approve(payments.address, payAmt);
    await expect(payments.connect(payer).pay(payAmt, "invoice-001"))
      .to.emit(token, "Transfer");

    // Contract holds the tokens
    expect(await token.balanceOf(payments.address)).to.eq(payAmt);

    // (Optional) If your contract has a balance() helper:
    if ((payments as any).functions["balance()"]) {
      const bal = await (payments as any).balance();
      expect(bal).to.eq(payAmt);
    }
  });

  it("withdrawAll() sends all held tokens to a recipient", async () => {
    const { deployer, payer, recipient, token, payments, decimals } = await deployPair();

    // Seed payer and pay
    const seed = ethers.utils.parseUnits("2000", decimals);
    await token.transfer(payer.address, seed);
    const amt = ethers.utils.parseUnits("777", decimals);
    await token.connect(payer).approve(payments.address, amt);
    await payments.connect(payer).pay(amt, "invoice-xyz");

    expect(await token.balanceOf(payments.address)).to.eq(amt);

    // Withdraw to recipient
    await expect(payments.withdrawAll(recipient.address))
      .to.emit(token, "Transfer"); // from contract to recipient

    expect(await token.balanceOf(payments.address)).to.eq(0);
    expect(await token.balanceOf(recipient.address)).to.eq(amt);

    // Only owner should be able to withdraw
    await token.connect(payer).approve(payments.address, amt);
    await payments.connect(payer).pay(amt, "invoice-xyz-2");
    await expect(
      payments.connect(payer).withdrawAll(recipient.address)
    ).to.be.reverted; // Ownable: caller is not the owner (or your custom revert)
  });
});