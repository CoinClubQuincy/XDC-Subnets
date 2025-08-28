/// <reference types="node" />
import "dotenv/config";
import "@nomicfoundation/hardhat-ethers";


console.log("ENV.GANACHE_URL=", process.env.GANACHE_URL);
console.log("ENV.PRIVATE_KEYS=", process.env.PRIVATE_KEYS);

const config = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    ganache: {
      type: "http",
      url: process.env.GANACHE_URL || "http://127.0.0.1:8545",
      accounts: (() => {
        const raw = process.env.PRIVATE_KEYS ?? "";
        const keys = raw
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((k: string) => (k.startsWith("0x") ? k : `0x${k}`));
        return keys.length > 0 ? keys : undefined;
      })(),
    },
  },
};

export default config;