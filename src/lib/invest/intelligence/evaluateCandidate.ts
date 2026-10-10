import type { SafetyGateResult, TokenizedStock } from "@/lib/types";
import type { CandidateEvaluation, CheckStatus, EvaluatedCheck, PriceVerificationMode } from "./intelligenceTypes";

/**
 * Pure presentation layer over the EXISTING, unmodified Safety Gate result.
 * Every number/status here already exists on `stock` (TokenizedStock) or
 * `safetyGateResult` (SafetyGateResult):
 *   - `operationalStatus` = safetyGateResult.status, verbatim.
 *   - every check's value/threshold/message = the existing CheckResult's own
 *     fields (liquidity.ts/freshness.ts/referenceDeviation.ts/marketStatus.ts/
 *     wrapperConsistency.ts already populate these — confirmed by reading
 *     each file directly before writing this one).
 * This is "reuse the existing Safety Gate rather than creating another
 * version" taken literally: there is no second evaluation here, only a
 * relabeling of the first one into the vocabulary the Investment
 * Intelligence UI/assistant needs (PASS/FAIL/UNKNOWN per check, "operational
 * status" instead of a payout-eligibility framing).
 *
 * ONE deliberate exception: `canAttemptPurchase` (see its own doc comment
 * on CandidateEvaluation) re-aggregates the SAME existing hard checks minus
 * liquidity specifically, because the interface was found to show every
 * wrapper as red/FAIL purely due to a pool-TVL heuristic that doesn't
 * reflect real, Smart-Router-executable liquidity — while the actual,
 * trade-size-specific executable-liquidity gate (buildPurchaseQuote()) was
 * never reachable to even run. This mirrors runSafetyGate()'s own rule
 * exactly (same four lines of logic), it does not invent a new Safety Gate.
 */

/** `passed: null` ALWAYS maps to UNKNOWN, never PASS — build brief Phase 1 §2's explicit requirement, enforced here as the one and only place this mapping happens. */
function toCheckStatus(passed: boolean | null): CheckStatus {
  if (passed === true) return "PASS";
  if (passed === false) return "FAIL";
  return "UNKNOWN";
}

/**
 * Mirrors runSafetyGate()'s own aggregation rule (safety/safetyGate.ts)
 * EXACTLY, with one deliberate difference: the liquidity check is excluded
 * from the hard-check list. See CandidateEvaluation.canAttemptPurchase's
 * doc comment for why — liquidity's pool-TVL heuristic doesn't know a
 * specific trade's real executable price impact, and gating "Buy Spot"
 * navigation on it would block the ONE check that actually does
 * (buildPurchaseQuote()'s executable-liquidity gate) from ever running.
 */
function canAttemptPurchase(safetyGateResult: SafetyGateResult): boolean {
  const { priceFreshness, referenceDeviation, marketStatus, crossWrapperConsistency } = safetyGateResult.checks;
  const hardChecksExcludingLiquidity = [priceFreshness, referenceDeviation, marketStatus];
  const anyHardFailedOrUnknown = hardChecksExcludingLiquidity.some((c) => c.passed !== true);
  if (anyHardFailedOrUnknown) return false;
  // Mirrors runSafetyGate()'s own updated rule (safety/safetyGate.ts) —
  // INCONCLUSIVE cross-wrapper data (passed: null) is corroborated by the
  // independent reference check already being required to pass above, so
  // it's treated the same as AGREEMENT here. Only a genuine DISAGREEMENT
  // (passed: false) still blocks. This was previously stricter than
  // operationalStatus itself (required literal agreement, `=== true`),
  // which could show a PASS badge next to a "Buy isn't offered" message
  // for the exact wrapper that just passed.
  return crossWrapperConsistency.passed !== false;
}

/**
 * Explicit, user-facing label for HOW a PASS was reached — the user
 * explicitly asked not to call a position "verified" when only an issuer
 * reference (not a second wrapper) corroborated the price. Independent of
 * operationalStatus/canAttemptPurchase (neither of which changes), this
 * only affects what the UI SAYS about a PASS.
 */
function priceVerificationMode(safetyGateResult: SafetyGateResult): PriceVerificationMode {
  const { referenceDeviation, crossWrapperConsistency } = safetyGateResult.checks;
  if (crossWrapperConsistency.passed === true) return "CROSS_WRAPPER_CONFIRMED";
  if (crossWrapperConsistency.passed === false) return "DISAGREEMENT";
  if (referenceDeviation.passed === true) return "ISSUER_REFERENCE_ONLY";
  return "UNAVAILABLE";
}

function evaluatedCheck(name: string, check: SafetyGateResult["checks"][keyof SafetyGateResult["checks"]]): EvaluatedCheck {
  return {
    name,
    status: toCheckStatus(check.passed),
    value: check.value,
    threshold: check.threshold,
    message: check.message,
  };
}

export function evaluateCandidate(stock: TokenizedStock, safetyGateResult: SafetyGateResult): CandidateEvaluation {
  const checks: EvaluatedCheck[] = [
    evaluatedCheck("Price freshness", safetyGateResult.checks.priceFreshness),
    evaluatedCheck("Independent reference", safetyGateResult.checks.referenceDeviation),
    evaluatedCheck("Trusted liquidity", safetyGateResult.checks.liquidity),
    evaluatedCheck("Cross-wrapper consistency", safetyGateResult.checks.crossWrapperConsistency),
    evaluatedCheck("Market status", safetyGateResult.checks.marketStatus),
  ];

  const failedChecks = checks.filter((c) => c.status !== "PASS");

  return {
    underlying: stock.underlying,
    displayName: stock.name,
    wrapper: stock.wrapper,
    tokenSymbol: stock.symbol ?? stock.name,
    tokenAddress: stock.tokenAddress,
    operationalStatus: safetyGateResult.status,
    canAttemptPurchase: canAttemptPurchase(safetyGateResult),
    priceVerification: priceVerificationMode(safetyGateResult),
    checks,
    failedChecks,
    facts: {
      tokenPrice: stock.price,
      referencePrice: stock.referencePrice,
      liquidityUsd: stock.liquidityUsd,
      priceFreshnessSeconds: stock.priceAgeSeconds,
      marketStatus: stock.marketStatus,
      decimals: stock.decimals,
    },
    evaluationTimestamp: safetyGateResult.timestamp,
    stock,
    safetyGateResult,
  };
}
