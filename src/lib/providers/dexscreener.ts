import dns from "node:dns";
import { WeekendGuardError } from "@/lib/errors";
import { selectTrustedQuotePool, type TrustedQuoteLiquidityResult } from "@/lib/providers/trustedQuoteLiquidity";

/**
 * Thin client over DexScreener's public, no-API-key token endpoint.
 * Confirmed live and working during this build session for real BSC
 * bStocks/Ondo pairs (see lib/config/assets.ts for provenance).
 *
 * Docs: https://docs.dexscreener.com/api/reference
 *
 * DNS fix (same class of issue as providers/binanceRwa.ts / providers/
 * pyth.ts, live-reproduced during this investigation): under a
 * long-running Node process, calls to api.dexscreener.com intermittently
 * failed outright even though a freshly-spawned process hitting the exact
 * same URL succeeded immediately — the same dual-stack getaddrinfo race
 * already documented and fixed for the other two providers. Applying the
 * identical, harmless, process-wide ipv4-first preference here closes the
 * same gap for this host.
 */
dns.setDefaultResultOrder("ipv4first");

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  /** DexScreener's own AMM-version tag (e.g. ["v2"], ["v3"]) — live-verified present on every pancakeswap pair seen during the TSLAB V2/V3 pool-selection investigation. See trustedQuoteLiquidity.ts for why this matters: this app's swap execution is PancakeSwap-V2-only. */
  labels?: string[];
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  txns?: {
    h1?: { buys: number; sells: number };
    m5?: { buys: number; sells: number };
  };
  pairCreatedAt?: number;
}

export interface DexScreenerSummary {
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  /**
   * Best-effort freshness proxy: DexScreener doesn't expose a "last trade"
   * timestamp directly, so we treat "no buys/sells in the last hour" as a
   * signal the pool may be dormant. This is documented, not hidden.
   */
  tradedInLastHour: boolean;
  pairAddress: string;
  dexId: string;
  pairCount: number;
}

const DEXSCREENER_TOKENS_URL = "https://api.dexscreener.com/latest/dex/tokens";

/**
 * Raw fetch, shared by getDexScreenerSummary() and
 * getTrustedQuoteLiquidity() — the only thing either function duplicated
 * before was this exact fetch+error-handling block, factored out here so
 * the liquidity work genuinely reuses the existing integration rather than
 * re-implementing its own copy. Behavior of getDexScreenerSummary() is
 * unchanged by this extraction.
 */
async function fetchAllBscPairs(tokenAddress: string): Promise<DexScreenerPair[]> {
  let res: Response;
  try {
    res = await fetch(`${DEXSCREENER_TOKENS_URL}/${tokenAddress}`, {
      // DexScreener data changes fast; avoid Next.js caching a stale price.
      cache: "no-store",
      // Bound every external call — an unresponsive provider must fail fast
      // into our typed error/notes path, never hang the request.
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    throw new WeekendGuardError("API_UNAVAILABLE", "DexScreener request failed", { err });
  }

  if (res.status === 429) {
    throw new WeekendGuardError("RATE_LIMITED", "DexScreener rate limit hit");
  }
  if (!res.ok) {
    throw new WeekendGuardError("API_UNAVAILABLE", `DexScreener returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as { pairs?: DexScreenerPair[] };
  return (data.pairs ?? []).filter((p) => p.chainId === "bsc" && p.priceUsd !== undefined);
}

/**
 * Fetches all known pairs for a BSC token address and summarizes them using
 * the single deepest pair QUOTED AGAINST A TRUSTED ASSET (USDT/USDC/BUSD/
 * WBNB, on PancakeSwap — see trustedQuoteLiquidity.ts) as the representative
 * price/liquidity for that token. Returns null if the token has no pairs at
 * all (i.e. it isn't actually trading anywhere DexScreener indexes); throws
 * a LIQUIDITY_UNAVAILABLE WeekendGuardError if pairs exist but none qualify
 * as trusted (the caller's existing catch block already turns that into a
 * "failed" wrapper health with a specific note — see wrapperCommon.ts).
 *
 * BUG FIX (live-diagnosed): this function used to pick the deepest pair
 * REGARDLESS of its quote asset, which could silently read price/liquidity
 * from a near-worthless spam pair (confirmed live: Ondo's TSLA wrapper's
 * deepest BSC pair was quoted against an obscure "ASX" token, $3.5k TVL, 1
 * trade/hour — giving a $356.74 "price" that disagreed with bStocks TSLAB's
 * real, $1.9M-liquidity, USDT-quoted $374.91 by >4%). That fed a FALSE
 * cross-wrapper "disagreement" into the Safety Gate (safety/
 * wrapperConsistency.ts), which blocked Protect for a perfectly healthy
 * bStocks position — not a genuine safety concern, a data-integrity bug.
 * Routing through the SAME trusted-pool selection already used for the
 * liquidity check closes that gap: a wrapper with no trustworthy price now
 * correctly reports as unavailable (health "failed", logged in `notes`)
 * instead of contaminating the comparison with a fabricated number.
 */
export async function getDexScreenerSummary(
  tokenAddress: string
): Promise<DexScreenerSummary | null> {
  const bscPairs = await fetchAllBscPairs(tokenAddress);
  if (bscPairs.length === 0) return null;

  const trusted = selectTrustedQuotePool(bscPairs);
  if (trusted.status === "no_qualifying_pair") {
    throw new WeekendGuardError("LIQUIDITY_UNAVAILABLE", trusted.reason);
  }

  // Pull volume/recent-activity from the SAME pair selectTrustedQuotePool
  // already chose (by address) — trustedQuoteLiquidity.ts stays a pure,
  // minimal, dependency-free module and doesn't carry these fields itself.
  const pair = bscPairs.find((p) => p.pairAddress === trusted.pairAddress)!;
  const tradedInLastHour = ((pair.txns?.h1?.buys ?? 0) + (pair.txns?.h1?.sells ?? 0)) > 0;

  return {
    priceUsd: trusted.priceUsd,
    liquidityUsd: trusted.tvlUsd,
    volume24hUsd: pair.volume?.h24 ?? 0,
    tradedInLastHour,
    pairAddress: trusted.pairAddress,
    dexId: trusted.dexId,
    pairCount: bscPairs.length,
  };
}

export type { TrustedQuoteLiquidityResult };

/**
 * Finds the single legitimate, deepest BSC pool for `tokenAddress` whose
 * quote asset is trusted (USDT/USDC/BUSD/WBNB, verified by on-chain
 * address — see trustedQuoteLiquidity.ts for the allowlist and selection
 * logic, factored out there so it's unit-testable without a network call).
 *
 * Never aggregates across pairs — selects exactly one (the deepest
 * qualifying one) and reports it, with full diagnostic detail, as pool
 * TVL (both sides of that single pool combined). This is NOT executable
 * depth or available-liquidity-within-a-price-impact-limit — see
 * safety/liquidity.ts for why that distinction is named explicitly
 * everywhere this value is surfaced.
 */
export async function getTrustedQuoteLiquidity(tokenAddress: string): Promise<TrustedQuoteLiquidityResult> {
  const bscPairs = await fetchAllBscPairs(tokenAddress);
  return selectTrustedQuotePool(bscPairs);
}
