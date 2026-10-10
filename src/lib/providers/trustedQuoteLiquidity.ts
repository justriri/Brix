/**
 * Pure, dependency-free pool-selection logic for the trusted-quote
 * liquidity (pool TVL) check — factored out of dexscreener.ts so it can be
 * unit-tested directly with Node's built-in test runner (see
 * trustedQuoteLiquidity.test.mts), the same pattern used for the
 * tokenPriceUpdatedAt clock-skew fix (binanceRwaTimestamp.ts).
 *
 * Per the liquidity investigation (research-only pass before this
 * implementation): DexScreener's `liquidity.usd` is POOL TVL — both sides
 * of a single pool combined (confirmed by reconstructing it arithmetically
 * from live reserve data) — never executable depth or available size
 * within a price-impact limit. Nothing here changes that meaning; this
 * module only decides WHICH single pool's TVL is trustworthy enough to use.
 *
 * EXECUTION-COMPATIBILITY HISTORY (TSLAB INSUFFICIENT_OUTPUT_AMOUNT
 * revert): this module was previously restricted to `labels` === "v2"
 * ONLY, because at that time spotPurchaseClient.ts executed every swap
 * through PancakeSwap's V2 Router exclusively — a router that can only
 * settle against pairs in PancakeSwap's own V2 Factory, with no awareness
 * of V3 (concentrated liquidity, no `getReserves()`) or any other DEX's
 * fork. Selecting a deep V3 pool's TVL for liquidity/quoting purposes while
 * the swap could only ever execute against a separate, nearly-empty V2
 * pool is exactly what caused that revert.
 *
 * REOPENED TO V3 (Smart Router migration): execution has since moved to
 * PancakeSwap's official Smart Router (spotPurchaseClient.ts's
 * getSmartRouterTrade/swapViaSmartRouter), which routes through V2 AND V3
 * (confirmed live: TSLAB/NVDAB/AAPLB's best routes are V3 or mixed
 * V2+V3). Keeping this module V2-only after that migration would recreate
 * the EXACT SAME inconsistency the V2-only restriction was built to
 * prevent — just inverted: UNDER-counting real, now-executable liquidity
 * (e.g. reporting TSLAB's V2-only pool at ~$15k when its real,
 * Smart-Router-executable TVL, V2+V3 combined, is ~$1.96M — the very
 * figure safety/thresholds.ts's MIN_LIQUIDITY_USD was originally
 * calibrated against). The one invariant that must always hold — "the
 * pool used for liquidity/quoting must correspond to what can actually
 * execute" — now means ACCEPTING any PancakeSwap pair Smart Router can
 * route through (V2 or V3), not excluding V3. A pair from a DIFFERENT
 * DEX's fork is still excluded: PancakeSwap's Smart Router only knows
 * PancakeSwap's own Factories.
 */

/**
 * Canonical BSC contract addresses for the trusted quote-asset allowlist,
 * each independently confirmed live (direct DexScreener token lookup, not
 * a fuzzy search) during the liquidity investigation:
 *   USDT (Binance-Peg BSC-USD), USDC (USD Coin), BUSD (Binance-Peg BUSD),
 *   WBNB (Wrapped BNB) — all four showing real, deep, unambiguous pools.
 */
export const TRUSTED_QUOTE_ASSETS: Record<string, string> = {
  USDT: "0x55d398326f99059ff775485246999027b3197955",
  USDC: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  BUSD: "0xe9e7cea3dedca5984780bafc599bd69add087d56",
  WBNB: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
};

const TRUSTED_QUOTE_ADDRESSES = new Set(Object.values(TRUSTED_QUOTE_ASSETS));

/** Minimal shape this module needs from a DexScreener pair — structurally compatible with (a subset of) DexScreenerPair, kept separate so this file has zero imports. */
export interface TrustedQuoteCandidatePair {
  pairAddress: string;
  dexId: string;
  quoteToken: { address: string; symbol: string };
  liquidity?: { usd?: number };
  /** DexScreener's own AMM-version tag for this pair (e.g. ["v2"], ["v3"]) — see module doc: a pancakeswap pair qualifies with either label, since Smart Router executes through both. Kept on the type (not removed) because it's still useful for diagnostics/logging even though it no longer gates qualification. */
  labels?: string[];
  /** DexScreener's own quoted price for this pair, as a decimal string. Carried through so callers needing "this wrapper's price" can use the SAME trusted, non-spam pair this module already selected for TVL — see dexscreener.ts's getDexScreenerSummary(), which previously read price from a separately-selected "deepest pair regardless of quote asset" and could pick up a near-worthless, untrusted-quote pair's price instead. */
  priceUsd?: string;
}

