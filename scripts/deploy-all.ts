/// <reference types="hardhat" />
import "dotenv/config";
import hre from "hardhat";
import { ethers } from "ethers";
import type { BaseContract, BigNumberish } from "ethers";

type ERC20Like = BaseContract & {
  decimals(): Promise<number>;
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

function env(name: string, fallback?: string) {
  return process.env[name] ?? fallback;
}

async function main() {
  // ---- Provider & Signers (no Hardhat plugin needed) ----
  const rpcUrl = env("GANACHE_URL", "http://127.0.0.1:8545")!;
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const rawKeys = (env("PRIVATE_KEYS", "") || "").split(",").map(s => s.trim()).filter(Boolean);
  if (rawKeys.length === 0) {
    throw new Error("PRIVATE_KEYS is required (comma-separated). Provide at least one key for the deployer.");
  }
  const deployer = new ethers.Wallet(rawKeys[0].startsWith("0x") ? rawKeys[0] : `0x${rawKeys[0]}`, provider);

  // We'll also use deployer as the 'user' to avoid relying on Hardhat's injected signers.
  const user = deployer;

  // ---- Config ----
  const TOKEN_KIND = (env("TOKEN_KIND", "DDT") as "DDT" | "IDC");
  const TOKEN_NAME = env("TOKEN_NAME", TOKEN_KIND === "DDT" ? "Data Derivative Credit" : "Insight Derivative Credit")!;
  const TOKEN_SYMBOL = env("TOKEN_SYMBOL", TOKEN_KIND);
  const TOKEN_SUPPLY = BigInt(env("TOKEN_SUPPLY", "1000000")!);
  const TOKEN_URI = env("TOKEN_URI", "ipfs://example");

  const feeBpsStr = env("FEE_BPS", "0")!;
  const FEE_BPS = Number(feeBpsStr);
  if (Number.isNaN(FEE_BPS) || FEE_BPS < 0 || FEE_BPS > 1000) {
    throw new Error("FEE_BPS must be between 0 and 1000 (max 10%)");
  }
  const FEE_COLLECTOR = env("FEE_COLLECTOR") || (await deployer.getAddress());

  console.log("Deployer:", await deployer.getAddress());
  console.log("User (using deployer as user):", await user.getAddress());
  console.log("Network:", (await provider.getNetwork()).chainId.toString());

  // ---- 1) Deploy ERC20 (DDT or IDC) using artifacts ----
  const factoryName = TOKEN_KIND; // matches contract names in Assets.sol
  const tokenArtifact = await hre.artifacts.readArtifact(factoryName);
  const TokenFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, deployer);
  const token = (await TokenFactory.deploy(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_SUPPLY, TOKEN_URI)) as unknown as ERC20Like;
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`${factoryName} deployed at:`, tokenAddr);

  // Optional: set fee
  if (FEE_BPS > 0) {
    if (!FEE_COLLECTOR || FEE_COLLECTOR === "0x0000000000000000000000000000000000000000") {
      throw new Error("FEE_COLLECTOR must be a non-zero address when FEE_BPS > 0");
    }
    const tx = await (token as any).setFee(FEE_BPS, FEE_COLLECTOR);
    await tx.wait();
    console.log(`Fee set: ${FEE_BPS} bps -> collector ${FEE_COLLECTOR}`);
  } else {
    console.log("No transfer fee configured (FEE_BPS=0).");
  }

  // ---- 2) Deploy SimplePayments with the token address ----
  const paymentsArtifact = await hre.artifacts.readArtifact("SimplePayments");
  const PaymentsFactory = new ethers.ContractFactory(paymentsArtifact.abi, paymentsArtifact.bytecode, deployer);
  const payments = (await PaymentsFactory.deploy(tokenAddr)) as unknown as PaymentsLike;
  await payments.waitForDeployment();
  const paymentsAddr = await payments.getAddress();
  console.log("SimplePayments deployed at:", paymentsAddr);

  // ---- 3) Demo pay flow (deployer acts as user) ----
  const decimals = Number(await (token as any).decimals());
  const unit = 10n ** BigInt(decimals);

  // transfer 1,000 tokens to user (same as deployer here)
  const giveUser = 1_000n * unit;
  await (await (token as any).transfer(await user.getAddress(), giveUser)).wait();

  const payAmount = (12345n * unit) / 100n; // 123.45

  const tokenAsUser = new ethers.Contract(tokenAddr, tokenArtifact.abi, user) as unknown as ERC20Like;
  await (await tokenAsUser.approve(paymentsAddr, payAmount)).wait();

  const paymentsAsUser = new ethers.Contract(paymentsAddr, paymentsArtifact.abi, user) as unknown as PaymentsLike;
  await (await paymentsAsUser.pay(payAmount, "hello from deploy script")).wait();

  const bal = await (token as any).balanceOf(paymentsAddr);
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