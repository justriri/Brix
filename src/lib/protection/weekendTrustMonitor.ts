import type { SafetyGateResult } from "@/lib/types";

/**
 * Weekend Trust Monitor — a deterministic prototype/simulation layer on top
 * of the EXISTING Safety Gate. Implements: Trust -> Protection -> Trust
 * again -> Settlement.
 *
 * KEY DESIGN DECISION, worth stating explicitly: this module reuses
 * SafetyGateResult.status directly as the per-checkpoint trust signal,
 * rather than re-deriving a new aggregate rule. safetyGate.ts's existing
 * rollup already computes status === "PASS" only when every hard check
 * (liquidity, priceFreshness, referenceDeviation, marketStatus) is true
 * AND the soft crossWrapperConsistency check also agrees — which is
 * EXACTLY "price freshness + Pyth reference freshness/deviation + bStocks
 * <-> Ondo deviation + market status + liquidity, where appropriate" from
 * the build brief. No new aggregation logic was written; this is pure
 * reuse. One explicit, named policy decision on top of that reuse: during
 * the ACTIVE monitoring window, a WARNING (cross-wrapper disagreement,
 * which the top-level gate tolerates at entry) counts as a trust failure,
 * not just a FAIL — status !== "PASS" breaks trust here, full stop. This
 * is intentionally stricter than the entry gate, because a live policy is
 * now riding on the data, not just a purchase decision a user can inspect
 * before committing to.
 *
 * "Pyth reference freshness" has no separate CheckResult of its own in the
 * existing architecture — it doesn't need one: resolveFreshIndependentReference()
 * (binanceRwaStock.ts) already declines to populate `referencePrice` at all
 * when Pyth is stale/unavailable, which makes the existing
 * referenceDeviation check report UNKNOWN (passed: null) via its own
 * missing-input branch. So "Pyth stale" already surfaces as
 * referenceDeviation !== true, with zero new code needed to detect it.
 *
 * STILL A SIMULATION: every snapshot below is caller-supplied (real data
 * captured once, or constructed for a test/demo scenario) — this module
 * has no scheduler, no timer, and makes no live calls itself. It never
 * collects a premium or executes a payout; lib/protection/policy.ts
 * remains the only (disabled) gateway to real settlement.
 */

export type TrustCheckpointLabel = "friday" | "saturday" | "sunday" | "monday";

export interface TrustSnapshot {
  checkpoint: TrustCheckpointLabel;
  /** Simulated or real ms epoch — caller-supplied, never read from a live clock here. */
  timestamp: number;
  /** The existing, unmodified SafetyGateResult for this checkpoint. */
  safetyGateResult: SafetyGateResult;
}

/** True iff this checkpoint's Safety Gate reflects a trustworthy state (see module doc for why `=== "PASS"` is the correct, reused rule). */
export function isCheckpointTrusted(snapshot: TrustSnapshot): boolean {
  return snapshot.safetyGateResult.status === "PASS";
}

export type TrustContinuityStatus = "TRUST_INTACT" | "TRUST_BROKEN";

export interface TrustContinuityResult {
  status: TrustContinuityStatus;
  /** The first checkpoint where trust broke, if any. Not overwritten by a later recovery — this is the historical record the build brief calls for. */
  brokenAt?: TrustCheckpointLabel;
  /** Every checkpoint's failure reasons, in order, across the whole monitoring window — not just the first break. */
  brokenReasons: string[];
  snapshots: TrustSnapshot[];
}

/**
 * Folds a sequence of monitoring-window snapshots (Saturday, Sunday, ...)
 * into a single continuity verdict. Once broken, stays broken for the rest
 * of the fold regardless of later snapshots passing — "do not silently
 * reset the policy to healthy just because a later check passes."
 */
