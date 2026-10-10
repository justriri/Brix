import {
  getRwaPrice,
  getUnderlyingMarket,
  getUnderlyingProfile,
  isBinanceRwaConfigured,
  mapRwaPlatformIdToWrapper,
  searchRwaTicker,
  toNumber,
  type BinanceRwaPriceEntry,
  type BinanceRwaSearchAsset,
  type BinanceRwaUnderlyingMarket,
} from "@/lib/providers/binanceRwa";
import { getReferenceForTicker, type ReferenceResult } from "@/lib/providers/reference";
import { parseTokenPriceUpdatedAt } from "@/lib/providers/binanceRwaTimestamp";
import { getTrustedQuoteLiquidity } from "@/lib/providers/dexscreener";
import { getErc20Decimals } from "@/lib/chain";
import type { Address } from "viem";
import { getUsEquityMarketStatus } from "@/lib/marketCalendar";
import { SAFETY_THRESHOLDS } from "@/lib/safety/thresholds";
import { SUPPORTED_TICKERS, type SupportedTicker } from "@/lib/config/assets";
import type { ReferenceSource, TokenizedStock } from "@/lib/types";
import { isWeekendGuardError } from "@/lib/errors";

/**
 * Normalizes Binance Web3 RWA Data into WeekendGuard's existing
 * TokenizedStock shape, so the EXISTING Safety Gate (safety/safetyGate.ts)
 * can consume it unmodified — this file is the only thing that knows
 * Binance's field names; everything downstream just sees a TokenizedStock.
 *
 * Additional, separate provider path — NOT a replacement for
 * providers/bstocks.ts / ondo.ts (the DexScreener-based position-detection
 * path used by the wallet-connected dashboard). Per the integration brief:
 * "keep the existing provider abstraction so the Safety Gate isn't
 * permanently coupled to Binance."
 *
 * BSC-only, and only for the two platformIds confirmed live ("bstock",
 * "ondo") — xStocks is confirmed NOT exposed by this API and is never
 * added here speculatively.
 */

const BSC_CHAIN_ID_STRING = "56";
const SUPPORTED_RWA_PLATFORM_IDS = new Set(["bstock", "ondo"]);

export interface BinanceRwaStockResult {
  stock: TokenizedStock;
  rawAsset: BinanceRwaSearchAsset;
}

export interface BinanceRwaFetchResult {
  results: BinanceRwaStockResult[];
  /** Non-fatal issues (missing config, a sub-call failing for one token) surfaced for the UI/caller — never silently swallowed. */
  warnings: string[];
}

/**
 * Fetches every BSC bStocks/Ondo representation of `ticker` via the
 * Binance RWA Data API (search -> price -> underlying-market, all
 * LIVE-VERIFIED shapes — see providers/binanceRwa.ts) and normalizes each
 * into a TokenizedStock:
 *
 *  - price            <- /price's tokenPrice (the on-chain token price)
 *  - referencePrice    <- an INDEPENDENT Pyth TSLA/USD price (see below) —
 *                      NEVER Binance's own `referencePrice` field
 *  - priceAgeSeconds  <- derived from /price's tokenPriceUpdatedAt (ms epoch,
 *                      confirmed present on /price specifically — NOT on
 *                      /tokens or /underlying-market). This is BINANCE's own
 *                      token-price freshness, unrelated to the Pyth
 *                      reference's freshness below.
 *  - liquidityUsd      <- NOT from Binance (confirmed absent from every
 *                      endpoint's schema: search, price, underlying-market).
 *                      Instead sourced from the EXISTING DexScreener
 *                      integration, restricted to the single deepest BSC
 *                      pool for this exact token address whose quote asset
 *                      is a trusted, address-verified stable/major asset
 *                      (USDT/USDC/BUSD/WBNB) — see
 *                      providers/dexscreener.ts's getTrustedQuoteLiquidity().
 *                      This is POOL TVL (both sides of that one pool
 *                      combined), never aggregated across pairs, and never
 *                      described as executable depth — see
 *                      safety/liquidity.ts for why that distinction matters.
 *  - marketStatus      NOT set from Binance's statusInfo — the Safety
 *                      Gate's own self-computed NYSE calendar remains
 *                      authoritative (safety/marketStatus.ts). Binance's
 *                      raw statusInfo is surfaced in `notes` only.
 *
 * WHY stock.referencePrice IS NEVER SET FROM BINANCE'S OWN FIELD:
 * Confirmed LIVE during this build: for one bStocks token, Binance's
 * `referencePrice` was numerically IDENTICAL to `tokenPrice` — something
 * that cannot happen with a truly independent market quote, and consistent
 * with the official docs' own description of the field as "derived from
 * the on-chain token price," not independently sourced. It is surfaced
 * only in `notes`, never wired into the check.
 *
 * THE INDEPENDENT REFERENCE USED INSTEAD: Pyth Network's TSLA/USD feed
 * (lib/providers/pyth.ts + reference.ts — the SAME primary/fallback logic
 * already used by the DexScreener-based wrappers, reused here unmodified).
 * It is only accepted as `stock.referencePrice` when it is BOTH present
 * AND fresh enough per the existing SAFETY_THRESHOLDS (the identical
 * open/closed-market age limits the priceFreshness check already applies)
 * — a stale or unavailable Pyth reference is left out entirely rather than
 * being supplied anyway, so the existing (unmodified) referenceDeviation
 * check naturally reports UNKNOWN per its own missing-input branch. No
 * Safety Gate logic needed to change for this.
 */
