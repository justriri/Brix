import { PYTH_FEEDS, XSTOCKS_TOKENS_CONFIRMED_BSC, type SupportedTicker } from "@/lib/config/assets";
import { getPythLatestPrice, isPythConfigured } from "@/lib/providers/pyth";
import { buildBscWrapperStock } from "@/lib/providers/wrapperCommon";
import type { TokenizedStock } from "@/lib/types";
import { isWeekendGuardError } from "@/lib/errors";

/**
 * xStocks provider — CORRECTED after independent re-verification.
 *
 * An earlier version of this file treated xStocks as categorically absent
 * from BSC, based on DexScreener's fuzzy /search endpoint surfacing only
 * Solana pairs for "TSLAx"/"AAPLx". That was a methodology bug: /search
 * ranks by relevance/volume, and xStocks' BSC liquidity is thin enough
 * (single/double-digit USD, per live data below) to be crowded out of the
 * top results a text search returns. A direct address lookup tells a
 * different story: real BSC PancakeSwap/Uniswap pairs exist for at least
 * SPCXx (BNB Chain's own "BNB Street" blog post gives its address) and
 * TSLAx (found via a corrected, full-result-set search) — see
 * lib/config/assets.ts for exact addresses and provenance.
 *
 * This does NOT mean every xStocks ticker is on BSC, or that BSC xStocks
 * liquidity is comparable to bStocks/Ondo. For our 3 supported tickers:
 *   - TSLA: confirmed BSC address, but real observed liquidity is in the
 *     single-to-double-digit USD range — expect the Safety Gate's
 *     liquidity check to correctly FAIL this wrapper, not a bug.
 *   - AAPL / NVDA: NO confirmed BSC address was found (not in the top 30
 *     DexScreener BSC results for "AAPLx"/"NVDAx"). This is surfaced as
 *     "unconfirmed," never silently treated as "definitely absent" or
 *     papered over with a fabricated address.
 *
 * Separately: three independent teams building for this same hackathon
 * (see their public repos) each hit their own friction getting xStocks
 * data through Binance's official aggregated RWA API specifically —
 * one found it missing from the official token list entirely, one left
 * its platform filter disabled pending confirmation, one found it listed
 * but returning stale prices with no timestamp and spurious liquidity
 * errors. So even where xStocks IS on BSC, treat any single source's
 * xStocks price (including this provider's own DexScreener-derived one)
 * with more skepticism than bStocks/Ondo — which is exactly what the
 * Safety Gate's liquidity/freshness checks are for.
 */
export async function getXstocksStock(ticker: SupportedTicker): Promise<TokenizedStock> {
  const confirmedEntry = XSTOCKS_TOKENS_CONFIRMED_BSC[ticker];

  if (!confirmedEntry) {
    return getXstocksUnconfirmedOnBsc(ticker);
  }

  const stock = await buildBscWrapperStock(ticker, confirmedEntry, "xstocks");
  return {
    ...stock,
    notes: [
      ...(stock.notes ?? []),
      "xStocks-on-BSC liquidity has been observed to be very thin for this ticker relative to bStocks/Ondo — expect the liquidity check to legitimately gate this wrapper out rather than treating that as an error.",
    ],
  };
}

/**
 * For tickers with no confirmed BSC address (AAPL, NVDA as of this build):
 * report the position as genuinely absent from a BSC wallet (there is
 * nothing to hold), while still surfacing Pyth's cross-chain xStocks price
 * as a labelled reference/comparison point — never as something a BSC
 * wallet could actually be holding.
 */
async function getXstocksUnconfirmedOnBsc(ticker: SupportedTicker): Promise<TokenizedStock> {
  const feeds = PYTH_FEEDS[ticker];
  const notes = [
    `No xStocks BSC contract address for ${ticker} could be confirmed (checked via direct DexScreener search of the full result set) — this does not prove one doesn't exist, only that it wasn't found. Treated as unconfirmed, not fabricated.`,
  ];

  if (!isPythConfigured()) {
    return {
      underlying: ticker,
      name: `${ticker} (xStocks, BSC status unconfirmed)`,
      wrapper: "xstocks",
      chain: "unknown",
      health: "unknown",
      source: "unconfirmed",
      notes: [...notes, "PYTH_API_KEY is not configured, so no cross-chain reference price is available either."],
    };
  }

  try {
    const ref = await getPythLatestPrice(feeds.xstock, `Crypto.${ticker}X/USD`);
    return {
      underlying: ticker,
      name: `${ticker} (xStocks, BSC status unconfirmed)`,
      wrapper: "xstocks",
      chain: "unknown",
      price: undefined, // deliberately not set to ref.price: this is a cross-chain price, not confirmed to be this wrapper's BSC price
      referencePrice: ref.price,
      referenceSource: ref,
      priceAgeSeconds: Math.max(0, Math.floor(Date.now() / 1000) - ref.publishTimeSec),
      health: "unknown",
      source: "pyth:cross-chain-reference-only",
      notes,
    };
  } catch (err) {
    return {
      underlying: ticker,
      name: `${ticker} (xStocks, BSC status unconfirmed)`,
      wrapper: "xstocks",
      chain: "unknown",
      health: "unknown",
      source: "pyth:error",
      notes: [...notes, isWeekendGuardError(err) ? err.message : "Unexpected error fetching xStocks reference price."],
    };
  }
}
