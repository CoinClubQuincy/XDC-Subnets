const dotenv = require("dotenv/config");
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-ethers-chai-matchers");
require("@nomicfoundation/hardhat-network-helpers");

const config = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    ganache: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    nuclei: {
      url: "http://127.0.0.1:8545",
      chainId: 589,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    xdc: {
      url: "http://127.0.0.1:8545",
      chainId: 50,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    eth: {
      url: "http://127.0.0.1:8545",
      chainId: 1,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    sol: {
      url: "http://127.0.0.1:8545",
      chainId: 0,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },

    // Add these later when you have URLs:
    // xdc: { url: process.env.XDC_RPC || "", chainId: 50, accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
    // apothem: { url: process.env.APOTHEM_RPC || "", chainId: 51, accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
  },
};

module.exports = config;
