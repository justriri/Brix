import { ethers, network } from "hardhat";

/**
 * Deterministic WeekendGuardSettlement deployer. Deploys ONLY — never
 * calls fundReserve, purchaseProtection, or anything else, and never
 * prints a private key or seed phrase (only the resulting, public,
 * on-chain contract address and the config that produced it).
 *
 * Every required value is read from an environment variable with NO
 * hardcoded fallback for anything that touches real funds or signing
 * authority — this script throws and refuses to deploy if any of them
 * is missing, rather than silently guessing. This mirrors the same
 * "fail closed on missing config" convention already used throughout
 * this app (see root README's "A note on the public BSC RPC endpoint"
 * and DEPLOYMENT.md's scheduler-auth section).
 *
 * RESERVE ASSET: USDT, not USDC — see WeekendGuardSettlement.sol's own
 * header comment for why (BRIX's economic flow is one stablecoin end to
 * end: USDT buys the tokenized stock AND funds/pays the protection
 * reserve). The real BSC Binance-Peg USDT address/decimals below are
 * live-verified (direct on-chain decimals()/symbol() read), not assumed.
 *
 * MAINNET SAFETY GATE: when `network.name === "bscMainnet"`, this script
 * additionally requires CONFIRM_MAINNET_DEPLOY=yes to be set. This is a
 * deliberate, extra, explicit opt-in distinct from merely having a funded
 * deployer key configured — a mainnet deployment is irreversible and
 * costs real BNB gas, so "the key happens to be set" should never be
 * sufficient on its own to broadcast a mainnet transaction.
 *
 * Usage (mainnet):
 *   BSC_MAINNET_RPC_URL=... \
 *   SETTLEMENT_MAINNET_DEPLOYER_PRIVATE_KEY=... \
 *   TRUSTED_SIGNER_ADDRESS=0x... \
 *   USDT_ADDRESS=0x55d398326f99059fF775485246999027B3197955 \
 *   INITIAL_MAX_EXPOSURE_CAP_USDT=1000 \
 *   INITIAL_PER_USER_CAP_USDT=100 \
 *   CONFIRM_MAINNET_DEPLOY=yes \
 *   npx hardhat run scripts/deploy.ts --network bscMainnet
 *
 * Usage (testnet) is identical but omits CONFIRM_MAINNET_DEPLOY and uses
 * SETTLEMENT_DEPLOYER_PRIVATE_KEY / --network bscTestnet instead. Note BSC
 * TESTNET's USDT address differs from mainnet's — verify it independently
 * rather than reusing the mainnet address above.
 */

const USDT_DECIMALS = 18; // matches the REAL BSC Binance-Peg USDT, live-verified — see SETTLEMENT.md "reserve asset"

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Refusing to deploy with a guessed/default value for anything that touches funds or signing authority.`);
  }
  return value;
}

async function main() {
  if (network.name === "bscMainnet" && process.env.CONFIRM_MAINNET_DEPLOY !== "yes") {
    throw new Error(
      "Refusing to deploy to BNB Chain Mainnet without an explicit CONFIRM_MAINNET_DEPLOY=yes. " +
        "This is a deliberate extra safety gate — having a funded deployer key configured is not, by itself, enough to broadcast a mainnet transaction."
    );
  }

  const usdtAddress = requireEnv("USDT_ADDRESS");
  const trustedSignerAddress = requireEnv("TRUSTED_SIGNER_ADDRESS");
  const maxExposureCap = ethers.parseUnits(requireEnv("INITIAL_MAX_EXPOSURE_CAP_USDT"), USDT_DECIMALS);
  const perUserCap = ethers.parseUnits(requireEnv("INITIAL_PER_USER_CAP_USDT"), USDT_DECIMALS);

  if (!ethers.isAddress(usdtAddress)) throw new Error(`USDT_ADDRESS is not a valid address: ${usdtAddress}`);
  if (!ethers.isAddress(trustedSignerAddress)) throw new Error(`TRUSTED_SIGNER_ADDRESS is not a valid address: ${trustedSignerAddress}`);
  if (perUserCap > maxExposureCap) throw new Error("INITIAL_PER_USER_CAP_USDT cannot exceed INITIAL_MAX_EXPOSURE_CAP_USDT.");

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      `No signer configured for network "${network.name}". Set the matching deployer-private-key env var (see hardhat.config.ts) — never a hardcoded key.`
    );
  }

  console.log(`Network:          ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer address: ${deployer.address}`); // public address — safe to print, never the key
  console.log(`USDT address:     ${usdtAddress}`);
  console.log(`Trusted signer:   ${trustedSignerAddress}`);
  console.log(`Max exposure cap: ${ethers.formatUnits(maxExposureCap, USDT_DECIMALS)} USDT`);
  console.log(`Per-user cap:     ${ethers.formatUnits(perUserCap, USDT_DECIMALS)} USDT`);

  const SettlementFactory = await ethers.getContractFactory("WeekendGuardSettlement");
  const settlement = await SettlementFactory.deploy(usdtAddress, trustedSignerAddress, maxExposureCap, perUserCap);
  await settlement.waitForDeployment();

  const deployedAddress = await settlement.getAddress();
  const deployTx = settlement.deploymentTransaction();

  console.log("\nDeployed WeekendGuardSettlement:");
  console.log(`  Address: ${deployedAddress}`);
  console.log(`  Tx hash: ${deployTx?.hash ?? "unknown"}`);
  console.log(
    `\nNext: set NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS=${deployedAddress}, NEXT_PUBLIC_USDT_ADDRESS=${usdtAddress}, ` +
      `and NEXT_PUBLIC_SETTLEMENT_CHAIN_ID=${network.config.chainId} in the app's production environment. ` +
      `The contract reserve is currently EMPTY — fundReserve() must be called separately before any policy can be purchased.`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
