import { createPublicClient, fallback, http, type Address, erc20Abi } from "viem";
import { bsc } from "viem/chains";
import { WeekendGuardError } from "@/lib/errors";
import { BSC_PUBLIC_RPC_URLS } from "@/lib/config/assets";

/**
 * Single shared viem public client for BSC mainnet reads (ERC-20/BEP-20
 * balances, decimals).
 *
 * PRODUCTION RESILIENCE FIX: this used to hit exactly ONE public endpoint
 * (bsc-dataseed.binance.org) with no fallback. Public BSC RPC endpoints are
 * shared infrastructure that can be slow, rate-limited, or intermittently
 * unreachable from a given network path — including, concretely, from a
 * cloud host's shared IP ranges (e.g. a serverless platform), which is a
 * materially different reliability profile than a developer's own machine.
 * A single-endpoint client with no fallback turns any one provider's bad
 * moment into every on-chain read failing. Now tries BSC_RPC_URL first if
 * configured (a dedicated provider, e.g. QuickNode/Alchemy/Ankr — strongly
 * recommended for a real deployment), then falls through BOTH entries in
 * BSC_PUBLIC_RPC_URLS via viem's own `fallback()` transport, which
 * automatically retries the next transport in the list on failure.
 */
const rpcUrls = process.env.BSC_RPC_URL ? [process.env.BSC_RPC_URL, ...BSC_PUBLIC_RPC_URLS] : BSC_PUBLIC_RPC_URLS;

export const bscPublicClient = createPublicClient({
  chain: bsc,
  transport: fallback(
    rpcUrls.map((url) =>
      http(url, {
        // Public BSC RPC endpoints can be slow/degraded under load (observed
        // directly during this build: a plain fetch to bsc-dataseed.binance.org
        // took ~5s for one simple call and sometimes exceeded 8s). Without a
        // bound, one slow node hangs the whole request — a real instance of
        // the "chain RPC failure" case the build brief calls out, not a
        // hypothetical. Kept short per-endpoint specifically so fallback()
        // moves on to the next URL quickly rather than waiting out a long
        // timeout on a degraded node first.
        timeout: 6_000,
        retryCount: 0,
      })
    )
  ),
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