export function evaluateTrustContinuity(monitoringSnapshots: TrustSnapshot[]): TrustContinuityResult {
  let status: TrustContinuityStatus = "TRUST_INTACT";
  let brokenAt: TrustCheckpointLabel | undefined;
  const brokenReasons: string[] = [];

  for (const snapshot of monitoringSnapshots) {
    if (!isCheckpointTrusted(snapshot)) {
      if (status === "TRUST_INTACT") {
        status = "TRUST_BROKEN";
        brokenAt = snapshot.checkpoint;
      }
      brokenReasons.push(
        `${snapshot.checkpoint}: ${snapshot.safetyGateResult.reasons[0] ?? `Safety Gate status was ${snapshot.safetyGateResult.status}, not PASS.`}`
      );
    }
  }

  return { status, brokenAt, brokenReasons, snapshots: monitoringSnapshots };
}

/** True iff the Friday Safety Gate passed and protection is allowed to start. Reuses the same `=== "PASS"` rule — no separate "can start" logic. */
export function canProtectionStart(fridaySnapshot: TrustSnapshot): boolean {
  return isCheckpointTrusted(fridaySnapshot);
}

/**
 * Compares the independent reference price recorded at entry (Friday) to
 * the one recorded at resolution (Monday). Pure arithmetic — callers
 * supply the two prices (e.g. from `snapshot.safetyGateResult.primaryReference?.price`)
 * rather than this function reaching into the snapshots itself, keeping it
 * trivially testable in isolation.
 */
export function computeThresholdCrossed(
  fridayReferencePrice: number,
  mondayReferencePrice: number,
  thresholdPercent: number
): boolean {
  const dropPercent = ((fridayReferencePrice - mondayReferencePrice) / fridayReferencePrice) * 100;
  return dropPercent >= thresholdPercent;
}

/**
 * Monday's three possible outcomes, exactly as specified in the build
 * brief. Naming intentionally uses the brief's own UPPER_SNAKE_CASE vocabulary
 * rather than forcing a match to the older, lowercase SettlementOutcome
 * ("would_pay"/"cannot_resolve") in lib/agent/settlementMonitor.ts — that
 * module covers a different, single-point-in-time re-check for the
 * original Position-based flow, not this multi-checkpoint continuity
 * model, and the brief gave explicit names for this concept. See the
 * final report for this naming-convention note.
 */
export type SettlementOutcome = "SETTLEMENT_ELIGIBLE" | "SETTLEMENT_BLOCKED" | "NO_PAYOUT";

export interface SettlementDecision {
  outcome: SettlementOutcome;
  reason: string;
  thresholdCrossed: boolean;
  trustContinuity: TrustContinuityResult;
  mondaySnapshot: TrustSnapshot;
  isDevelopmentOnly: true;
}

/**
 * Monday settlement decision. Trust is evaluated across the WHOLE window —
 * both the Sat/Sun continuity fold and Monday's own Safety Gate — so a
 * Monday-only pass can never paper over an earlier break (brief's
 * historical-continuity requirement), and a Monday-only failure is
 * sufficient to block even if Sat/Sun were spotless.
 *
 * One case the brief's 5 example scenarios don't explicitly cover: trust
 * broken AND the threshold was NOT crossed. Resolved here, explicitly, in
 * favor of the brief's own core product rule — "WeekendGuard should not
 * pay based on a price it can no longer trust" — read as applying to
 * confidently declaring NO_PAYOUT too, not just to declaring ELIGIBLE: if
 * the data can't be trusted, we can't confidently say nothing was owed
 * either, so this still resolves to SETTLEMENT_BLOCKED rather than
 * NO_PAYOUT. See the final report for this explicit judgment call.
 */
