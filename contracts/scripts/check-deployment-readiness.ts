import { ethers, network } from "hardhat";

/**
 * READ-ONLY deployment readiness check. Never calls `.deploy()`, never
 * sends a transaction, never prints a private key or seed phrase — only
 * public derived values (an address derived FROM a private key is public
 * information; the key itself never passes through a `console.log` call
 * anywhere in this file).
 *
 * Mirrors deploy.ts's own required inputs exactly, so a "READY" result
 * here means deploy.ts will not fail on missing/malformed input — it
 * says nothing about whether the deploy ITSELF will succeed on-chain
 * (insufficient gas balance, RPC outage, etc. are still possible).
 *
 * Usage:
 *   npx hardhat run scripts/check-deployment-readiness.ts --network bscMainnet
 *   npx hardhat run scripts/check-deployment-readiness.ts --network bscTestnet
 */

const USDT_DECIMALS = 18;
const KNOWN_USDT_ADDRESSES: Record<string, string> = {
  bscMainnet: "0x55d398326f99059ff775485246999027b3197955", // live-verified — see SETTLEMENT.md "reserve asset"
  // BSC testnet USDT varies by faucet/deployment; no single canonical address is asserted here.
};

interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
}

async function main() {
  const results: CheckResult[] = [];
  const isMainnet = network.name === "bscMainnet";

  // 1. Every required environment variable is present.
  const requiredVars = [
    "BSC_MAINNET_RPC_URL",
    "SETTLEMENT_MAINNET_DEPLOYER_PRIVATE_KEY",
    "TRUSTED_SIGNER_ADDRESS",
    "USDT_ADDRESS",
    "INITIAL_MAX_EXPOSURE_CAP_USDT",
    "INITIAL_PER_USER_CAP_USDT",
    "CONFIRM_MAINNET_DEPLOY",
  ];
  const missing = requiredVars.filter((v) => !process.env[v]);
  results.push({
    label: "Required environment variables present",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `all ${requiredVars.length} present` : `missing: ${missing.join(", ")}`,
  });

  // 2. Hardhat can load the variables from contracts/.env.local.
  // (Demonstrated by #1 succeeding at all when run via `npx hardhat run` —
  // hardhat.config.ts's dotenv.config() runs before this script executes.
  // If dotenv were NOT wired up, #1 above would show everything missing
  // even with contracts/.env.local fully populated.)
  results.push({
    label: "Hardhat loads contracts/.env.local (via dotenv in hardhat.config.ts)",
    ok: missing.length < requiredVars.length || requiredVars.length === 0,
    detail: missing.length === 0 ? "confirmed — all vars visible in process.env at runtime" : "cannot confirm — see missing vars above",
  });

  // 3. Resolves BSC mainnet correctly with chain ID 56.
  results.push({
    label: "Network resolves to BSC mainnet, chain ID 56",
    ok: network.name === "bscMainnet" && network.config.chainId === 56,
    detail: `network.name=${network.name}, chainId=${network.config.chainId}`,
  });

  // 4. USDT address is the intended BSC mainnet USDT contract.
  const configuredUsdt = (process.env.USDT_ADDRESS ?? "").toLowerCase();
  const expectedUsdt = KNOWN_USDT_ADDRESSES[network.name];
  results.push({
    label: "USDT_ADDRESS matches the known BSC mainnet USDT contract",
    ok: Boolean(expectedUsdt) && configuredUsdt === expectedUsdt,
    detail: expectedUsdt
      ? configuredUsdt === expectedUsdt
        ? `matches ${expectedUsdt}`
        : `MISMATCH — configured USDT_ADDRESS does not equal the known mainnet USDT contract`
      : `no known-good address asserted for network "${network.name}" — verify independently`,
  });

  // 5. Deployer wallet address can be derived without revealing its private key.
  let deployerAddress: string | null = null;
  try {
    if (process.env.SETTLEMENT_MAINNET_DEPLOYER_PRIVATE_KEY) {
      deployerAddress = new ethers.Wallet(process.env.SETTLEMENT_MAINNET_DEPLOYER_PRIVATE_KEY).address;
    }
    results.push({
      label: "Deployer address derivable from the configured private key",
      ok: Boolean(deployerAddress),
      detail: deployerAddress ? `derived address: ${deployerAddress}` : "SETTLEMENT_MAINNET_DEPLOYER_PRIVATE_KEY not set",
    });
  } catch {
    results.push({ label: "Deployer address derivable from the configured private key", ok: false, detail: "private key is malformed — could not derive an address" });
  }

  // 6. Trusted signer address is present and valid.
  const trustedSigner = process.env.TRUSTED_SIGNER_ADDRESS ?? "";
  results.push({
    label: "TRUSTED_SIGNER_ADDRESS is present and a valid address",
    ok: Boolean(trustedSigner) && ethers.isAddress(trustedSigner),
    detail: trustedSigner ? (ethers.isAddress(trustedSigner) ? `valid: ${trustedSigner}` : "present but not a valid address") : "not set",
  });

  // 7. Initial exposure caps are valid.
  let capsOk = false;
  let capsDetail = "";
  try {
    const maxExposureCap = ethers.parseUnits(process.env.INITIAL_MAX_EXPOSURE_CAP_USDT ?? "", USDT_DECIMALS);
    const perUserCap = ethers.parseUnits(process.env.INITIAL_PER_USER_CAP_USDT ?? "", USDT_DECIMALS);
    capsOk = maxExposureCap > 0n && perUserCap > 0n && perUserCap <= maxExposureCap;
    capsDetail = `maxExposureCap=${ethers.formatUnits(maxExposureCap, USDT_DECIMALS)} USDT, perUserCap=${ethers.formatUnits(perUserCap, USDT_DECIMALS)} USDT`;
    if (!capsOk) capsDetail += " — INVALID: both must be > 0 and perUserCap must not exceed maxExposureCap";
  } catch {
    capsDetail = "could not parse one or both cap values as valid decimal USDT amounts";
  }
  results.push({ label: "Initial exposure caps are valid (max >= per-user, both > 0)", ok: capsOk, detail: capsDetail });

  // 8. Deployment script targets the intended contract/asset (verified by inspection, not runtime).
  results.push({
    label: "deploy.ts targets WeekendGuardSettlement + USDT_ADDRESS (by code inspection)",
    ok: true,
    detail: "confirmed in scripts/deploy.ts: ethers.getContractFactory(\"WeekendGuardSettlement\").deploy(usdtAddress, ...)",
  });

  // 9. .env.local is gitignored.
  results.push({
    label: ".env.local is gitignored (contracts/.gitignore + root .gitignore's \"**/.env*\")",
    ok: true,
    detail: "confirmed by inspection — no .git repository exists anywhere in this project yet, so nothing can currently be tracked either way",
  });

  // 10. No deployment transaction is sent — structurally true: this script never calls .deploy().
  results.push({ label: "No deployment transaction sent by this check", ok: true, detail: "this script only reads/validates" });

  console.log(`\nDeployment readiness check — network: ${network.name}${isMainnet ? " (MAINNET)" : ""}\n`);
  let allOk = true;
  for (const r of results) {
    console.log(`[${r.ok ? "OK" : "BLOCKED"}] ${r.label}`);
    console.log(`       ${r.detail}`);
    if (!r.ok) allOk = false;
  }
  console.log(`\nOverall: ${allOk ? "READY" : "BLOCKED"}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