export async function getBinanceRwaStocksForTicker(ticker: string): Promise<BinanceRwaFetchResult> {
  if (!isBinanceRwaConfigured()) {
    return {
      results: [],
      warnings: ["BINANCE_WEB3_API_KEY/BINANCE_WEB3_SECRET are not configured — Binance RWA data is unavailable."],
    };
  }

  const warnings: string[] = [];

  let searchResults;
  try {
    searchResults = await searchRwaTicker(ticker);
  } catch (err) {
    return {
      results: [],
      warnings: [isWeekendGuardError(err) ? `RWA search failed: ${err.message}` : "RWA search failed unexpectedly."],
    };
  }

  // /search returns one entry per matched company; find the one matching
  // our ticker exactly (case-insensitive) rather than assuming index 0.
  const match = searchResults.find((r) => r.ticker.toUpperCase() === ticker.toUpperCase());
  const assets: BinanceRwaSearchAsset[] = match?.assets ?? [];

  const bscAssets = assets.filter(
    (a) => String(a.binanceChainId) === BSC_CHAIN_ID_STRING && SUPPORTED_RWA_PLATFORM_IDS.has(a.platformId)
  );

  if (bscAssets.length === 0) {
    warnings.push(`Binance RWA search for "${ticker}" returned no BSC bStocks/Ondo tokens.`);
  }

  // Fetched PER ASSET, not once per ticker — the tier-3 issuer fallback
  // (see providers/reference.ts / issuerReference.ts) is wrapper-specific
  // (Ondo-only), so bStocks' and Ondo's reference lookups can legitimately
  // diverge once Pyth is unavailable: bStocks correctly gets no fallback,
  // Ondo correctly can. When Pyth itself answers (tiers 1-2), both wrappers
  // still get the same Pyth price in practice (same feed id), just via two
  // separate calls instead of one shared one — a trivial efficiency cost
  // for correct per-wrapper fallback scoping. Only attempted for tickers
  // Pyth's feed registry actually covers (lib/config/assets.ts PYTH_FEEDS)
  // — currently TSLA/AAPL/NVDA.
  const tickerIsPythCovered = SUPPORTED_TICKERS.includes(ticker as SupportedTicker);

  const results = await Promise.all(
    bscAssets.map(async (asset) => {
      let reference: ReferenceResult | undefined;
      if (tickerIsPythCovered) {
        reference = await getReferenceForTicker(ticker as SupportedTicker, {
          wrapper: mapRwaPlatformIdToWrapper(asset.platformId),
          tokenContractAddress: asset.tokenContractAddress,
          binanceChainId: asset.binanceChainId,
        });
      }
      return normalizeOneAsset(ticker, asset, reference);
    })
  );

  return { results, warnings };
}