export function decideSettlement(params: {
  trustContinuity: TrustContinuityResult;
  mondaySnapshot: TrustSnapshot;
  thresholdCrossed: boolean;
}): SettlementDecision {
  const mondayTrusted = isCheckpointTrusted(params.mondaySnapshot);
  const windowTrustBroken = params.trustContinuity.status === "TRUST_BROKEN" || !mondayTrusted;

  if (windowTrustBroken) {
    return {
      outcome: "SETTLEMENT_BLOCKED",
      reason: !mondayTrusted
        ? `Final Safety Gate did not pass at settlement (status: ${params.mondaySnapshot.safetyGateResult.status}) — the data needed to settle cannot itself be trusted.`
        : `Trust was broken earlier in the protection window (first at ${params.trustContinuity.brokenAt}) and the window's historical continuity record is never reset by a later recovery — settlement is blocked even though Monday's own check passed.`,
      thresholdCrossed: params.thresholdCrossed,
      trustContinuity: params.trustContinuity,
      mondaySnapshot: params.mondaySnapshot,
      isDevelopmentOnly: true,
    };
  }

  if (params.thresholdCrossed) {
    return {
      outcome: "SETTLEMENT_ELIGIBLE",
      reason: "Trust remained valid throughout the protection window, the final Safety Gate passed, and the protection threshold was crossed.",
      thresholdCrossed: true,
      trustContinuity: params.trustContinuity,
      mondaySnapshot: params.mondaySnapshot,
      isDevelopmentOnly: true,
    };
  }

  return {
    outcome: "NO_PAYOUT",
    reason: "Trust remained valid throughout the protection window and the final Safety Gate passed, but the protection threshold was not crossed.",
    thresholdCrossed: false,
    trustContinuity: params.trustContinuity,
    mondaySnapshot: params.mondaySnapshot,
    isDevelopmentOnly: true,
  };
}

export type ProtectionLifecycleStatus = "PROTECTION_NOT_STARTED" | "SETTLED";

export interface WeekendTrustMonitorResult {
  lifecycleStatus: ProtectionLifecycleStatus;
  canStart: boolean;
  fridaySnapshot: TrustSnapshot;
  monitoringSnapshots: TrustSnapshot[];
  /** undefined iff protection never started (Friday gate failed). */
  trustContinuity?: TrustContinuityResult;
  mondaySnapshot?: TrustSnapshot;
  settlement?: SettlementDecision;
  isDevelopmentOnly: true;
}

/**
 * The full Friday -> Saturday/Sunday -> Monday lifecycle in one deterministic
 * call. If Friday's gate didn't pass, protection never starts and nothing
 * past that point is evaluated — matching "protection should also only be
 * available when the initial Safety Gate passes."
 */
export function runWeekendTrustMonitor(params: {
  fridaySnapshot: TrustSnapshot;
  monitoringSnapshots: TrustSnapshot[];
  mondaySnapshot: TrustSnapshot;
  thresholdPercent: number;
}): WeekendTrustMonitorResult {
  const canStart = canProtectionStart(params.fridaySnapshot);

  if (!canStart) {
    return {
      lifecycleStatus: "PROTECTION_NOT_STARTED",
      canStart: false,
      fridaySnapshot: params.fridaySnapshot,
      monitoringSnapshots: params.monitoringSnapshots,
      isDevelopmentOnly: true,
    };
  }

  const trustContinuity = evaluateTrustContinuity(params.monitoringSnapshots);

  const fridayRef = params.fridaySnapshot.safetyGateResult.primaryReference?.price;
  const mondayRef = params.mondaySnapshot.safetyGateResult.primaryReference?.price;
  // If either reference price is missing, there's nothing to compare — a
  // missing Monday reference already means mondaySnapshot's gate isn't
  // PASS (referenceDeviation requires both prices), so decideSettlement()
  // will independently route this to SETTLEMENT_BLOCKED regardless of this
  // fallback's value; `false` here is never load-bearing in that case.
  const thresholdCrossed =
    fridayRef !== undefined && mondayRef !== undefined
      ? computeThresholdCrossed(fridayRef, mondayRef, params.thresholdPercent)
      : false;

  const settlement = decideSettlement({ trustContinuity, mondaySnapshot: params.mondaySnapshot, thresholdCrossed });

  return {
    lifecycleStatus: "SETTLED",
    canStart: true,
    fridaySnapshot: params.fridaySnapshot,
    monitoringSnapshots: params.monitoringSnapshots,
    trustContinuity,
    mondaySnapshot: params.mondaySnapshot,
    settlement,
    isDevelopmentOnly: true,
  };
}
