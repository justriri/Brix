import type { CheckResult, TokenizedStock } from "@/lib/types";
import { SAFETY_THRESHOLDS } from "./thresholds.ts";

/**
 * HARD check: does the wrapper's own traded price agree with the
 * independent reference price closely enough to be trusted?
 *
 * deviationPercent = abs(wrapperPrice - referencePrice) / referencePrice * 100
 *
 * Per the pressure-test memo, this deviation is compared against the
 * independent reference (Pyth), never against another wrapper — using one
 * wrapper to validate another risks circularity if they share an upstream
 * source, which the research could not rule out.
 */
export function checkReferenceDeviation(stock: TokenizedStock): CheckResult {
  if (stock.price === undefined || stock.referencePrice === undefined) {
    return {
      id: "referenceDeviation",
      label: "Reference deviation",
      passed: null,
      severity: "hard",
      message: "Missing either the wrapper price or an independent reference price from this source — deviation is UNKNOWN, not assumed within bounds.",
    };
  }

  // Normalize to a per-SHARE price before comparing: the reference price
  // (Pyth, or the Ondo issuer fallback) is a per-share quote, but
  // stock.price is a per-TOKEN price, which only equals the per-share price
  // when tokenToShareRatio is exactly 1. An undefined ratio is treated as
  // 1.0 explicitly here (not a silent prior assumption baked into the raw
  // comparison) — see the field's own doc comment in lib/types.ts.
  const perSharePrice = stock.price / (stock.tokenToShareRatio ?? 1);
  const deviationPercent = (Math.abs(perSharePrice - stock.referencePrice) / stock.referencePrice) * 100;
  const passed = deviationPercent <= SAFETY_THRESHOLDS.MAX_REFERENCE_DEVIATION_PERCENT;

  return {
    id: "referenceDeviation",
    label: "Reference deviation",
    passed,
    severity: "hard",
    value: Number(deviationPercent.toFixed(2)),
    threshold: SAFETY_THRESHOLDS.MAX_REFERENCE_DEVIATION_PERCENT,
    message: passed
      ? `Wrapper price ($${perSharePrice.toFixed(2)}/share) is ${deviationPercent.toFixed(2)}% from reference ($${stock.referencePrice.toFixed(2)}), within the ${SAFETY_THRESHOLDS.MAX_REFERENCE_DEVIATION_PERCENT}% limit.`
      : `Wrapper price ($${perSharePrice.toFixed(2)}/share) is ${deviationPercent.toFixed(2)}% from reference ($${stock.referencePrice.toFixed(2)}), exceeding the ${SAFETY_THRESHOLDS.MAX_REFERENCE_DEVIATION_PERCENT}% limit.`,
  };
}
