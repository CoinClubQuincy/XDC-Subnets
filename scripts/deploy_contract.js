// deploy_contract.js
// ESM script (package.json has "type": "module")
// Deploys:
// 1) DDT-like ERC20 (constructor: (name, symbol, supply, uri))
// 2) SimplePayments(tokenAddress)
//
// Usage:
//   npx hardhat run scripts/deploy_contract.js --network localhost
//
// Env overrides (optional):
//   TOKEN_NAME="Data Derivative Token" TOKEN_SYMBOL=DDT TOKEN_SUPPLY=1000000 TOKEN_URI="ipfs://..." \
//   TOKEN_CONTRACT_NAME=DDT PAYMENTS_CONTRACT_NAME=SimplePayments \
//   npx hardhat run scripts/deploy_contract.js --network localhost
//
import { ethers, network, artifacts } from "hardhat";
import fs from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Config (env or defaults) ----
const TOKEN_CONTRACT_NAME = process.env.TOKEN_CONTRACT_NAME || "DDT";               // must exist in /contracts and be concrete (not abstract)
const PAYMENTS_CONTRACT_NAME = process.env.PAYMENTS_CONTRACT_NAME || "SimplePayments";

const TOKEN_NAME   = process.env.TOKEN_NAME   || "Data Derivative Token";
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || "DDT";
const TOKEN_SUPPLY = BigInt(process.env.TOKEN_SUPPLY || "1000000"); // whole tokens; contract will scale by decimals()
const TOKEN_URI    = process.env.TOKEN_URI    || "https://example.com/token/DDT";

// Optional confirmations and gas price
const CONFS = Number(process.env.CONFS || "2"); // wait for N confirmations on live nets
const GAS_PRICE_GWEI = process.env.GAS_PRICE_GWEI; // e.g., "3"
const GAS_OVERRIDES = GAS_PRICE_GWEI ? { gasPrice: ethers.parseUnits(GAS_PRICE_GWEI, "gwei") } : undefined;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Network   :", network.name);
  console.log("Deployer  :", deployer.address);
  console.log("Config    :", {
    TOKEN_CONTRACT_NAME,
    PAYMENTS_CONTRACT_NAME,
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_SUPPLY: TOKEN_SUPPLY.toString(),
    TOKEN_URI
  });

  const net = await ethers.provider.getNetwork();
  console.log("Chain ID  :", Number(net.chainId));

  // --- Deploy Token ---
  console.log(`\nDeploying ${TOKEN_CONTRACT_NAME}...`);
  const TokenFactory = await ethers.getContractFactory(TOKEN_CONTRACT_NAME);
  const tokenArgs = [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_SUPPLY, TOKEN_URI];
  const token = GAS_OVERRIDES
    ? await TokenFactory.deploy(...tokenArgs, GAS_OVERRIDES)
    : await TokenFactory.deploy(...tokenArgs);
  await token.waitForDeployment();
  const tokenTx = token.deploymentTransaction?.();
  if (tokenTx && CONFS > 0) {
    await tokenTx.wait(CONFS);
  }
  const tokenAddress = await token.getAddress();
  console.log(`${TOKEN_CONTRACT_NAME} deployed at:`, tokenAddress);

  // Save Token ABI for frontend
  const tokenArtifact = await artifacts.readArtifact(TOKEN_CONTRACT_NAME);
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${TOKEN_CONTRACT_NAME}.abi.json`), JSON.stringify(tokenArtifact.abi, null, 2));

  // --- Deploy Payments Receiver ---
  console.log(`\nDeploying ${PAYMENTS_CONTRACT_NAME}...`);
  const PaymentsFactory = await ethers.getContractFactory(PAYMENTS_CONTRACT_NAME);
  const payments = GAS_OVERRIDES
    ? await PaymentsFactory.deploy(tokenAddress, GAS_OVERRIDES)
    : await PaymentsFactory.deploy(tokenAddress);
  await payments.waitForDeployment();
  const paymentsTx = payments.deploymentTransaction?.();
  if (paymentsTx && CONFS > 0) {
    await paymentsTx.wait(CONFS);
  }
  const paymentsAddress = await payments.getAddress();
  console.log(`${PAYMENTS_CONTRACT_NAME} deployed at:`, paymentsAddress);

  // Save Payments ABI for frontend
  const paymentsArtifact = await artifacts.readArtifact(PAYMENTS_CONTRACT_NAME);
  fs.writeFileSync(path.join(outDir, `${PAYMENTS_CONTRACT_NAME}.abi.json`), JSON.stringify(paymentsArtifact.abi, null, 2));

  // --- Optional: set initial fee on token if it supports setFee(uint16,address) ---
  try {
    token.getFunction("setFee");
    const collector = deployer.address;
    const feeBps = Number(process.env.TOKEN_FEE_BPS || "0");
    if (feeBps > 0) {
      console.log(`\nConfiguring token fee: ${feeBps} bps → collector ${collector}`);
      const tx = await token.setFee(feeBps, collector);
      await tx.wait();
      console.log("Token fee configured.");
    }
  } catch (_) {
    // token has no setFee function — skip silently
  }

  // --- Write deployments file ---
  const outFile = path.join(outDir, `${network.name}.json`);
  const payload = {
    network: network.name,
    chainId: Number(net.chainId),
    confirmations: CONFS,
    deployer: deployer.address,
    token: {
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      supply: TOKEN_SUPPLY.toString(),
      uri: TOKEN_URI,
      contract: TOKEN_CONTRACT_NAME,
      address: tokenAddress
    },
    payments: {
      contract: PAYMENTS_CONTRACT_NAME,
      address: paymentsAddress
    },
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nSaved deployments → ${outFile}`);

  // --- Console-friendly summary for quick copy to frontend CONFIG ---
  console.log("\n=== Copy to Frontend CONFIG ===");
  console.log(`PAYMENT_CONTRACT: "${paymentsAddress}",`);
  console.log(`TOKEN_CONTRACT:   "${tokenAddress}",`);
  console.log(`TOKEN_DECIMALS:   18 // (OpenZeppelin ERC20 default; adjust if different)`);
  console.log(`CONFIRMATIONS:    ${CONFS}`);
  if (GAS_OVERRIDES) console.log(`GAS_PRICE_GWEI:   ${GAS_PRICE_GWEI}`);
  console.log("================================");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});