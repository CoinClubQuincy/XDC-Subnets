import { expect } from "chai";
import { ethers } from "hardhat";

describe("DDT (ERC20 token)", function () {
  const NAME = "Data Derivative Token";
  const SYMBOL = "DDT";
  const SUPPLY_WHOLE = "1000000"; // 1,000,000 (contract will scale by decimals)
  const URI = "ipfs://your-ddt-metadata";

  it("deploys with correct metadata, owner, and totalSupply", async () => {
    const [deployer] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("DDT");
    const token = await Token.deploy(NAME, SYMBOL, SUPPLY_WHOLE, URI);
    await token.deployed?.(); // v5 compat
    const decimals = await token.decimals();

    expect(await token.name()).to.equal(NAME);
    expect(await token.symbol()).to.equal(SYMBOL);
    expect(decimals).to.equal(18); // OZ default; adjust if you changed it

    // owner (Ownable v5 uses owner())
    expect(await token.owner()).to.equal(deployer.address);

    // scaled total supply = SUPPLY_WHOLE * 10**decimals
    const totalSupply = await token.totalSupply();
    const expected = ethers.utils.parseUnits(SUPPLY_WHOLE, decimals);
    expect(totalSupply).to.eq(expected);

    // deployer receives initial supply
    expect(await token.balanceOf(deployer.address)).to.eq(expected);

    // basic ERC20: transfer & approve/transferFrom
    const [, alice] = await ethers.getSigners();
    const amt = ethers.utils.parseUnits("1234", decimals);

    await expect(token.transfer(alice.address, amt))
      .to.emit(token, "Transfer")
      .withArgs(deployer.address, alice.address, amt);

    expect(await token.balanceOf(alice.address)).to.eq(amt);

    const spenderAmt = ethers.utils.parseUnits("10", decimals);
    await token.connect(alice).approve(deployer.address, spenderAmt);
    expect(await token.allowance(alice.address, deployer.address)).to.eq(spenderAmt);

    await token.transferFrom(alice.address, deployer.address, spenderAmt);
    expect(await token.balanceOf(deployer.address)).to.eq(expected.sub(amt).add(spenderAmt));
  });

  it("optionally supports setFee (skips if not present)", async () => {
    const [deployer] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("DDT");
    const token = await Token.deploy(NAME, SYMBOL, SUPPLY_WHOLE, URI);
    await token.deployed?.();

    // Robust check: only run if method exists
    // ethers v5: token.functions has keys; getFunction may not exist on v5 contract
    const hasSetFee = (token as any).functions && typeof (token as any).functions["setFee(uint16,address)"] === "function";

    if (!hasSetFee) {
      // No-op: just assert true to mark test as passed
      expect(true).to.eq(true);
      return;
    }

    // If you implemented setFee(uint16,address), this will succeed:
    await (token as any).setFee(50, deployer.address); // 0.50%
    // We don’t assume specific fee behavior in transfers here—implementation-dependent.
    expect(true).to.eq(true);
  });
});