require("dotenv").config();

require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("dotenv").config();


const { PRIVATE_KEY } = process.env;
const ACCOUNTS = PRIVATE_KEY ? [PRIVATE_KEY] : undefined; // leave undefined if no key

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    ganache: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: ACCOUNTS,
    },
    nuclei: {
      url: "http://127.0.0.1:8545",
      chainId: 589,
      accounts: ACCOUNTS,
    },
    nuclei_test: {
      url: "http://127.0.0.1:8545",
      chainId: 589,
      accounts: ACCOUNTS,
    },
    xdc: {
      url: "https://rpc.xinfin.network",
      chainId: 50,
      accounts: ACCOUNTS,
    },
    eth: {
      url: "https://ethereum.publicnode.com",
      chainId: 1,
      accounts: ACCOUNTS,
    },
  },
  mocha: { timeout: 60000 },
};
