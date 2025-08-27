

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
import { ethers, network } from "hardhat";
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

  // --- Deploy Token ---
  console.log(`\nDeploying ${TOKEN_CONTRACT_NAME}...`);
  const TokenFactory = await ethers.getContractFactory(TOKEN_CONTRACT_NAME);
  // Expected constructor for DDT: (string name, string symbol, uint256 supply, string uri)
  const token = await TokenFactory.deploy(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_SUPPLY, TOKEN_URI);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`${TOKEN_CONTRACT_NAME} deployed at:`, tokenAddress);

  // --- Deploy Payments Receiver ---
  console.log(`\nDeploying ${PAYMENTS_CONTRACT_NAME}...`);
  const PaymentsFactory = await ethers.getContractFactory(PAYMENTS_CONTRACT_NAME);
  // Expected constructor for SimplePayments: (address tokenAddress)
  const payments = await PaymentsFactory.deploy(tokenAddress);
  await payments.waitForDeployment();
  const paymentsAddress = await payments.getAddress();
  console.log(`${PAYMENTS_CONTRACT_NAME} deployed at:`, paymentsAddress);

  // --- Optional: set initial fee on token if it supports setFee(feeBps, collector) ---
  if (typeof token.setFee === "function") {
    const collector = deployer.address;
    const feeBps = Number(process.env.TOKEN_FEE_BPS || "0"); // 0 by default
    if (feeBps > 0) {
      console.log(`\nConfiguring token fee: ${feeBps} bps → collector ${collector}`);
      const tx = await token.setFee(feeBps, collector);
      await tx.wait();
      console.log("Token fee configured.");
    }
  }

  // --- Write deployments file ---
  const outDir = path.join(__dirname, "..", "deployments");
  const outFile = path.join(outDir, `${network.name}.json`);
  const payload = {
    network: network.name,
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
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nSaved deployments → ${outFile}`);

  // --- Console-friendly summary for quick copy to frontend CONFIG ---
  console.log("\n=== Copy to Frontend CONFIG ===");
  console.log(`PAYMENT_CONTRACT: "${paymentsAddress}",`);
  console.log(`TOKEN_CONTRACT:   "${tokenAddress}",`);
  console.log(`TOKEN_DECIMALS:   18 // (OpenZeppelin ERC20 default; adjust if different)`);
  console.log("================================");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});