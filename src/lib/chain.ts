import { createPublicClient, http, type Address, erc20Abi } from "viem";
import { bsc } from "viem/chains";
import { WeekendGuardError } from "@/lib/errors";

/**
 * Single shared viem public client for BSC mainnet reads (ERC-20/BEP-20
 * balances, decimals). Uses Binance's own public RPC by default; override
 * with BSC_RPC_URL if you have a dedicated node/provider.
 */
export const bscPublicClient = createPublicClient({
  chain: bsc,
  transport: http(process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org", {
    // Public BSC RPC endpoints can be slow/degraded under load (observed
    // directly during this build: a plain fetch to bsc-dataseed.binance.org
    // took ~5s for one simple call and sometimes exceeded 8s). Without a
    // bound, one slow node hangs the whole request — a real instance of the
    // "chain RPC failure" case the build brief calls out, not a hypothetical.
    timeout: 8_000,
    retryCount: 1,
  }),
});

const decimalsCache = new Map<string, number>();

export async function getErc20Decimals(tokenAddress: Address): Promise<number> {
  const key = tokenAddress.toLowerCase();
  const cached = decimalsCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const decimals = await bscPublicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    });
    decimalsCache.set(key, decimals);
    return decimals;
  } catch (err) {
    throw new WeekendGuardError("RPC_FAILURE", "Failed to read token decimals from BSC", {
      tokenAddress,
      err,
    });
  }
}

export async function getErc20Balance(tokenAddress: Address, owner: Address): Promise<bigint> {
  try {
    return await bscPublicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    });
  } catch (err) {
    throw new WeekendGuardError("RPC_FAILURE", "Failed to read token balance from BSC", {
      tokenAddress,
      owner,
      err,
    });
  }
}
