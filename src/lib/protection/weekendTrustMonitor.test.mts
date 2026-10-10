import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canProtectionStart,
  computeThresholdCrossed,
  decideSettlement,
  evaluateTrustContinuity,
  isCheckpointTrusted,
  runWeekendTrustMonitor,
  type TrustCheckpointLabel,
  type TrustSnapshot,
} from "./weekendTrustMonitor.ts";
import type { CheckResult, SafetyGateResult, SafetyGateStatus } from "@/lib/types";

// Run with: node --experimental-strip-types --test src/lib/protection/*.test.mts
// (type-only imports from "@/lib/types" are erased entirely by --experimental-strip-types
//  and never resolved at runtime — verified empirically before writing this file.)

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "fixture" };
}

/**
 * Builds a minimal, realistic SafetyGateResult fixture for a given target
 * status. For WARNING specifically, all hard checks pass but the soft
 * crossWrapperConsistency check disagrees, mirroring exactly how the real
 * safetyGate.ts rollup produces WARNING vs. FAIL.
 */
function gateResult(status: SafetyGateStatus, referencePrice?: number): SafetyGateResult {
  const hardPass = status !== "FAIL";
  const crossWrapperPassed = status === "PASS" ? true : status === "WARNING" ? false : true;

  return {
    status,
    underlying: "TSLA",
    wrapper: "bstocks",
    checks: {
      liquidity: check(hardPass),
      priceFreshness: check(hardPass),
      referenceDeviation: check(hardPass),
      marketStatus: check(hardPass),
      crossWrapperConsistency: check(crossWrapperPassed),
    },
    primaryReference:
      referencePrice !== undefined
        ? { name: "Pyth Equity.US.TSLA/USD", price: referencePrice, publishTimeSec: 1700000000 }
        : undefined,
    reasons: status === "PASS" ? ["All checks passed."] : [`Safety Gate status was ${status}.`],
    timestamp: 0,
  };
}

function snapshot(checkpoint: TrustCheckpointLabel, status: SafetyGateStatus, referencePrice?: number): TrustSnapshot {
  return { checkpoint, timestamp: 0, safetyGateResult: gateResult(status, referencePrice) };
}

// --- Scenario 1: everything passes, threshold crossed -> SETTLEMENT_ELIGIBLE ---
test("Scenario 1: Friday/Sat/Sun/Monday all PASS, threshold crossed -> SETTLEMENT_ELIGIBLE", () => {
  const result = runWeekendTrustMonitor({
    fridaySnapshot: snapshot("friday", "PASS", 355),
    monitoringSnapshots: [snapshot("saturday", "PASS"), snapshot("sunday", "PASS")],
    mondaySnapshot: snapshot("monday", "PASS", 330), // ~7% drop
    thresholdPercent: 5,
  });

  assert.equal(result.lifecycleStatus, "SETTLED");
  assert.equal(result.trustContinuity?.status, "TRUST_INTACT");
  assert.equal(result.settlement?.outcome, "SETTLEMENT_ELIGIBLE");
  assert.equal(result.settlement?.thresholdCrossed, true);
});

// --- Scenario 2: Pyth becomes stale Sunday (-> FAIL, since a null hard check fails the gate) ---
test("Scenario 2: Pyth stale on Sunday (FAIL), Monday threshold crossed -> SETTLEMENT_BLOCKED", () => {
  const result = runWeekendTrustMonitor({
    fridaySnapshot: snapshot("friday", "PASS", 355),
    monitoringSnapshots: [snapshot("saturday", "PASS"), snapshot("sunday", "FAIL")],
    mondaySnapshot: snapshot("monday", "PASS", 330),
    thresholdPercent: 5,
  });

  assert.equal(result.trustContinuity?.status, "TRUST_BROKEN");
  assert.equal(result.trustContinuity?.brokenAt, "sunday");
  assert.equal(result.settlement?.outcome, "SETTLEMENT_BLOCKED");
});

// --- Scenario 3: wrapper deviation too high Saturday (-> WARNING), recovers Sunday, still blocked ---
test("Scenario 3: wrapper deviation breaks trust Saturday (WARNING), recovers Sunday, Monday crosses -> still SETTLEMENT_BLOCKED (no silent reset)", () => {
  const result = runWeekendTrustMonitor({
    fridaySnapshot: snapshot("friday", "PASS", 355),
    monitoringSnapshots: [snapshot("saturday", "WARNING"), snapshot("sunday", "PASS")],
    mondaySnapshot: snapshot("monday", "PASS", 330),
    thresholdPercent: 5,
  });

  assert.equal(result.trustContinuity?.status, "TRUST_BROKEN");
  assert.equal(result.trustContinuity?.brokenAt, "saturday", "must record the FIRST break, not let Sunday's recovery erase it");
  assert.equal(result.settlement?.outcome, "SETTLEMENT_BLOCKED");
});

// --- Scenario 4: everything passes, threshold NOT crossed -> NO_PAYOUT ---
test("Scenario 4: all PASS, threshold not crossed -> NO_PAYOUT", () => {
  const result = runWeekendTrustMonitor({
    fridaySnapshot: snapshot("friday", "PASS", 355),
    monitoringSnapshots: [snapshot("saturday", "PASS"), snapshot("sunday", "PASS")],
    mondaySnapshot: snapshot("monday", "PASS", 352), // <1% drop, well under a 5% threshold
    thresholdPercent: 5,
  });

  assert.equal(result.trustContinuity?.status, "TRUST_INTACT");
  assert.equal(result.settlement?.outcome, "NO_PAYOUT");
  assert.equal(result.settlement?.thresholdCrossed, false);
});