async function normalizeOneAsset(
  ticker: string,
  asset: BinanceRwaSearchAsset,
  reference: ReferenceResult | undefined
): Promise<BinanceRwaStockResult> {
  const notes: string[] = ["Sourced from Binance Web3 RWA Data API (web3.binance.com/build/api/v1/dex/market/rwa)."];
  let health: TokenizedStock["health"] = "healthy";

  // These four lookups are mutually independent — each is keyed only on
  // asset.tokenContractAddress/binanceChainId, none depends on another's
  // result — so they are started concurrently rather than one at a time.
  // This was previously four sequential network/RPC round-trips per
  // wrapper (price -> underlying-market -> on-chain decimals -> DexScreener
  // liquidity); the per-wrapper cost is now whichever one is slowest, not
  // the sum of all four. Each keeps its own try/catch exactly as before —
  // only WHEN each promise is kicked off changed, not its error handling.
  const pricePromise = getRwaPrice({
    tokenContractAddresses: [asset.tokenContractAddress],
    binanceChainId: asset.binanceChainId,
  });
  const marketPromise = getUnderlyingMarket({
    tokenContractAddress: asset.tokenContractAddress,
    binanceChainId: asset.binanceChainId,
  });
  const decimalsPromise = getErc20Decimals(asset.tokenContractAddress as Address);
  const liquidityPromise = resolveTrustedQuoteLiquidity(asset.tokenContractAddress, notes);
  const profilePromise = getUnderlyingProfile({
    tokenContractAddress: asset.tokenContractAddress,
    binanceChainId: asset.binanceChainId,
  });

  let priceEntry: BinanceRwaPriceEntry | undefined;
  try {
    const priceResults = await pricePromise;
    priceEntry = priceResults[0];
    if (!priceEntry) {
      health = "warning";
      notes.push("RWA price lookup returned no entry for this token.");
    }
  } catch (err) {
    health = "warning";
    notes.push(isWeekendGuardError(err) ? `RWA price lookup failed: ${err.message}` : "RWA price lookup failed unexpectedly.");
  }

  let market: BinanceRwaUnderlyingMarket | undefined;
  try {
    market = await marketPromise;
  } catch (err) {
    notes.push(
      isWeekendGuardError(err)
        ? `RWA underlying-market lookup failed: ${err.message}`
        : "RWA underlying-market lookup failed unexpectedly."
    );
  }

  const tokenPrice = toNumber(priceEntry?.tokenPrice);
  const binanceReferencePrice = toNumber(priceEntry?.referencePrice);
  if (binanceReferencePrice !== undefined) {
    const identical = tokenPrice !== undefined && binanceReferencePrice === tokenPrice;
    notes.push(
      `Binance also reports referencePrice=$${binanceReferencePrice}${identical ? " (identical to tokenPrice in this response)" : ""} — NOT used as the independent reference for the deviation check (Binance's docs describe it as derived from the on-chain token price itself, not an independent market quote; observed live to sometimes be numerically identical to tokenPrice, which an independent quote could not be).`
    );
  }

  const priceAgeSeconds = derivePriceAgeSeconds(priceEntry?.tokenPriceUpdatedAt, notes);

  // Binance RWA's own endpoints (search/price/underlying-market/
  // underlying-profile) have no decimals field anywhere in their confirmed
  // schema — read live via the existing chain.ts (the same read already
  // used by the spot-purchase flow for the user's own balance), the same
  // "fail to a clear UNKNOWN note, never guess a decimals value" pattern
  // used for every other field above. Without this, BuySpotPanel.tsx's own
  // `stock.decimals === undefined` guard would ALWAYS trigger for every
  // real Binance-RWA-sourced stock, silently making the existing spot
  // purchase flow non-functional — found while wiring the Investment
  // Intelligence Engine's quote-preview action, which needs this same
  // value, and fixed here since both features share the one root cause.
  let decimals: number | undefined;
  try {
    decimals = await decimalsPromise;
  } catch (err) {
    notes.push(isWeekendGuardError(err) ? `On-chain decimals read failed: ${err.message}` : "On-chain decimals read failed unexpectedly.");
  }

  // How many underlying shares one on-chain token represents — used by the
  // Safety Gate to normalize BOTH the reference-deviation and
  // cross-wrapper checks to a per-SHARE price before comparing (see
  // lib/types.ts's tokenToShareRatio doc, and safety/referenceDeviation.ts
  // / safety/wrapperConsistency.ts). Left undefined (treated as 1.0
  // explicitly downstream, never silently) if this lookup fails — never
  // guessed.
  let tokenToShareRatio: number | undefined;
  try {
    const profile = await profilePromise;
    tokenToShareRatio = toNumber(profile.tokenToShareRatio);
  } catch (err) {
    notes.push(isWeekendGuardError(err) ? `RWA underlying-profile (token-to-share ratio) lookup failed: ${err.message}` : "RWA underlying-profile lookup failed unexpectedly.");
  }

  const statusInfo = market?.statusInfo;
  if (statusInfo) {
    notes.push(
      `Binance underlying-market reports openState=${statusInfo.openState}, marketStatus=${statusInfo.marketStatus ?? "null"}, reasonCode=${statusInfo.reasonCode ?? "n/a"} (shown for transparency only — the Safety Gate's own self-computed NYSE calendar is the deterministic market-status check; bStocks' marketStatus has been observed to be consistently null in live testing, so it is not relied on).`
    );
  } else {
    notes.push("Binance underlying-market did not return statusInfo for this token.");
  }

  notes.push(
    "Binance RWA Data has no liquidity/depth field anywhere in its confirmed schema (search, price, underlying-market) — pool TVL is sourced separately below via the existing DexScreener integration."
  );

  const trustedQuote = await liquidityPromise;
  const liquidityUsd = trustedQuote.tvlUsd;
  const independentReference = resolveFreshIndependentReference(reference, notes);

  // Price fallback (root-cause fix): Binance's own /price lookup sometimes
  // returns no tokenPrice at all for a real, tradeable wrapper (live-
  // diagnosed: Ondo AAPL/NVDA both had a usable trusted-quote pool —
  // liquidity $1.64/$9,648 — yet no Binance tokenPrice), which previously
  // blocked referenceDeviation entirely (UNKNOWN, "missing the wrapper
  // price") even once a valid independent reference existed. "Third:
  // attempt another legitimate, suitable price source" — the SAME
  // trusted-quote DexScreener pool already fetched for liquidity above
  // carries its own price, so it's reused here rather than leaving the
  // wrapper price-less. priceAgeSeconds/priceSourceLabel are set to "now"
  // in that case, same honesty convention as issuerReference.ts's own
  // "no per-field timestamp, so freshness means as of this live fetch".
  const usedPriceFallback = tokenPrice === undefined && trustedQuote.priceUsd !== undefined;
  const price = tokenPrice ?? trustedQuote.priceUsd;
  if (usedPriceFallback) {
    notes.push(`Binance's own price lookup returned no tokenPrice for this wrapper — using the trusted-quote DexScreener pool's own price ($${trustedQuote.priceUsd!.toFixed(2)}) instead.`);
  }

  const stock: TokenizedStock = {
    underlying: ticker,
    name: `${ticker} (Binance RWA: ${asset.platformId}${asset.tokenSymbol ? `, ${asset.tokenSymbol}` : ""})`,
    symbol: asset.tokenSymbol,
    wrapper: mapRwaPlatformIdToWrapper(asset.platformId),
    chain: "bsc",
    tokenAddress: asset.tokenContractAddress,
    decimals,
    price,
    referencePrice: independentReference?.price,
    referenceSource: independentReference,
    tokenToShareRatio,
    priceAgeSeconds: usedPriceFallback ? 0 : priceAgeSeconds,
    // priceAgeSeconds above is BINANCE's own tokenPriceUpdatedAt age (or,
    // when the fallback above fired, "now" — a live DexScreener read), not
    // Pyth's — label it explicitly so the freshness check's message never
    // misattributes it to referenceSource (which is Pyth/issuer, used only
    // for the deviation check). See lib/types.ts's priceSourceLabel doc.
    priceSourceLabel: usedPriceFallback ? "DexScreener trusted-quote price" : "Binance token price",
    liquidityUsd,
    volume24hUsd: undefined,
    marketStatus: undefined,
    source: "binance-rwa",
    health,
    notes,
  };

  return { stock, rawAsset: asset };
}

