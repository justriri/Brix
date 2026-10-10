import type { Position, SafetyGateResult } from "@/lib/types";
import { assessPosition } from "@/lib/agent/riskMonitor";

/**
 * Settlement re-validation — STUB ONLY, matching the build brief's
 * "prepare settlement decision" step of the agent workflow.
 *
 * WeekendGuard does not execute real settlement yet: the BNB Hack
 * "spot only" rule's application to a fixed-term contingent payout is
 * still unresolved (see reports/BNB tokenized stocks hackathon research.md
 * and reports/Weekend protection strategy memo.md, section 7 "Reference
 * price disappears" / "Market does not reopen normally"). This module
 * documents and exercises the re-validation step the real settlement flow
 * will depend on, without moving any funds or calling a payout contract —
 * see lib/protection/policy.ts for the explicitly-disabled financial layer.
 *
 * Per strategy memo section 7: a settlement decision must never silently
 * resolve to "no trigger" OR "always pay" when data is unavailable — it
 * must resolve to an explicit "cannot resolve" state. That is reflected
 * here as the `"cannot_resolve"` outcome.
 */
export type SettlementOutcome = "would_pay" | "would_not_pay" | "cannot_resolve";

export interface SettlementPreview {
  outcome: SettlementOutcome;
  safetyGateResult: SafetyGateResult;
  reason: string;
  isDevelopmentOnly: true;
}

/**
 * Re-runs the Safety Gate for a position at "settlement time" and reports
 * what a real settlement WOULD do — without doing it. thresholdPercent is
 * the weekend downside threshold from the (also-disabled) protection quote.
 */
export async function previewSettlement(
  position: Position,
  thresholdPercent: number
): Promise<SettlementPreview> {
  const safetyGateResult = await assessPosition(position);

  if (safetyGateResult.status === "FAIL" || safetyGateResult.status === "UNAVAILABLE") {
    return {
      outcome: "cannot_resolve",
      safetyGateResult,
      reason:
        safetyGateResult.status === "FAIL"
          ? "Safety Gate failed at settlement time — data is not trustworthy enough to determine a payout either way. A real settlement must not resolve this as either a pay or a no-pay."
          : "Safety Gate could not be evaluated at settlement time — one or more required checks have no data from any source. A real settlement must not resolve this as either a pay or a no-pay.",
      isDevelopmentOnly: true,
    };
  }

  const referencePrice = safetyGateResult.primaryReference?.price ?? position.stock.referencePrice;
  if (referencePrice === undefined) {
    return {
      outcome: "cannot_resolve",
      safetyGateResult,
      reason: "No reference price available at settlement time.",
      isDevelopmentOnly: true,
    };
  }

  // NOTE: this compares the CURRENT reference price to itself as a
  // placeholder "entry price" until a real policy (with a recorded
  // Friday-close entry price) exists — see lib/protection/policy.ts.
  // It exists only to exercise the decision branches deterministically.
  const dropPercent = 0;
  const wouldPay = dropPercent >= thresholdPercent;

  return {
    outcome: wouldPay ? "would_pay" : "would_not_pay",
    safetyGateResult,
    reason: wouldPay
      ? `Reference price is down ${dropPercent.toFixed(2)}%, at/above the ${thresholdPercent}% threshold.`
      : `Reference price is down ${dropPercent.toFixed(2)}%, below the ${thresholdPercent}% threshold.`,
    isDevelopmentOnly: true,
  };
}
