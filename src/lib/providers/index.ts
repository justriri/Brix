import { SUPPORTED_TICKERS, type SupportedTicker } from "@/lib/config/assets";
import { getBstocksStock } from "@/lib/providers/bstocks";
import { getOndoStock } from "@/lib/providers/ondo";
import { getXstocksStock } from "@/lib/providers/xstocks";
import type { TokenizedStock } from "@/lib/types";

export { SUPPORTED_TICKERS };
export type { SupportedTicker };

/**
 * Fetches every wrapper's view of one underlying ticker in parallel:
 * bStocks (BSC position source), Ondo (BSC position source), and xStocks
 * (reference-only — see providers/xstocks.ts for why it is not a BSC
 * position source).
 */
export async function getAllWrappersForTicker(ticker: SupportedTicker): Promise<TokenizedStock[]> {
  const [bstocks, ondo, xstocks] = await Promise.all([
    getBstocksStock(ticker),
    getOndoStock(ticker),
    getXstocksStock(ticker),
  ]);
  return [bstocks, ondo, xstocks];
}

/** Fetches every wrapper's view of every supported ticker (used by the dashboard's market overview). */
export async function getAllSupportedStocks(): Promise<TokenizedStock[]> {
  const results = await Promise.all(SUPPORTED_TICKERS.map((t) => getAllWrappersForTicker(t)));
  return results.flat();
}
