import type { HardhatUserConfig } from "hardhat/config";
import "dotenv/config";

import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable } from "hardhat/config";

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    nuke: {
      type: "edr-simulated",
      chainType: "l1",
    },
    xdc: {
      type: "edr-simulated",
      chainType: "l1",
    },
    eth: {
      type: "edr-simulated",
      chainType: "op",
    },
    ganache: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
};

export default config;
