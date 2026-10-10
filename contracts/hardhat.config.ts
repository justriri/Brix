import path from "node:path";
import dotenv from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

/**
 * Isolated Hardhat config for WeekendGuard's settlement contract — this
 * subproject is intentionally NOT wired into the main Next.js app's build/
 * lint/test pipeline (see package.json's own doc comment). `npm test` at
 * the repo root never touches this directory.
 *
 * Hardhat does NOT auto-load .env files on its own (that's a Next.js-
 * specific behavior) — explicitly loading contracts/.env.local here (never
 * the repo-root one; this subproject's secrets stay local to it) is what
 * lets a developer actually populate BSC_TESTNET_RPC_URL/BSC_MAINNET_RPC_URL/
 * SETTLEMENT_DEPLOYER_PRIVATE_KEY/SETTLEMENT_MAINNET_DEPLOYER_PRIVATE_KEY/etc.
 * from a file instead of exporting them in the shell by hand. `path.resolve`
 * (not a bare relative string) so this resolves correctly regardless of the
 * working directory `hardhat` is invoked from.
 *
 * Both bscTestnet and bscMainnet are configured but UNUSED unless their
 * respective RPC URL and deployer-private-key env vars are explicitly set
 * — if unset, `accounts` is an empty array, so Hardhat has no signer for
 * that network and any deploy attempt fails immediately rather than
 * silently using some other key. Deliberately TWO DIFFERENT env var names
 * (SETTLEMENT_DEPLOYER_PRIVATE_KEY for testnet, SETTLEMENT_MAINNET_DEPLOYER_PRIVATE_KEY
 * for mainnet) so a key set for testnet experimentation can never be
 * silently reused to sign a real mainnet transaction. No deployment has
 * been performed as part of this task (see SETTLEMENT.md "deployment
 * status"). Never hardcode a private key here.
 */
dotenv.config({ path: path.resolve(__dirname, ".env.local") });
const config: HardhatUserConfig = {
  paths: {
    sources: "./src",
    tests: "./test",
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL ?? "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: process.env.SETTLEMENT_DEPLOYER_PRIVATE_KEY ? [process.env.SETTLEMENT_DEPLOYER_PRIVATE_KEY] : [],
    },
    bscMainnet: {
      url: process.env.BSC_MAINNET_RPC_URL ?? "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts: process.env.SETTLEMENT_MAINNET_DEPLOYER_PRIVATE_KEY ? [process.env.SETTLEMENT_MAINNET_DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};

export default config;
