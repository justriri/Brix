import { getBinanceRwaStocksForTicker, type BinanceRwaStockResult } from "@/lib/providers/binanceRwaStock";
import { getAllWrappersForTicker } from "@/lib/providers";
import { runSafetyGate } from "@/lib/safety/safetyGate";
import { SUPPORTED_TICKERS, type SupportedTicker } from "@/lib/config/assets";
import type { SafetyGateResult, TokenizedStock } from "@/lib/types";

/**
 * Incremental Binance-RWA-sourced Safety Gate integration (TSLA only, per
 * the integration brief). Reuses the EXISTING, unmodified runSafetyGate —
 * this file only fetches + normalizes data and decides what counts as
 * "the other wrappers" for the cross-wrapper check; it contains no Safety
 * Gate logic of its own.
 *
 * Cross-wrapper consistency is computed ONLY against wrappers Binance's
 * own search actually returned for this ticker on BSC — never against
 * xStocks (not exposed by this API) and never against the separate
 * DexScreener-sourced bstocks.ts/ondo.ts providers, which would silently
 * mix two different data sources' notion of "price" into one comparison.
 */

export interface BinanceRwaAssessment {
  stock: TokenizedStock;
  safetyGateResult: SafetyGateResult;
}

export interface BinanceRwaAssessmentResult {
  assessments: BinanceRwaAssessment[];
  warnings: string[];
}

export async function assessTickerViaBinanceRwa(ticker: string): Promise<BinanceRwaAssessmentResult> {
  const { results, warnings } = await getBinanceRwaStocksForTicker(ticker);

  const assessments: BinanceRwaAssessment[] = results.map(({ stock }: BinanceRwaStockResult) => {
    const otherWrappers = results.filter((r) => r.stock.wrapper !== stock.wrapper).map((r) => r.stock);
    const safetyGateResult = runSafetyGate(stock, otherWrappers);
    return { stock, safetyGateResult };
  });

  return { assessments, warnings };
}

/**
 * Fallback discovery path: the EXISTING, independent DexScreener-based
 * pipeline (providers/bstocks.ts / ondo.ts, via getAllWrappersForTicker —
 * the same one the wallet-connected Portfolio section already uses),
 * reused here only when Binance's RWA Search has returned nothing for a
 * ticker (see assessTickerWithFallback below). xStocks is deliberately
 * excluded, same as the Binance-RWA path above — see
 * lib/invest/intelligence/candidateDiscovery.ts's own doc comment (build
 * brief Phase 1 §1: xStocks is never a discoverable/purchasable candidate
 * here).
 */
async function assessTickerViaDexScreenerFallback(ticker: SupportedTicker): Promise<BinanceRwaAssessmentResult> {
  const all = await getAllWrappersForTicker(ticker);
  const candidates = all.filter((s) => s.wrapper !== "xstocks");

  const assessments: BinanceRwaAssessment[] = candidates.map((stock) => {
    const otherWrappers = candidates.filter((o) => o.wrapper !== stock.wrapper);
    return { stock, safetyGateResult: runSafetyGate(stock, otherWrappers) };
  });

  return { assessments, warnings: [] };
}

/**
 * Tries Binance RWA first; falls back to the independent DexScreener-based
 * pipeline ONLY when Binance returned zero wrappers for this ticker (a
 * search failure, a transport error, or Binance genuinely having no BSC
 * listing for it) — never the other way around, and never blended: each
 * ticker's wrappers all come from ONE source, so a cross-wrapper
 * comparison never silently mixes two different providers' notion of
 * "price" for the same ticker.
 *
 * This exists because the Markets feed (discoverCandidates(), called by
 * /api/investment-intelligence) previously depended ENTIRELY on Binance's
 * RWA Search being reachable — when that ONE upstream failed for every
 * ticker (live-diagnosed: a transport-level failure to web3.binance.com,
 * confirmed via repeated, isolated, direct calls — not a bug in this
 * codebase), the ENTIRE feed went empty, even though the independent
 * DexScreener-based pipeline (already proven live, already used by the
 * Portfolio section) was still reachable. A single upstream going down
 * must degrade the feed, not erase it.
 */
export async function assessTickerWithFallback(ticker: string): Promise<BinanceRwaAssessmentResult> {
  const primary = await assessTickerViaBinanceRwa(ticker);
  if (primary.assessments.length > 0 || !SUPPORTED_TICKERS.includes(ticker as SupportedTicker)) {
    return primary;
  }

  const fallback = await assessTickerViaDexScreenerFallback(ticker as SupportedTicker);
  const warnings = [
    ...primary.warnings,
    ...fallback.warnings,
    fallback.assessments.length > 0
      ? `Binance RWA data was unavailable for ${ticker}; showing data from the independent DexScreener-based pipeline instead.`
      : `No tokenized-stock data is available for ${ticker} from either Binance RWA or the DexScreener-based pipeline right now.`,
  ];
  return { assessments: fallback.assessments, warnings };
}
