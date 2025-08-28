/// <reference types="hardhat" />
import "dotenv/config";
import hre from "hardhat";
import { ethers, NonceManager } from "ethers";
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
  // Wrap the deployer with a NonceManager to avoid nonce races on Ganache/HTTP RPC
  const managedDeployer = new NonceManager(deployer);

  // We'll also use managedDeployer as the 'user' to avoid relying on Hardhat's injected signers.
  const user = managedDeployer;

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
  const FEE_COLLECTOR = env("FEE_COLLECTOR") || (await managedDeployer.getAddress());

  // console.log("Deployer:", await managedDeployer.getAddress());
  // console.log("User (using deployer as user):", await user.getAddress());
  // console.log("Network:", (await provider.getNetwork()).chainId.toString());

  // ---- 1) Deploy ERC20 (DDT or IDC) using artifacts ----
  const factoryName = TOKEN_KIND; // matches contract names in Assets.sol
  const tokenArtifact = await hre.artifacts.readArtifact(factoryName);
  const TokenFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, managedDeployer);
  const token = (await TokenFactory.deploy(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_SUPPLY, TOKEN_URI)) as unknown as ERC20Like;
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();

  console.log("=== Token Deployment ===");
  console.log("Contract:", factoryName);
  console.log("Name:", TOKEN_NAME);
  console.log("Symbol:", TOKEN_SYMBOL);
  console.log("Supply:", TOKEN_SUPPLY.toString());
  console.log("URI:", TOKEN_URI);
  console.log("Address:", tokenAddr);

  // Optional: set fee
  if (FEE_BPS > 0) {
    if (!FEE_COLLECTOR || FEE_COLLECTOR === "0x0000000000000000000000000000000000000000") {
      throw new Error("FEE_COLLECTOR must be a non-zero address when FEE_BPS > 0");
    }
    const tx = await (token as any).setFee(FEE_BPS, FEE_COLLECTOR);
    await tx.wait();
    // console.log(`Fee set: ${FEE_BPS} bps -> collector ${FEE_COLLECTOR}`);
    console.log("Fee:", FEE_BPS, "bps");
    console.log("Collector:", FEE_COLLECTOR);
  } else {
    // console.log("No transfer fee configured (FEE_BPS=0).");
    console.log("Fee: 0 bps (no transfer fee configured)");
  }

  // ---- 2) Deploy SimplePayments with the token address ----
  const paymentsArtifact = await hre.artifacts.readArtifact("SimplePayments");
  const PaymentsFactory = new ethers.ContractFactory(paymentsArtifact.abi, paymentsArtifact.bytecode, managedDeployer);
  const payments = (await PaymentsFactory.deploy(tokenAddr)) as unknown as PaymentsLike;
  await payments.waitForDeployment();
  const paymentsAddr = await payments.getAddress();

  console.log("=== Payments Deployment ===");
  console.log("Contract: SimplePayments");
  console.log("Address:", paymentsAddr);

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
  // console.log("Payments contract token balance:", bal.toString());
  // console.log("Last payment:", {
  //   payer: last[0],
  //   amount: last[1].toString(),
  //   memo: last[2],
  //   timestamp: last[3].toString(),
  // });

  console.log("=== Deployment Summary ===");
  console.log("Deployer:", await managedDeployer.getAddress());
  console.log("Token:", tokenAddr);
  console.log("Payments:", paymentsAddr);
  console.log("Last Payment:", {
    payer: last[0],
    amount: last[1].toString(),
    memo: last[2],
    timestamp: last[3].toString()
  });
  console.log("✅ Deployment completed successfully.");

  // ---- Frontend / MetaMask config (copy-paste) ----
  const net = await provider.getNetwork();
  const chainIdDec = Number(net.chainId);
  const chainIdHex = `0x${chainIdDec.toString(16)}`;
  const tokenName = await (token as any).name?.().catch(() => TOKEN_NAME) ?? TOKEN_NAME;
  const tokenSymbol = await (token as any).symbol?.().catch(() => TOKEN_SYMBOL) ?? TOKEN_SYMBOL;
  const tokenDecimals = await (token as any).decimals?.().catch(() => decimals) ?? decimals;

  const frontendConfig = {
    network: {
      name: net.name || "local",
      chainId: chainIdDec,
      chainIdHex,
      rpcUrl,
    },
    accounts: {
      deployer: await managedDeployer.getAddress(),
      user: await user.getAddress(),
      feeCollector: FEE_BPS > 0 ? FEE_COLLECTOR : null,
    },
    token: {
      name: tokenName,
      symbol: tokenSymbol,
      decimals: Number(tokenDecimals),
      address: tokenAddr,
      abi: tokenArtifact.abi,
      feeBps: FEE_BPS,
      feeCollector: FEE_BPS > 0 ? FEE_COLLECTOR : null,
      uri: TOKEN_URI,
      kind: TOKEN_KIND,
    },
    payments: {
      address: paymentsAddr,
      abi: paymentsArtifact.abi,
      lastPayment: {
        payer: last[0],
        amount: last[1].toString(),
        memo: last[2],
        timestamp: last[3].toString(),
      },
    },
  } as const;

  console.log("\n=== Frontend Config (JSON for MetaMask + dApp) ===");
  console.log(JSON.stringify(frontendConfig, null, 2));
  console.log("=== End Frontend Config ===\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});