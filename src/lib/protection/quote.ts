import type { Position, ProtectionQuote } from "@/lib/types";
import { assessPosition } from "@/lib/agent/riskMonitor";
import { getNextMarketOpen } from "@/lib/marketCalendar";
import { getIllustrativeRatePercent } from "@/lib/protection/premiumTiers";

/**
 * getProtectionQuote — produces a clearly-labelled DEVELOPMENT-ONLY quote.
 *
 * Per the build brief and the strategy memo (section 7): no real premium is
 * collected, no funds move, and no payout contract exists yet, because the
 * BNB Hack "spot only" rule's application to this mechanism is still
 * unresolved. This function exists so the UI/architecture can be built now
 * and wired to a real contract later without changing its shape.
 *
 * Premium formula: see lib/protection/premiumTiers.ts (extracted there,
 * values unchanged, so the new Binance-RWA-sourced quote flow reuses the
 * exact same illustrative tiers rather than a second, divergent copy).
 */

export interface ProtectionQuoteRequest {
  position: Position;
  thresholdPercent: number;
  coverageAmount: number;
}

export async function getProtectionQuote(req: ProtectionQuoteRequest): Promise<ProtectionQuote> {
  const safetyGateResult = await assessPosition(req.position);
  const ratePercent = getIllustrativeRatePercent(req.thresholdPercent);
  const premium = Number(((req.coverageAmount * ratePercent) / 100).toFixed(2));
  const expiresAt = getNextMarketOpen().getTime();

  return {
    underlying: req.position.stock.underlying,
    wrapper: req.position.stock.wrapper,
    coverageAmount: req.coverageAmount,
    thresholdPercent: req.thresholdPercent,
    premium,
    expiresAt,
    safetyGateResult,
    isDevelopmentOnly: true,
  };
}
