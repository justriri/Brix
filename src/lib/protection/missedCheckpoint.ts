import type { CheckResult, SafetyGateResult, SafetyGateStatus } from "@/lib/types";
import type { TrustCheckpointLabel, TrustSnapshot } from "@/lib/protection/weekendTrustMonitor";

/**
 * Chosen, documented behavior for a missed checkpoint (build brief Task 5):
 *
 *   "If a required trust checkpoint was missed during the protection
 *   window, settlement should not be considered fully trustworthy."
 *
 * Implemented WITHOUT any new trust-continuity logic: a missed checkpoint
 * is represented as an explicit, honestly-labelled SYNTHETIC TrustSnapshot
 * with Safety Gate status "FAIL" and a reason that says plainly that the
 * checkpoint was never performed — NOT a fabricated "everything was fine"
 * reading. Recording this through the EXISTING recordTrustCheckpoint() /
 * evaluateTrustContinuity() means a missed checkpoint breaks trust via the
 * exact same, already-tested "a FAIL checkpoint breaks continuity and it
 * is never silently reset by a later pass" rule every other trust failure
 * already uses — no new recovery mechanism, no special-casing anywhere
 * else in the codebase.
 *
 * This was chosen over leaving a gap in `session.checkpoints` (which would
 * make a missed checkpoint invisible to evaluateTrustContinuity() entirely
 * — silently treating the unchecked period as trusted, exactly what the
 * brief says never to do) and over inventing a new "MISSED" status
 * distinct from FAIL (which would require evaluateTrustContinuity() and
 * decideSettlement() to be taught a new state — out of scope per "Do not
 * invent a complicated recovery mechanism").
 */

function missedCheck(checkpoint: TrustCheckpointLabel): CheckResult {
  return {
    id: "missed",
    label: "Checkpoint performed",
    passed: false,
    severity: "hard",
    message: `No monitoring check was performed for ${checkpoint} — the scheduled checkpoint window passed before it could be captured.`,
  };
}

const MISSED_STATUS: SafetyGateStatus = "FAIL";

function buildMissedSafetyGateResult(checkpoint: TrustCheckpointLabel, underlying: string): SafetyGateResult {
  const check = missedCheck(checkpoint);
  return {
    status: MISSED_STATUS,
    underlying,
    wrapper: "unknown",
    checks: {
      liquidity: check,
      priceFreshness: check,
      referenceDeviation: check,
      marketStatus: check,
      crossWrapperConsistency: check,
    },
    reasons: [check.message],
    timestamp: Date.now(),
  };
}

/**
 * Builds the synthetic "missed checkpoint" TrustSnapshot described above.
 * `dueAt` (not the real current clock) is used as the snapshot's own
 * timestamp — it represents when trust SHOULD have been (but wasn't)
 * re-confirmed, which is the historically accurate moment to record.
 */
export function buildMissedCheckpointSnapshot(
  checkpoint: TrustCheckpointLabel,
  dueAt: number,
  underlying: string
): TrustSnapshot {
  return {
    checkpoint,
    timestamp: dueAt,
    safetyGateResult: buildMissedSafetyGateResult(checkpoint, underlying),
  };
}
