import type { SafetyGateResult, TokenizedStock } from "@/lib/types";
// Relative, with explicit extensions — see wrapperConsistency.ts's own
// comment: keeps this module resolvable by Node's test runner directly
// (see safetyGate.test.mts).
import { checkLiquidity } from "./liquidity.ts";
import { checkPriceFreshness } from "./freshness.ts";
import { checkReferenceDeviation } from "./referenceDeviation.ts";
import { checkMarketStatus } from "./marketStatus.ts";
import { checkCrossWrapperConsistency } from "./wrapperConsistency.ts";

/**
 * Deterministic Safety Gate. No LLM, no arbitrary judgment — every field in
 * the returned SafetyGateResult is reproducible from the same inputs (pure
 * functions over TokenizedStock data), inspectable, and explainable, per
 * the build brief.
 *
 * Status rule:
 *   - FAIL        if any HARD check was actually evaluated and came back
 *                 false — a genuine, confirmed failure (deviation exceeds
 *                 the threshold, liquidity is genuinely below the floor,
 *                 this data source positively reported a failure). Never
 *                 read as merely "unsafe to assume" — this is a real signal.
 *   - UNAVAILABLE if no hard check came back false, but at least one could
 *                 not be evaluated at all (null — missing price, missing
 *                 independent reference, missing liquidity figure from
 *                 every source tried). This is "absence of evidence," not
 *                 "evidence of a problem": the pressure-test memo's "never
 *                 read missing data as safe" principle still holds (this is
 *                 NOT a PASS), but conflating it with FAIL mislabels a data
 *                 gap as a confirmed danger, which is its own failure mode —
 *                 it blocked purchase/protection for legitimate single-
 *                 source wrappers whose own price was never shown to be
 *                 wrong, only unverifiable right now. referenceDeviation is
 *                 the check this hits most often: it only resolves to
 *                 true/false once a genuinely independent reference (Pyth,
 *                 or — for Ondo assets only — Binance RWA's underlying-
 *                 market issuer price; see providers/reference.ts for the
 *                 full 3-tier hierarchy and providers/issuerReference.ts for
 *                 why it's Ondo-only) was actually obtained; when every tier
 *                 fails, it's null, not false.
 *   - WARNING     if all hard checks pass (true), but the SOFT cross-wrapper
 *                 check actively DISAGREES (not merely inconclusive — see
 *                 below). A genuine conflict between two wrappers' prices is
 *                 a real signal worth surfacing even though every hard check
 *                 on its own is fine, so this never silently escalates to
 *                 PASS.
 *   - PASS        if all hard checks pass (true), AND the cross-wrapper
 *                 check either agrees OR is merely INCONCLUSIVE (no second
 *                 wrapper has a trustworthy comparable price right now —
 *                 not a conflict).
 *
 * WHY INCONCLUSIVE CROSS-WRAPPER DATA NO LONGER BLOCKS ON ITS OWN (this
 * used to require cross-wrapper AGREEMENT specifically for PASS, treating
 * an unavailable second opinion the same as an active disagreement):
 * cross-wrapper comparison is a SOFT, supplementary signal precisely
 * because it compares two wrappers that may share upstream data sources —
 * see safety/wrapperConsistency.ts's own doc. referenceDeviation (a HARD
 * check) already does the strictly stronger thing: it verifies the price
 * against a source OUTSIDE the wrapper ecosystem entirely. Once that
 * already-independent corroboration has passed, additionally requiring a
 * SECOND wrapper to also agree was redundant belt-and-suspenders, not a
 * core requirement of the risk model — and it had a real cost: a position
 * with an impeccable, independently-verified price was being blocked from
 * protection for no reason related to its own risk, solely because some
 * OTHER wrapper of the same ticker happened to have no live/trustworthy
 * price right now. A genuine cross-wrapper DISAGREEMENT is a different,
 * still-respected case: it's new, real evidence, not an absence of
 * evidence, so it still prevents PASS.
 */
