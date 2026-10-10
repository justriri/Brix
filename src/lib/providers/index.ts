import { SUPPORTED_TICKERS, type SupportedTicker } from "@/lib/config/assets";
import { getBstocksStock } from "@/lib/providers/bstocks";
import { getOndoStock } from "@/lib/providers/ondo";
import { getXstocksStock } from "@/lib/providers/xstocks";
import type { TokenizedStock, Wrapper } from "@/lib/types";

export { SUPPORTED_TICKERS };
export type { SupportedTicker };

const WRAPPER_FETCHERS: Array<{ wrapper: Wrapper; fetch: (ticker: SupportedTicker) => Promise<TokenizedStock> }> = [
  { wrapper: "bstocks", fetch: getBstocksStock },
  { wrapper: "ondo", fetch: getOndoStock },
  { wrapper: "xstocks", fetch: getXstocksStock },
];

/** A wrapper whose fetch itself threw, rather than returning a normal "health: failed/unknown" TokenizedStock — kept visible rather than silently dropped, so the market overview can show exactly which wrapper is unavailable instead of quietly shrinking the list. */
function unavailableStock(ticker: SupportedTicker, wrapper: Wrapper, err: unknown): TokenizedStock {
  return {
    underlying: ticker,
    name: ticker,
    wrapper,
    chain: "unknown",
    health: "unknown",
    source: "error",
    notes: [`This wrapper's data could not be fetched: ${err instanceof Error ? err.message : "unexpected error"}.`],
  };
}

/**
 * Fetches every wrapper's view of one underlying ticker in parallel:
 * bStocks (BSC position source), Ondo (BSC position source), and xStocks
 * (reference-only — see providers/xstocks.ts for why it is not a BSC
 * position source).
 *
 * PRODUCTION RESILIENCE: every individual getXStock() function already
 * catches its own internal errors and returns a "health: failed/unknown"
 * TokenizedStock rather than throwing (see wrapperCommon.ts/xstocks.ts).
 * This uses Promise.allSettled rather than Promise.all anyway, as a second
 * layer of defense: if a wrapper function were ever changed in a way that
 * reintroduces an uncaught throw, one wrapper's failure still must not
 * take down the other two wrappers' real, working data for this ticker.
 */
export async function getAllWrappersForTicker(ticker: SupportedTicker): Promise<TokenizedStock[]> {
  const results = await Promise.allSettled(WRAPPER_FETCHERS.map(({ fetch }) => fetch(ticker)));
  return results.map((result, i) =>
    result.status === "fulfilled" ? result.value : unavailableStock(ticker, WRAPPER_FETCHERS[i].wrapper, result.reason)
  );
}

/**
 * Fetches every wrapper's view of every supported ticker (used by the
 * dashboard's market overview).
 *
 * PRODUCTION FIX: this previously used Promise.all across tickers, which
 * meant a single uncaught exception anywhere in ONE ticker's fetch chain
 * failed the ENTIRE market overview — every ticker, every wrapper — into
 * a single 502 "unavailable" response. getAllWrappersForTicker() above is
 * now itself resilient per-wrapper, but Promise.allSettled is used here
 * too so a future regression in one ticker degrades to "this ticker is
 * unavailable" rather than "the whole market view is unavailable."
 */
export async function getAllSupportedStocks(): Promise<TokenizedStock[]> {
  const results = await Promise.allSettled(SUPPORTED_TICKERS.map((t) => getAllWrappersForTicker(t)));
  return results.flatMap((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const ticker = SUPPORTED_TICKERS[i];
    return WRAPPER_FETCHERS.map(({ wrapper }) => unavailableStock(ticker, wrapper, result.reason));
  });
}
