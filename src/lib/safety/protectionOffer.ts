import type { SafetyGateResult } from "@/lib/types";
// Relative, with explicit extensions — see wrapperConsistency.ts's own
// comment: keeps this module resolvable by Node's test runner directly.
import { crossWrapperOutcome, type CrossWrapperOutcome } from "./wrapperConsistency.ts";
import { isInconclusiveProtectionTestModeEnabled } from "./testMode.ts";

export interface ProtectionOfferDecision {
  canOffer: boolean;
  reason: string;
  /** Explicit outcome of the cross-wrapper check specifically — lets a caller (or test) assert WHY, not just whether, protection was offered. */
  crossWrapperOutcome: CrossWrapperOutcome;
  /** True only when `canOffer` is true SOLELY because of the development-only INCONCLUSIVE override — never true for a genuine AGREEMENT. Callers (ProtectionPanel.tsx) must show this distinctly; it must never be presented as "verified". */
  isTestModeOverride: boolean;
}

/**
 * Deterministic eligibility rule, replacing the old binary "WARNING blocks
 * everything" policy: a hard-check FAILURE still blocks outright, and a
 * genuine cross-wrapper DISAGREEMENT still blocks — neither of those is
 * weakened. What changes is INCONCLUSIVE (no trustworthy comparison data
 * available): in production this still blocks, same as before, but it is
 * now reported honestly instead of lumped in with "disagrees"; in
 * development, with an explicit opt-in, it can be overridden so the
 * Protect flow can be end-to-end tested — always labelled as a test-mode
 * override, never as a verified PASS.
 */
export function decideProtectionOffer(result: SafetyGateResult): ProtectionOfferDecision {
  const outcome = crossWrapperOutcome(result.checks.crossWrapperConsistency);

  if (result.status === "FAIL") {
    return {
      canOffer: false,
      reason: `Safety Gate FAILED: ${result.reasons[0] ?? "one or more hard checks did not pass."}`,
      crossWrapperOutcome: outcome,
      isTestModeOverride: false,
    };
  }

  // UNAVAILABLE: no hard check genuinely failed, but at least one couldn't
  // be evaluated (e.g. no independent reference price from any tier) —
  // still blocked, same as before this status existed, just reported
  // honestly instead of as a confirmed failure.
  if (result.status === "UNAVAILABLE") {
    return {
      canOffer: false,
      reason: `Safety Gate could not verify this wrapper: ${result.reasons[0] ?? "one or more required checks are unavailable right now."}`,
      crossWrapperOutcome: outcome,
      isTestModeOverride: false,
    };
  }

  if (outcome === "AGREEMENT") {
    return { canOffer: true, reason: "All Safety Gate checks passed.", crossWrapperOutcome: outcome, isTestModeOverride: false };
  }

  if (outcome === "DISAGREEMENT") {
    return {
      canOffer: false,
      reason:
        "Safety Gate returned WARNING: another wrapper with trustworthy data disagrees on price beyond the safety threshold — protection is not offered until this clears.",
      crossWrapperOutcome: outcome,
      isTestModeOverride: false,
    };
  }

  // outcome === "INCONCLUSIVE": no trustworthy comparison data exists —
  // not a conflict, just an absence. Still blocked by default; overridable
  // only under the explicit, env-gated, dev-only test mode.
  if (isInconclusiveProtectionTestModeEnabled()) {
    return {
      canOffer: true,
      reason:
        "DEVELOPMENT TEST MODE: no trustworthy cross-wrapper comparison data is available, so consistency has NOT been verified. This override exists only for end-to-end testing and must never be enabled in production.",
      crossWrapperOutcome: outcome,
      isTestModeOverride: true,
    };
  }

  return {
    canOffer: false,
    reason:
      "Safety Gate returned WARNING: no trustworthy comparison price is available for this underlying right now — protection is not offered until this clears.",
    crossWrapperOutcome: outcome,
    isTestModeOverride: false,
  };
}
