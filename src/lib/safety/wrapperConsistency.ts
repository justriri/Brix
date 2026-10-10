import type { CheckResult, TokenizedStock } from "@/lib/types";
// Relative, with an explicit extension (not "@/lib/safety/thresholds"): this
// keeps the module resolvable by Node's own test runner
// (`node --experimental-strip-types --test`), the same "pure core" pattern
// already used by trustedQuoteLiquidity.ts — see wrapperConsistency.test.mts.
import { SAFETY_THRESHOLDS } from "./thresholds.ts";

export type CrossWrapperOutcome = "AGREEMENT" | "INCONCLUSIVE" | "DISAGREEMENT";

/**
 * Names the cross-wrapper check's three possible outcomes explicitly,
 * instead of leaving every caller to re-derive them from a nullable
 * boolean. INCONCLUSIVE (no trustworthy comparison data exists) and
 * DISAGREEMENT (trustworthy data exists but conflicts) are deliberately
 * distinct: conflating them — both previously surfaced as a plain
 * "WARNING" with no further distinction available to callers — is what let
 * orchestrator.ts's canOfferProtection() block protection for "no
 * comparison data available" exactly as hard as it blocks a genuine price
 * conflict, even though they call for different handling.
 */
export function crossWrapperOutcome(check: CheckResult): CrossWrapperOutcome {
  if (check.passed === true) return "AGREEMENT";
  if (check.passed === false) return "DISAGREEMENT";
  return "INCONCLUSIVE";
}

/**
 * SOFT check: do other available wrappers of the same underlying broadly
 * agree with this one?
 *
 * This is deliberately soft, not hard — per the strategy memo and pressure
 * test: cross-wrapper agreement is a *corroborating* signal, never the
 * price source itself (we don't know the wrappers' oracles are truly
 * independent), and legitimate structural differences (24/7 AMM pricing vs.
 * 24/5 issuer-anchored pricing) mean disagreement is often expected, not
 * dangerous. It therefore informs confidence and is surfaced to the user,
 * but never on its own moves the overall status to FAIL — see safetyGate.ts.
 *
 * The user's own position/wrapper is never switched based on this check —
 * "the user's actual position remains the user's actual position" (build
 * brief) — other wrappers are shown as reference only.
 */
export function checkCrossWrapperConsistency(
  stock: TokenizedStock,
  otherWrappers: TokenizedStock[]
): CheckResult {
  // A price is only usable as a cross-check reference if it comes from a
  // pool deep enough to trust in the first place — the SAME bar
  // (MIN_LIQUIDITY_USD) a wrapper's own liquidity check requires it to
  // clear. Live-diagnosed: a pool with ~$0.41-$25 of TVL still quotes
  // *against* a trusted asset (so it isn't excluded as a spam/wrong-asset
  // pair), but its "price" is an artifact of near-zero depth, not real
  // price discovery — comparing against it produced a false-looking >4%
  // "disagreement" for an otherwise perfectly healthy position. Excluding
  // it here doesn't loosen anything: it falls back to the existing,
  // already-honest "no comparable wrapper" WARNING instead of fabricating
  // a misleading "disagrees" reason from unreliable data — the overall
  // gate status is unaffected (already not PASS either way).
  const comparable = otherWrappers.filter(
    (o) =>
      o.price !== undefined &&
      o.wrapper !== stock.wrapper &&
      o.liquidityUsd !== undefined &&
      o.liquidityUsd >= SAFETY_THRESHOLDS.MIN_LIQUIDITY_USD
  );

  if (stock.price === undefined || comparable.length === 0) {
    return {
      id: "crossWrapperConsistency",
      label: "Cross-wrapper consistency",
      passed: null,
      severity: "soft",
      message: "No other wrapper has both a price and enough pool liquidity to trust as a cross-check right now — nothing reliable to compare against.",
    };
  }

  // Normalize both sides to a per-SHARE price before comparing — two
  // wrappers with different tokenToShareRatio values can legitimately have
  // different per-TOKEN prices while representing the identical underlying
  // share price; comparing raw per-token prices would misreport that ratio
  // difference as a price disagreement. An undefined ratio is treated as
  // 1.0 explicitly (see the field's doc comment in lib/types.ts).
  const stockPerShare = stock.price / (stock.tokenToShareRatio ?? 1);
  const deviations = comparable.map((o) => ({
    wrapper: o.wrapper,
    deviationPercent: (Math.abs(stockPerShare - o.price! / (o.tokenToShareRatio ?? 1)) / (o.price! / (o.tokenToShareRatio ?? 1))) * 100,
  }));

  const bestAgreement = deviations.reduce((min, d) => (d.deviationPercent < min.deviationPercent ? d : min));
  const agrees = bestAgreement.deviationPercent <= SAFETY_THRESHOLDS.MAX_CROSS_WRAPPER_DEVIATION_PERCENT;

  return {
    id: "crossWrapperConsistency",
    label: "Cross-wrapper consistency",
    passed: agrees,
    severity: "soft",
    value: Number(bestAgreement.deviationPercent.toFixed(2)),
    threshold: SAFETY_THRESHOLDS.MAX_CROSS_WRAPPER_DEVIATION_PERCENT,
    message: agrees
      ? `Closest agreement is with ${bestAgreement.wrapper} (${bestAgreement.deviationPercent.toFixed(2)}% apart), within the ${SAFETY_THRESHOLDS.MAX_CROSS_WRAPPER_DEVIATION_PERCENT}% band.`
      : `Closest other wrapper (${bestAgreement.wrapper}) still disagrees by ${bestAgreement.deviationPercent.toFixed(2)}%, beyond the ${SAFETY_THRESHOLDS.MAX_CROSS_WRAPPER_DEVIATION_PERCENT}% band. This does not fail the gate on its own but lowers confidence.`,
  };
}