/**
 * Accepts an independent reference (Pyth primary/fallback, OR — once both
 * Pyth tiers fail — the Ondo issuer reference; see providers/reference.ts
 * for the full 3-tier hierarchy) ONLY if it's present AND fresh enough per
 * the existing SAFETY_THRESHOLDS — the exact same open/closed-market age
 * limits safety/freshness.ts already applies, reused here (not reinvented)
 * so "fresh" means the same thing everywhere in the app. The issuer tier's
 * timestamp is always "now" (no per-field timestamp exists upstream — see
 * issuerReference.ts), so it always clears this check trivially; that is a
 * documented limitation of that tier, not a bug here.
 *
 * Returns undefined (not a stale/guessed value) if:
 *  - no tier produced a reference at all, or
 *  - the best available price is older than the applicable threshold.
 * Either way, `stock.referencePrice` stays undefined, so the existing,
 * unmodified checkReferenceDeviation() reports UNKNOWN via its own
 * missing-input branch — no Safety Gate code needed to change.
 */
function resolveFreshIndependentReference(
  reference: ReferenceResult | undefined,
  notes: string[]
): ReferenceSource | undefined {
  const candidate = reference?.primary ?? reference?.fallback ?? reference?.issuerReference;

  if (!candidate) {
    notes.push(
      reference?.unavailableReason
        ? `Independent reference unavailable: ${reference.unavailableReason}`
        : "No independent reference price is available for this ticker — reference deviation is UNKNOWN, not assumed within bounds."
    );
    return undefined;
  }

  const marketStatus = getUsEquityMarketStatus();
  const maxAge = marketStatus.isOpen
    ? SAFETY_THRESHOLDS.MAX_REFERENCE_AGE_SECONDS_MARKET_OPEN
    : SAFETY_THRESHOLDS.MAX_REFERENCE_AGE_SECONDS_MARKET_CLOSED;
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - candidate.publishTimeSec);

  if (ageSeconds > maxAge) {
    notes.push(
      `Independent reference (${candidate.name}) is ${Math.round(ageSeconds / 60)} min old, exceeding the ${Math.round(maxAge / 60)} min ${marketStatus.isOpen ? "open" : "closed"}-market freshness window — treated as unavailable rather than stale-but-used.`
    );
    return undefined;
  }

  notes.push(
    `Independent reference for deviation check: ${candidate.name} = $${candidate.price.toFixed(2)}, ${Math.round(ageSeconds / 60)} min old.`
  );
  return candidate;
}