export function runSafetyGate(
  stock: TokenizedStock,
  otherWrappers: TokenizedStock[]
): SafetyGateResult {
  const liquidity = checkLiquidity(stock);
  const priceFreshness = checkPriceFreshness(stock, stock.marketStatus ?? "unknown");
  const referenceDeviation = checkReferenceDeviation(stock);
  const marketStatus = checkMarketStatus();
  const crossWrapperConsistency = checkCrossWrapperConsistency(stock, otherWrappers);

  const hardChecks = [liquidity, priceFreshness, referenceDeviation, marketStatus];
  const anyHardFailed = hardChecks.some((c) => c.passed === false);
  const anyHardUnavailable = hardChecks.some((c) => c.passed === null);
  const crossWrapperDisagrees = crossWrapperConsistency.passed === false;

  const status: SafetyGateResult["status"] = anyHardFailed
    ? "FAIL"
    : anyHardUnavailable
      ? "UNAVAILABLE"
      : crossWrapperDisagrees
        ? "WARNING"
        : "PASS";

  const reasons: string[] = hardChecks.filter((c) => c.passed !== true).map((c) => c.message);
  if (crossWrapperDisagrees) {
    reasons.push(crossWrapperConsistency.message);
  } else if (status === "PASS" && crossWrapperConsistency.passed === null) {
    // Reached PASS via the independent-reference corroboration path, not
    // cross-wrapper agreement — said plainly rather than silently, so a
    // caller/UI can tell the two PASS routes apart if it wants to, without
    // this reading as a generic "all checks passed" that implies
    // cross-wrapper data existed and agreed.
    reasons.push(
      `Cross-wrapper comparison was unavailable (${crossWrapperConsistency.message}), but this wrapper's price is independently corroborated by ${stock.referenceSource?.name ?? "its reference price"}, which is sufficient on its own.`
    );
  }

  // Diagnostic only — every value here is already public (prices,
  // liquidity figures, check thresholds already shown in the UI); nothing
  // secret (no API keys, no request/response bodies) is logged. Lets a
  // non-PASS result be traced to the EXACT check and value that caused it,
  // rather than just the rolled-up status/reasons string callers display.
  if (status !== "PASS") {
    console.warn(
      `[SafetyGate] ${stock.wrapper}:${stock.underlying} -> ${status}`,
      Object.fromEntries(
        Object.entries({ liquidity, priceFreshness, referenceDeviation, marketStatus, crossWrapperConsistency }).map(
          ([name, c]) => [name, { passed: c.passed, value: c.value, threshold: c.threshold, message: c.message }]
        )
      ),
      { otherWrappers: otherWrappers.map((w) => ({ wrapper: w.wrapper, price: w.price, health: w.health })) }
    );
  }

  return {
    status,
    underlying: stock.underlying,
    wrapper: stock.wrapper,
    checks: { liquidity, priceFreshness, referenceDeviation, marketStatus, crossWrapperConsistency },
    primaryReference: stock.referenceSource,
    fallbackReference: undefined, // populated by callers that fetched both primary and fallback explicitly (see providers/reference.ts); kept undefined here since TokenizedStock only carries the one reference actually used.
    reasons: reasons.length ? reasons : ["All checks passed."],
    timestamp: Date.now(),
  };
}

/** Renders a SafetyGateResult as the plain-text explanation shown in the build brief's examples. */
export function formatSafetyGateResult(result: SafetyGateResult): string {
  const lines: string[] = [`SAFETY GATE: ${result.status}`, "", `${result.wrapper} ${result.underlying}`, ""];
  for (const check of Object.values(result.checks)) {
    const symbol = check.passed === true ? "✓" : check.passed === false ? "✗" : "⚠";
    lines.push(`${symbol} ${check.message}`);
  }
  if (result.status !== "PASS") {
    lines.push("", "Reason:", ...result.reasons.map((r) => `  ${r}`));
  }
  return lines.join("\n");
}