// --- Scenario 5: Friday fails -> protection cannot start, no settlement at all ---
test("Scenario 5: Friday Safety Gate fails -> PROTECTION_NOT_STARTED, no settlement produced", () => {
  const result = runWeekendTrustMonitor({
    fridaySnapshot: snapshot("friday", "FAIL"),
    monitoringSnapshots: [snapshot("saturday", "PASS"), snapshot("sunday", "PASS")],
    mondaySnapshot: snapshot("monday", "PASS", 330),
    thresholdPercent: 5,
  });

  assert.equal(result.lifecycleStatus, "PROTECTION_NOT_STARTED");
  assert.equal(result.canStart, false);
  assert.equal(result.settlement, undefined);
  assert.equal(result.trustContinuity, undefined);
});

// --- Explicit judgment-call case, not one of the 5 given scenarios: trust broken AND threshold not crossed ---
test("trust broken AND threshold not crossed -> still SETTLEMENT_BLOCKED, never NO_PAYOUT (can't trust a 'nothing owed' read either)", () => {
  const result = runWeekendTrustMonitor({
    fridaySnapshot: snapshot("friday", "PASS", 355),
    monitoringSnapshots: [snapshot("saturday", "FAIL"), snapshot("sunday", "PASS")],
    mondaySnapshot: snapshot("monday", "PASS", 354), // threshold NOT crossed on its face
    thresholdPercent: 5,
  });

  assert.equal(result.settlement?.outcome, "SETTLEMENT_BLOCKED", "untrusted data must never resolve to a confident NO_PAYOUT either");
});

// --- Monday's own gate failing blocks settlement even if Sat/Sun were spotless ---
test("Sat/Sun spotless but Monday's own Safety Gate fails -> SETTLEMENT_BLOCKED", () => {
  const result = runWeekendTrustMonitor({
    fridaySnapshot: snapshot("friday", "PASS", 355),
    monitoringSnapshots: [snapshot("saturday", "PASS"), snapshot("sunday", "PASS")],
    mondaySnapshot: snapshot("monday", "FAIL"),
    thresholdPercent: 5,
  });

  assert.equal(result.trustContinuity?.status, "TRUST_INTACT", "Sat/Sun continuity itself was fine");
  assert.equal(result.settlement?.outcome, "SETTLEMENT_BLOCKED", "but Monday's own failure still blocks settlement");
});

// --- Historical continuity: multiple breaks are all recorded, not just the first ---
test("historical trust continuity records every break's reason, not just the first", () => {
  const continuity = evaluateTrustContinuity([
    snapshot("saturday", "WARNING"),
    snapshot("sunday", "FAIL"),
  ]);

  assert.equal(continuity.status, "TRUST_BROKEN");
  assert.equal(continuity.brokenAt, "saturday");
  assert.equal(continuity.brokenReasons.length, 2, "both breaks should be recorded, not just the first");
});

test("evaluateTrustContinuity with no breaks at all -> TRUST_INTACT, no brokenAt", () => {
  const continuity = evaluateTrustContinuity([snapshot("saturday", "PASS"), snapshot("sunday", "PASS")]);
  assert.equal(continuity.status, "TRUST_INTACT");
  assert.equal(continuity.brokenAt, undefined);
  assert.equal(continuity.brokenReasons.length, 0);
});

// --- Unit tests for the small pure helpers in isolation ---
test("isCheckpointTrusted is true only for PASS, not WARNING or FAIL", () => {
  assert.equal(isCheckpointTrusted(snapshot("friday", "PASS")), true);
  assert.equal(isCheckpointTrusted(snapshot("friday", "WARNING")), false);
  assert.equal(isCheckpointTrusted(snapshot("friday", "FAIL")), false);
});

test("canProtectionStart mirrors isCheckpointTrusted for the Friday snapshot", () => {
  assert.equal(canProtectionStart(snapshot("friday", "PASS")), true);
  assert.equal(canProtectionStart(snapshot("friday", "WARNING")), false);
  assert.equal(canProtectionStart(snapshot("friday", "FAIL")), false);
});

test("computeThresholdCrossed: a drop exactly at the threshold counts as crossed (>=, not >)", () => {
  // 355 -> 337.25 is exactly a 5% drop
  assert.equal(computeThresholdCrossed(355, 337.25, 5), true);
});

test("computeThresholdCrossed: a drop just under the threshold does not count", () => {
  assert.equal(computeThresholdCrossed(355, 340, 5), false); // ~4.23% drop
});

test("computeThresholdCrossed: a price INCREASE never crosses a downside threshold", () => {
  assert.equal(computeThresholdCrossed(355, 400, 5), false);
});

test("decideSettlement is deterministic for identical inputs", () => {
  const trustContinuity = evaluateTrustContinuity([snapshot("saturday", "PASS"), snapshot("sunday", "PASS")]);
  const mondaySnapshot = snapshot("monday", "PASS", 330);
  const a = decideSettlement({ trustContinuity, mondaySnapshot, thresholdCrossed: true });
  const b = decideSettlement({ trustContinuity, mondaySnapshot, thresholdCrossed: true });
  assert.deepEqual(a, b);
});
