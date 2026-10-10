import type { CheckResult, MarketStatus, TokenizedStock } from "@/lib/types";
import { SAFETY_THRESHOLDS } from "./thresholds.ts";

/**
 * HARD check: is `stock.priceAgeSeconds` fresh enough to trust, given
 * whether the underlying market is currently open or closed?
 *
 * The allowed staleness window is intentionally different for open vs.
 * closed markets — see pressure-test memo section 5 ("tokenized prices
 * legitimately differ because of market structure... deviation widening
 * specifically on weekends should be treated as expected baseline, not
 * anomaly"). A frozen Friday-close price is *correct* over a weekend, not
 * stale in the sense that should trigger a failure.
 *
 * This only requires `priceAgeSeconds` to be known — per its own type
 * definition (lib/types.ts), that field represents "age of `price`",
 * sourced differently depending on the provider (a Pyth reference's
 * publish time for DexScreener-based wrappers; a provider's own
 * last-updated timestamp, e.g. Binance RWA's `tokenPriceUpdatedAt`, when
 * that's what's actually available).
 *
 * The message names `priceSourceLabel` when the provider set it, falling
 * back to `referenceSource?.name` otherwise — NOT the other way around.
 * For Binance RWA stocks, `priceAgeSeconds` and `referenceSource` come
 * from two DIFFERENT, unrelated sources (Binance's own timestamp vs. an
 * independent Pyth price used only by the deviation check), so blindly
 * naming `referenceSource` here would misattribute Binance's own price
 * age to Pyth. `priceSourceLabel`'s absence does NOT make freshness
 * unknown either way — a source can report its own price's age without
 * also supplying an independent reference price.
 */
export function checkPriceFreshness(stock: TokenizedStock, marketStatus: MarketStatus): CheckResult {
  if (stock.priceAgeSeconds === undefined) {
    return {
      id: "priceFreshness",
      label: "Price freshness",
      passed: null,
      severity: "hard",
      message: "No usable price timestamp is available from this source — freshness is UNKNOWN, not assumed fresh.",
    };
  }

  const maxAge =
    marketStatus === "open"
      ? SAFETY_THRESHOLDS.MAX_REFERENCE_AGE_SECONDS_MARKET_OPEN
      : SAFETY_THRESHOLDS.MAX_REFERENCE_AGE_SECONDS_MARKET_CLOSED;

  const passed = stock.priceAgeSeconds <= maxAge;
  const ageMinutes = Math.round(stock.priceAgeSeconds / 60);
  const sourceLabel = stock.priceSourceLabel ?? stock.referenceSource?.name ?? "this source's reported price";

  return {
    id: "priceFreshness",
    label: "Price freshness",
    passed,
    severity: "hard",
    value: stock.priceAgeSeconds,
    threshold: maxAge,
    message: passed
      ? `${sourceLabel} is ${ageMinutes} min old, within the ${
          marketStatus === "open" ? "open-market" : "closed-market"
        } freshness window.`
      : `${sourceLabel} is ${ageMinutes} min old, exceeding the ${
          marketStatus === "open" ? "open-market" : "closed-market"
        } freshness window (${Math.round(maxAge / 60)} min).`,
  };
}
