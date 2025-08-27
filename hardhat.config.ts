// hardhat.config.ts (ESM)
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-ethers-chai-matchers";
import "dotenv/config";

// leave undefined if no key
const { PRIVATE_KEY } = process.env;
const ACCOUNTS = PRIVATE_KEY ? [PRIVATE_KEY] : undefined;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainId: 31337,
    },
    ganache: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: ACCOUNTS,
    },
    nuclei: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 589,
      accounts: ACCOUNTS,
    },
    nuclei_test: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 589,
      accounts: ACCOUNTS,
    },
    xdc: {
      type: "http",
      url: "https://rpc.xinfin.network",
      chainId: 50,
      accounts: ACCOUNTS,
    },
    eth: {
      type: "http",
      url: "https://ethereum.publicnode.com",
      chainId: 1,
      accounts: ACCOUNTS,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
