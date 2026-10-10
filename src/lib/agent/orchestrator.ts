import type { Address } from "viem";
import { scanPositions } from "@/lib/agent/positionScanner";
import { assessPosition } from "@/lib/agent/riskMonitor";
import { getProtectionQuote } from "@/lib/protection/quote";
import { decideProtectionOffer } from "@/lib/safety/protectionOffer";
import type { CrossWrapperOutcome } from "@/lib/safety/wrapperConsistency";
import type { Position, ProtectionQuote, SafetyGateResult } from "@/lib/types";

/**
 * The agent's job, per the build brief: "coordinate the system, not make
 * arbitrary financial decisions." Every decision this module makes
 * (whether protection can be offered, at what quote) is a deterministic
 * function of a SafetyGateResult — never an LLM call. If/when an LLM is
 * added to this app, its role should be limited to explaining these
 * already-decided results in natural language, never to deciding them.
 *
 * Workflow implemented here (build brief section 5):
 *   connect wallet -> detect position -> identify underlying -> run
 *   Safety Gate -> risk assessment -> determine whether protection can be
 *   OFFERED (lib/safety/protectionOffer.ts — see there for the
 *   AGREEMENT/INCONCLUSIVE/DISAGREEMENT split and the dev-only test-mode
 *   override) -> (monitor is riskMonitor.assessAllPositions, called again
 *   later on an interval) -> prepare settlement decision (settlementMonitor,
 *   development-only preview).
 */

export interface PositionAssessment {
  position: Position;
  safetyGateResult: SafetyGateResult;
  canOfferProtection: boolean;
  offerReason: string;
  crossWrapperOutcome: CrossWrapperOutcome;
  /** True only when canOfferProtection is true SOLELY via the dev-only INCONCLUSIVE override — the UI must show this distinctly, never as a verified PASS. See lib/safety/protectionOffer.ts. */
  isTestModeOverride: boolean;
}

export interface PortfolioAssessment {
  assessments: PositionAssessment[];
  warnings: string[];
}

/** Runs the full detect -> assess -> decide workflow for a connected wallet. */
export async function assessPortfolio(owner: Address): Promise<PortfolioAssessment> {
  const { positions, warnings } = await scanPositions(owner);

  const assessments = await Promise.all(
    positions.map(async (position): Promise<PositionAssessment> => {
      const safetyGateResult = await assessPosition(position);
      const decision = decideProtectionOffer(safetyGateResult);
      return {
        position,
        safetyGateResult,
        canOfferProtection: decision.canOffer,
        offerReason: decision.reason,
        crossWrapperOutcome: decision.crossWrapperOutcome,
        isTestModeOverride: decision.isTestModeOverride,
      };
    })
  );

  return { assessments, warnings };
}

/** Gets a development-only protection quote for one already-assessed position, if eligible. */
export async function requestQuoteForPosition(
  assessment: PositionAssessment,
  thresholdPercent: number
): Promise<ProtectionQuote | null> {
  if (!assessment.canOfferProtection) return null;
  return getProtectionQuote({
    position: assessment.position,
    thresholdPercent,
    coverageAmount: assessment.position.usdValue ?? 0,
  });
}
