/**
 * Pure, dependency-free illustrative premium-tier lookup.
 *
 * Extracted out of lib/protection/quote.ts (values and logic UNCHANGED,
 * only relocated) so it can be shared by both the original Position-based
 * quote flow (quote.ts) and the new Binance-RWA-sourced quote flow
 * (binanceRwaQuoteCore.ts) without duplicating the numbers, and so it's
 * directly unit-testable with Node's test runner without pulling in
 * either flow's heavier provider/chain import graph.
 *
 * NOT an actuarial/volatility-surface model — see
 * reports/Weekend protection strategy memo.md section 7: a flat/tiered
 * premium (a function of threshold tightness only) is a defensible,
 * clearly-labelled placeholder for this MVP, explicitly not derived from
 * real options-pricing or historical-gap data. Tighter thresholds (more
 * likely to trigger) cost more, in the same direction any real pricing
 * model would go, but the exact numbers below remain illustrative.
 */

export interface PremiumTier {
  maxThresholdPercent: number;
  ratePercent: number;
}

export const ILLUSTRATIVE_PREMIUM_TIERS: PremiumTier[] = [
  { maxThresholdPercent: 3, ratePercent: 4 },
  { maxThresholdPercent: 5, ratePercent: 2.5 },
  { maxThresholdPercent: 10, ratePercent: 1 },
  { maxThresholdPercent: Infinity, ratePercent: 0.5 },
];

export function getIllustrativeRatePercent(thresholdPercent: number): number {
  const tier = ILLUSTRATIVE_PREMIUM_TIERS.find((t) => thresholdPercent <= t.maxThresholdPercent);
  return tier?.ratePercent ?? ILLUSTRATIVE_PREMIUM_TIERS[ILLUSTRATIVE_PREMIUM_TIERS.length - 1].ratePercent;
}
