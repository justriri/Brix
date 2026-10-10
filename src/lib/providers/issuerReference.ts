// Relative, with explicit extensions — keeps this module (specifically its
// pure parseOndoIssuerReference()) resolvable by Node's test runner
// directly; see issuerReference.test.mts.
import { getUnderlyingMarket, isBinanceRwaConfigured, toNumber, type BinanceRwaUnderlyingMarket } from "./binanceRwa.ts";
import type { ReferenceSource } from "@/lib/types";
import { isWeekendGuardError } from "../errors.ts";

/**
 * Fallback #2 in the reference-price hierarchy (see providers/reference.ts
 * for the full primary -> fallback -> issuer order): an authoritative,
 * issuer-side reference price, used ONLY when Pyth (the primary/fallback
 * independent reference) is unavailable — e.g. the configured
 * PYTH_API_KEY's entitlements don't cover a given ticker's feed (confirmed
 * live during this investigation: AAPL/NVDA's Equity.US feeds, and EVERY
 * ticker's Equity.Index/24-7 feed including TSLA's, return HTTP 403 "Not
 * entitled" under the key configured for this build — a Pyth account/plan
 * limitation, not a bug in the feed IDs, endpoint, or parsing, all of
 * which are confirmed correct since TSLA's Equity.US feed DOES work with
 * the exact same key/code path).
 *
 * ONDO-ONLY, BY LIVE-VERIFIED DESIGN, NOT AN OVERSIGHT: Binance's RWA Data
 * API's `/underlying-market` endpoint (a SEPARATE pipeline from `/price`'s
 * `referencePrice`, which providers/binanceRwaStock.ts already documented
 * as NOT independent — sometimes numerically identical to tokenPrice)
 * returns a genuinely distinct `marketData.referencePrice` for Ondo
 * platform tokens (live-verified: differs from both tokenPrice and
 * /price's own referencePrice by a small but real margin, e.g. AAPL.ondo:
 * tokenPrice=341.51, /price referencePrice=340.36, /underlying-market
 * referencePrice=339.21 — three distinct numbers, not a re-derivation).
 * For bStocks tokens, the SAME endpoint returns `marketData.referencePrice:
 * null` for every bStocks ticker tested (TSLA/AAPL/NVDA) — there is no
 * issuer-side reference available for bStocks via this API at all. Never
 * use Ondo's reference for a bStocks (or xStocks) position — a different
 * wrapper's price is a different, non-fungible instrument (see
 * safety/wrapperConsistency.ts for the same principle applied to
 * cross-wrapper comparison).
 *
 * KNOWN LIMITATION, surfaced rather than hidden: this endpoint has no
 * per-field timestamp for `marketData.referencePrice` (confirmed absent
 * from the schema — see binanceRwa.ts's BinanceRwaUnderlyingMarketData).
 * Freshness here can only mean "as of this live HTTP call," the same
 * caveat that already applies to stock.price itself (DexScreener has no
 * separate price-age field either) — not a fabricated timestamp, but a
 * real gap worth knowing about before relying on this path heavily.
 */

export interface IssuerReferenceResult {
  reference?: ReferenceSource;
  unavailableReason?: string;
}

/**
 * Pure validation of a raw `/underlying-market` response — separated from
 * the network call so it's directly unit-testable (malformed/missing/
 * non-numeric/non-positive cases) without mocking fetch.
 */
export function parseOndoIssuerReference(market: Pick<BinanceRwaUnderlyingMarket, "marketData" | "platformId">): IssuerReferenceResult {
  if (market.platformId !== "ondo") {
    return { unavailableReason: `No issuer reference price is available for platform "${market.platformId}" — this fallback is Ondo-only (see module doc).` };
  }
  const price = toNumber(market.marketData?.referencePrice ?? null);
  if (price === undefined || !(price > 0)) {
    return { unavailableReason: "Binance RWA's underlying-market reference price is missing or not a valid positive number for this asset." };
  }
  return {
    reference: {
      name: "Binance RWA underlying-market (Ondo issuer reference)",
      price,
      // No per-field timestamp exists on this endpoint — see module doc.
      // Honest about what this means: "as of right now," not a stored age.
      publishTimeSec: Math.floor(Date.now() / 1000),
      isAlwaysOn: true,
    },
  };
}

/**
 * Fetches and validates the Ondo issuer reference price for one token.
 * Returns an unavailableReason (never throws, never fabricates) for every
 * failure mode: not configured, transport/API failure, or a value that
 * fails parseOndoIssuerReference's validation.
 */
export async function getOndoIssuerReference(tokenContractAddress: string, binanceChainId: string | number): Promise<IssuerReferenceResult> {
  if (!isBinanceRwaConfigured()) {
    return { unavailableReason: "BINANCE_WEB3_API_KEY/BINANCE_WEB3_SECRET are not configured; no issuer reference fallback is available." };
  }
  try {
    const market = await getUnderlyingMarket({ tokenContractAddress, binanceChainId });
    return parseOndoIssuerReference(market);
  } catch (err) {
    return { unavailableReason: isWeekendGuardError(err) ? err.message : "Unexpected error fetching the Binance RWA issuer reference price." };
  }
}
