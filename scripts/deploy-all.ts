/// <reference types="hardhat" />
import "@nomicfoundation/hardhat-ethers";
import hre from "hardhat";
import type { BaseContract, BigNumberish } from "ethers";
const { ethers } = hre;


type ERC20Like = BaseContract & {
  decimals(): Promise<number>; // OZ v5 ERC20 returns uint8 -> number in ethers v6, we coerce to number below
  transfer(to: string, amount: BigNumberish): Promise<any>;
  balanceOf(addr: string): Promise<bigint>;
  approve(spender: string, amount: BigNumberish): Promise<any>;
  connect(signer: any): ERC20Like;
  setFee(bps: number, collector: string): Promise<any>;
};

type PaymentsLike = BaseContract & {
  pay(amount: BigNumberish, memo: string): Promise<any>;
  paymentsLength(): Promise<bigint>;
  getPayment(index: BigNumberish): Promise<[string, bigint, string, bigint]>;
  connect(signer: any): PaymentsLike;
};

/**
 * Env knobs (or just edit the defaults below)
 *   TOKEN_KIND=DDT | IDC
 *   TOKEN_NAME="Data Derivative Credit"
 *   TOKEN_SYMBOL=DDT
 *   TOKEN_SUPPLY=1_000_000
 *   TOKEN_URI="ipfs://Qm..."
 *   FEE_BPS=100         // 100 = 1% (0 to skip)
 *   FEE_COLLECTOR=0x... // defaults to deployer if FEE_BPS > 0 and not set
 */
function env(name: string, fallback?: string) {
  return process.env[name] ?? fallback;
}

async function main() {
  const [deployer, user] = await ethers.getSigners();

  // ---- Config ----
  const TOKEN_KIND = (env("TOKEN_KIND", "DDT") as "DDT" | "IDC");
  const TOKEN_NAME = env("TOKEN_NAME", TOKEN_KIND === "DDT" ? "Data Derivative Credit" : "Insight Derivative Credit")!;
  const TOKEN_SYMBOL = env("TOKEN_SYMBOL", TOKEN_KIND);
  const TOKEN_SUPPLY = BigInt(env("TOKEN_SUPPLY", "1000000")!); // whole tokens
  const TOKEN_URI = env("TOKEN_URI", "ipfs://example");

  const feeBpsStr = env("FEE_BPS", "0")!;
  const FEE_BPS = Number(feeBpsStr);
  if (Number.isNaN(FEE_BPS) || FEE_BPS < 0 || FEE_BPS > 1000) {
    throw new Error("FEE_BPS must be between 0 and 1000 (max 10%)");
  }
  const FEE_COLLECTOR = env("FEE_COLLECTOR") || (await deployer.getAddress());

  console.log("Deployer:", await deployer.getAddress());
  console.log("User (for demo payment):", await user.getAddress());
  console.log("Network:", (await ethers.provider.getNetwork()).chainId.toString());

  // ---- 1) Deploy ERC20 (DDT or IDC) ----
  const factoryName = TOKEN_KIND; // matches contract names in Assets.sol
  const TokenFactory = await ethers.getContractFactory(factoryName);
  const token = (await TokenFactory.deploy(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_SUPPLY, TOKEN_URI)) as unknown as ERC20Like;
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`${factoryName} deployed at:`, tokenAddr);

  // Optional: set fee
  if (FEE_BPS > 0) {
    if (!FEE_COLLECTOR || FEE_COLLECTOR === "0x0000000000000000000000000000000000000000") {
      throw new Error("FEE_COLLECTOR must be a non-zero address when FEE_BPS > 0");
    }
    const tx = await token.setFee(FEE_BPS, FEE_COLLECTOR);
    await tx.wait();
    console.log(`Fee set: ${FEE_BPS} bps -> collector ${FEE_COLLECTOR}`);
  } else {
    console.log("No transfer fee configured (FEE_BPS=0).");
  }

  // ---- 2) Deploy SimplePayments with the token address ----
  const PaymentsFactory = await ethers.getContractFactory("SimplePayments");
  const payments = (await PaymentsFactory.deploy(tokenAddr)) as unknown as PaymentsLike;
  await payments.waitForDeployment();
  const paymentsAddr = await payments.getAddress();
  console.log("SimplePayments deployed at:", paymentsAddr);

  // ---- 3) Demo “pay” flow so you know it’s all hooked up ----
  // give user some tokens and have them pay the Payments contract
  const decimals = Number(await token.decimals());
  const unit = 10n ** BigInt(decimals);

  // transfer 1,000 tokens to user
  const giveUser = 1_000n * unit;
  await (await token.transfer(await user.getAddress(), giveUser)).wait();

  // user approves and pays 123.45 tokens with a memo
  const payAmount = (12345n * unit) / 100n; // 123.45
  // Rebind contract instances to `user` via getContractAt to keep TS types happy
  const tokenAsUser = (await ethers.getContractAt(factoryName, tokenAddr, user)) as unknown as ERC20Like;
  await (await tokenAsUser.approve(paymentsAddr, payAmount)).wait();

  const paymentsAsUser = (await ethers.getContractAt("SimplePayments", paymentsAddr, user)) as unknown as PaymentsLike;
  await (await paymentsAsUser.pay(payAmount, "hello from deploy script")).wait();

  // read back a couple things
  const bal = await token.balanceOf(paymentsAddr);
  const len = await payments.paymentsLength();
  const last = await payments.getPayment(len - 1n);
  console.log("Payments contract token balance:", bal.toString());
  console.log("Last payment:", {
    payer: last[0],
    amount: last[1].toString(),
    memo: last[2],
    timestamp: last[3].toString(),
  });

  console.log("✅ Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});