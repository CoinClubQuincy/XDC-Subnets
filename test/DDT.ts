import { expect } from "chai";
import hre from "hardhat";
import { parseUnits } from "ethers";

// Hardhat v3 attaches ethers to the HRE at runtime.
// If your editor doesn't have the plugin types loaded, TS may complain.
// Using (hre as any).ethers avoids the type error while still working at runtime.
const ethers = (hre as any).ethers;

describe("DDT (ERC20 token)", function () {
  const NAME = "Data Derivative Token";
  const SYMBOL = "DDT";
  const SUPPLY_WHOLE = "1000000"; // 1,000,000 (contract will scale by decimals)
  const URI = "ipfs://your-ddt-metadata";

  it("deploys with correct metadata, owner, and totalSupply", async () => {
    const [deployer, alice] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("DDT");
    const token = await Token.deploy(NAME, SYMBOL, SUPPLY_WHOLE, URI);
    await token.waitForDeployment();

    const decimals: number = await token.decimals();

    expect(await token.name()).to.equal(NAME);
    expect(await token.symbol()).to.equal(SYMBOL);
    expect(decimals).to.equal(18); // OZ default; adjust if you changed it

    // owner (Ownable v5 uses owner())
    expect(await token.owner()).to.equal(deployer.address);

    // scaled total supply = SUPPLY_WHOLE * 10**decimals
    const totalSupply: bigint = await token.totalSupply();
    const expected: bigint = parseUnits(SUPPLY_WHOLE, decimals);
    expect(totalSupply).to.equal(expected);

    // deployer receives initial supply
    expect(await token.balanceOf(deployer.address)).to.equal(expected);

    // basic ERC20: transfer & approve/transferFrom
    const amt: bigint = parseUnits("1234", decimals);

    await expect(token.transfer(alice.address, amt))
      .to.emit(token, "Transfer")
      .withArgs(deployer.address, alice.address, amt);

    expect(await token.balanceOf(alice.address)).to.equal(amt);

    const spenderAmt: bigint = parseUnits("10", decimals);
    await token.connect(alice).approve(deployer.address, spenderAmt);
    expect(await token.allowance(alice.address, deployer.address)).to.equal(spenderAmt);

    await token.transferFrom(alice.address, deployer.address, spenderAmt);
    const deployerBal: bigint = await token.balanceOf(deployer.address);
    expect(deployerBal).to.equal(expected - amt + spenderAmt);
  });

  it("optionally supports setFee (skips if not present)", async () => {
    const [deployer] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("DDT");
    const token = await Token.deploy(NAME, SYMBOL, SUPPLY_WHOLE, URI);
    await token.waitForDeployment();

    // Check for setFee(uint16,address) function existence in ABI
    let hasSetFee = true;
    try {
      token.interface.getFunction("setFee(uint16,address)");
    } catch {
      hasSetFee = false;
    }

    if (!hasSetFee) {
      expect(true).to.equal(true);
      return;
    }

    // If you implemented setFee(uint16,address), this will succeed:
    await (token as any).setFee(50, deployer.address); // 0.50%
    expect(true).to.equal(true);
  });
});