const EXECUTABLE_DEX_ID = "pancakeswap";

/**
 * True for a pair that PancakeSwap's Smart Router (spotPurchaseClient.ts's
 * getSmartRouterTrade) can actually route through: it must be on
 * PancakeSwap itself — a different DEX's fork lives in a different
 * Factory Smart Router has no knowledge of, regardless of its own
 * V2/V3 labeling. V2 and V3 pairs are both accepted (see module doc).
 */
function isSmartRouterExecutablePair(p: TrustedQuoteCandidatePair): boolean {
  return p.dexId?.toLowerCase() === EXECUTABLE_DEX_ID;
}

export type TrustedQuoteLiquidityResult =
  | {
      status: "found";
      tvlUsd: number;
      /** This same pair's quoted price, in USD — see priceUsd on TrustedQuoteCandidatePair for why this must come from the trusted pair, not a separately-selected one. */
      priceUsd: number;
      pairAddress: string;
      dexId: string;
      quoteSymbol: string;
      quoteAddress: string;
      source: "dexscreener";
    }
  | {
      status: "no_qualifying_pair";
      reason: string;
      source: "dexscreener";
    };

/**
 * Selects the single legitimate, deepest pair from `pairs` (already
 * filtered to one chain by the caller) whose quote asset is trusted —
 * verified by the quote token's ADDRESS against TRUSTED_QUOTE_ASSETS, not
 * a string match on its symbol/name (a spoofed token can claim to be
 * "USDT" in its metadata; it cannot reuse the real USDT contract address).
 *
 * Never aggregates across pairs — picks exactly one (the deepest
 * qualifying one). Pairs with a zero/missing/non-numeric TVL, or whose
 * quote address isn't in the trusted set, are excluded entirely rather
 * than counted as zero. Also excludes any pair on a DEX other than
 * PancakeSwap, since that's what this app's Smart-Router-based execution
 * actually knows how to route through (see module doc — this is what
 * makes liquidity checks/quotes consistent with execution).
 */
export function selectTrustedQuotePool(pairs: TrustedQuoteCandidatePair[]): TrustedQuoteLiquidityResult {
  if (pairs.length === 0) {
    return { status: "no_qualifying_pair", reason: "No pairs were provided for this token at all.", source: "dexscreener" };
  }

  const trustedQuote = pairs.filter((p) => {
    const quoteAddress = p.quoteToken?.address?.toLowerCase();
    const tvl = p.liquidity?.usd;
    return (
      quoteAddress !== undefined &&
      TRUSTED_QUOTE_ADDRESSES.has(quoteAddress) &&
      typeof tvl === "number" &&
      Number.isFinite(tvl) &&
      tvl > 0
    );
  });

  const qualifying = trustedQuote.filter(isSmartRouterExecutablePair);

  if (qualifying.length === 0) {
    if (trustedQuote.length > 0) {
      return {
        status: "no_qualifying_pair",
        reason: `${trustedQuote.length} pair(s) quoted against a trusted asset were found, but none are on PancakeSwap — this app's Smart-Router-based execution cannot route through other DEXes' pools.`,
        source: "dexscreener",
      };
    }
    return {
      status: "no_qualifying_pair",
      reason: `${pairs.length} pair(s) were provided, but none are quoted against a trusted asset (USDT/USDC/BUSD/WBNB) by address.`,
      source: "dexscreener",
    };
  }

  const deepest = qualifying.reduce((best, p) => ((p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best));

  return {
    status: "found",
    tvlUsd: deepest.liquidity!.usd!,
    priceUsd: Number(deepest.priceUsd),
    pairAddress: deepest.pairAddress,
    dexId: deepest.dexId,
    quoteSymbol: deepest.quoteToken.symbol,
    quoteAddress: deepest.quoteToken.address,
    source: "dexscreener",
  };
}
