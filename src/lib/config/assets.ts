/**
 * Verified tokenized-stock registry for the WeekendGuard MVP.
 *
 * Scope is deliberately small (research memo: "prefer 2-3 well-supported
 * tokenized stocks with reliable data" over a huge asset universe).
 *
 * IMPORTANT — provenance of every address below:
 * Every BSC contract address here was independently re-verified live via
 * the public DexScreener API (https://api.dexscreener.com/latest/dex/tokens/<address>)
 * during this build session, returning real PancakeSwap/Uniswap pairs with
 * live price/liquidity. Re-verify before any mainnet financial deployment
 * regardless.
 *
 * CORRECTION (logged here deliberately, not silently fixed): an earlier
 * version of this file excluded xStocks entirely as "not live on BSC,"
 * based on DexScreener's fuzzy /search endpoint returning only Solana
 * pairs for "TSLAx"/"AAPLx". That was a methodology error, not a fact —
 * /search ranks by relevance/volume and xStocks' BSC liquidity is thin
 * enough to be crowded out of the top results. A DIRECT address lookup
 * (not a text search) confirms real BSC pairs exist for at least
 * SPCXx (0x68fa48B1C2FE52b3D776E1953e0E782b5044Ce28, per BNB Chain's own
 * "BNB Street" blog post) and TSLAx (0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0,
 * found via a corrected full-result-set DexScreener search). See
 * providers/xstocks.ts for how AAPL/NVDA are handled given no BSC address
 * for those two could be confirmed in this pass — they are NOT assumed
 * absent, they are explicitly marked unconfirmed.
 */

export type SupportedTicker = "TSLA" | "AAPL" | "NVDA";

export const SUPPORTED_TICKERS: SupportedTicker[] = ["TSLA", "AAPL", "NVDA"];

export interface BscTokenEntry {
  ticker: SupportedTicker;
  symbol: string;
  name: string;
  tokenAddress: `0x${string}`;
  /** Verified via api.dexscreener.com/latest/dex/tokens/<address> during this build session. */
  verifiedVia: "dexscreener-live-lookup";
}

/**
 * bStocks (Binance-affiliated, BTECH Holdings Ltd, BEP-20) tokens confirmed
 * live on BSC mainnet. Source: docs.bstocker.finance + live DexScreener
 * lookup. Note: bStocks tokens rebase on dividend payment (see research
 * report) — balance polling must account for this, not treat rebases as
 * trades.
 */
export const BSTOCKS_TOKENS: Record<SupportedTicker, BscTokenEntry> = {
  TSLA: {
    ticker: "TSLA",
    symbol: "TSLAB",
    name: "Tesla, Inc. (bStocks)",
    tokenAddress: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f",
    verifiedVia: "dexscreener-live-lookup",
  },
  NVDA: {
    ticker: "NVDA",
    symbol: "NVDAB",
    name: "NVIDIA Corp (bStocks)",
    tokenAddress: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436",
    verifiedVia: "dexscreener-live-lookup",
  },
  AAPL: {
    ticker: "AAPL",
    symbol: "AAPLB",
    name: "Apple Inc. (bStocks)",
    tokenAddress: "0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A",
    verifiedVia: "dexscreener-live-lookup",
  },
};

/**
 * Ondo Global Markets ("Ondo Stocks") tokens confirmed live on BSC mainnet.
 * Source: BNB Chain blog (native BSC launch, Oct 29 2025) + live DexScreener
 * lookup. Note: Ondo token price = underlying price x SyntheticSharesOracle
 * multiplier, so it is not a fixed 1:1 share peg — see research report.
 */
export const ONDO_TOKENS: Record<SupportedTicker, BscTokenEntry> = {
  TSLA: {
    ticker: "TSLA",
    symbol: "TSLAon",
    name: "Tesla, Inc. (Ondo Tokenized)",
    tokenAddress: "0x2494b603319d4D9F9715c9f4496d9E0364B59d93",
    verifiedVia: "dexscreener-live-lookup",
  },
  NVDA: {
    ticker: "NVDA",
    symbol: "NVDAon",
    name: "NVIDIA Corp (Ondo Tokenized)",
    tokenAddress: "0xA9eE28C80f960B889dFbd1902055218cBa016F75",
    verifiedVia: "dexscreener-live-lookup",
  },
  AAPL: {
    ticker: "AAPL",
    symbol: "AAPLon",
    name: "Apple Inc. (Ondo Tokenized)",
    tokenAddress: "0x390a684EF9cADE28A7AD0DFa61AB1Eb3842618c4",
    verifiedVia: "dexscreener-live-lookup",
  },
};

/**
 * Pyth Network price feed IDs, live-verified via the public, no-key
 * `GET https://hermes.pyth.network/v2/price_feeds?query=<ticker>` metadata
 * endpoint during this build session (2026-09-29). Fetching the *current
 * price* for these IDs (not just their metadata) requires a Pyth API key
 * as of the Aug 26 2026 "Pyth Core" upgrade — see providers/pyth.ts.
 *
 * usEquity        -> Equity.US.<TICKER>/USD   (real market-hours-aware feed; closed on weekends)
 * equityIndex247  -> Equity.Index.<TICKER>/USD (Pyth's own continuous 24/7 synthetic price)
 * xstock          -> Crypto.<TICKER>X/USD     (the xStocks wrapper's own price, cross-chain)
 * ondo            -> Crypto.<TICKER>ON/USD    (the Ondo tokenized wrapper's own price, cross-chain)
 */
export const PYTH_FEEDS: Record<
  SupportedTicker,
  { usEquity: string; equityIndex247: string; xstock: string; ondo: string }
> = {
  TSLA: {
    usEquity: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    equityIndex247: "e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0",
    xstock: "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362",
    ondo: "c09ef687ed07091c047da444f1499f2da52cdc1c085104643ec565a9eb1af514",
  },
  AAPL: {
    usEquity: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
    equityIndex247: "aaba35e6f33fb973bb2201d48a79ae24795affa6ba8bd50a93dcaf7da0030f36",
    xstock: "978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675",
    ondo: "e6734de88a83d9d2fb33072adab319004700aefd069653aba30ba9e3cac056f2",
  },
  NVDA: {
    usEquity: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    equityIndex247: "a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852",
    xstock: "4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f",
    ondo: "207ddea2a443d30b7e13a7c88a9e3f106765deb97049afc65a18cede50fffc82",
  },
};

/**
 * xStocks BSC contract addresses CONFIRMED via direct DexScreener address
 * lookup during this build session (2026-09-29) — not via the unreliable
 * fuzzy-search method that missed them originally. Only tickers with a
 * confirmed address are listed; AAPL and NVDA are deliberately absent
 * (not found in a corrected search — see providers/xstocks.ts for how
 * that absence is surfaced, honestly, rather than guessed at).
 */
export const XSTOCKS_TOKENS_CONFIRMED_BSC: Partial<Record<SupportedTicker, BscTokenEntry>> = {
  TSLA: {
    ticker: "TSLA",
    symbol: "TSLAx",
    name: "Tesla, Inc. (xStocks)",
    tokenAddress: "0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0",
    verifiedVia: "dexscreener-live-lookup",
  },
};

export const BSC_MAINNET_CHAIN_ID = 56;

export const BSC_PUBLIC_RPC_URLS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
];