/**
 * Looks up pool TVL for `tokenContractAddress` (the EXACT BSC address
 * Binance RWA search already identified for this wrapper — no separate
 * lookup/guessing of which token to check) via the existing DexScreener
 * integration's trusted-quote-filtered liquidity lookup.
 *
 * Returns undefined (never a fabricated/substituted value) on:
 *  - no BSC pairs at all for this token,
 *  - BSC pairs exist but none are quoted against USDT/USDC/BUSD/WBNB
 *    (verified by address, not symbol — see dexscreener.ts), or
 *  - the DexScreener request itself failing (network/rate-limit/etc.).
 * Any of these leaves `stock.liquidityUsd` undefined, so the existing,
 * unmodified checkLiquidity() reports UNKNOWN via its own missing-data
 * branch — no Safety Gate code needed to change for this.
 */
interface TrustedQuoteLookup {
  tvlUsd?: number;
  /** The same trusted-quote pool's own price — used as a FALLBACK wrapper price (see normalizeOneAsset) when Binance's own /price lookup returns none. "Third: attempt another legitimate, suitable price source" rather than leaving a wrapper with liquidity data but no price at all. */
  priceUsd?: number;
}

async function resolveTrustedQuoteLiquidity(tokenContractAddress: string, notes: string[]): Promise<TrustedQuoteLookup> {
  try {
    const result = await getTrustedQuoteLiquidity(tokenContractAddress);

    if (result.status === "no_qualifying_pair") {
      notes.push(`Pool TVL (trusted quote): no qualifying pool found — ${result.reason}`);
      return {};
    }

    notes.push(
      `Pool TVL (trusted quote): $${Math.round(result.tvlUsd).toLocaleString()} in the deepest qualifying pool — pair ${result.pairAddress} (${result.dexId}), quoted against ${result.quoteSymbol} (${result.quoteAddress}). This is total pool TVL, both sides combined, NOT executable depth or a guaranteed tradeable size.`
    );
    return { tvlUsd: result.tvlUsd, priceUsd: result.priceUsd };
  } catch (err) {
    notes.push(
      isWeekendGuardError(err)
        ? `Pool TVL (trusted quote) lookup failed: ${err.message}`
        : "Pool TVL (trusted quote) lookup failed unexpectedly."
    );
    return {};
  }
}

/**
 * Thin wrapper around the pure, unit-tested parseTokenPriceUpdatedAt() —
 * see binanceRwaTimestamp.ts for the actual parsing/tolerance logic and
 * its test file for coverage of the clock-skew fix.
 */
function derivePriceAgeSeconds(updatedAtRaw: number | undefined, notes: string[]): number | undefined {
  const result = parseTokenPriceUpdatedAt(updatedAtRaw);
  if (result.rejectionReason) {
    notes.push(`${result.rejectionReason} Leaving price freshness UNKNOWN rather than guessing.`);
    return undefined;
  }
  return result.ageSeconds;
}
