import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateProtectionSettlement,
  getFirstTrustBreakTimestamp,
  linkOnChainPolicy,
  recordTrustCheckpoint,
  startProtectionSession,
  type ProtectionMonitoringSession,
} from "./protectionMonitoringSession.ts";
import { decideSettlement, evaluateTrustContinuity, type TrustCheckpointLabel } from "./weekendTrustMonitor.ts";
import type { CheckResult, SafetyGateResult, SafetyGateStatus } from "@/lib/types";

// Run with: node --experimental-strip-types --test src/lib/protection/*.test.mts

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "fixture" };
}

function gateResult(status: SafetyGateStatus, referencePrice?: number): SafetyGateResult {
  const hardPass = status !== "FAIL";
  return {
    status,
    underlying: "TSLA",
    wrapper: "bstocks",
    checks: {
      liquidity: check(hardPass),
      priceFreshness: check(hardPass),
      referenceDeviation: check(hardPass),
      marketStatus: check(hardPass),
      crossWrapperConsistency: check(status === "PASS" ? true : status === "WARNING" ? false : true),
    },
    primaryReference:
      referencePrice !== undefined
        ? { name: "Pyth Equity.US.TSLA/USD", price: referencePrice, publishTimeSec: 1700000000 }
        : undefined,
    reasons: status === "PASS" ? ["All checks passed."] : [`Safety Gate status was ${status}.`],
    timestamp: 0,
  };
}

function snapshot(checkpoint: TrustCheckpointLabel, status: SafetyGateStatus, timestamp: number, referencePrice?: number) {
  return { checkpoint, timestamp, safetyGateResult: gateResult(status, referencePrice) };
}

function freshSession(fridayStatus: SafetyGateStatus = "PASS", fridayRef = 355): ProtectionMonitoringSession {
  return startProtectionSession({
    sessionId: "test-session",
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999_999,
    thresholdPercent: 5,
    fridaySnapshot: snapshot("friday", fridayStatus, 1, fridayRef),
  });
}

// --- Session creation ---

test("a trusted Friday snapshot starts the session as ACTIVE", () => {
  const session = freshSession("PASS");
  assert.equal(session.status, "ACTIVE");
  assert.equal(session.checkpoints.length, 0);
  assert.equal(session.trustContinuity.status, "TRUST_INTACT");
});

test("a failed Friday snapshot means protection cannot start (NOT_STARTED)", () => {
  const session = freshSession("FAIL");
  assert.equal(session.status, "NOT_STARTED");
});

test("linkOnChainPolicy attaches a policy id without mutating the original session", () => {
  const session = freshSession("PASS");
  const linked = linkOnChainPolicy(session, "42");
  assert.equal(linked.onChainPolicyId, "42");
  assert.equal(session.onChainPolicyId, undefined, "the original session object must be untouched");
  assert.equal(linked.status, session.status, "linking a policy must not change any trust/settlement state");
});

test("startedAt is taken from the Friday snapshot's own timestamp", () => {
  const session = startProtectionSession({
    sessionId: "s",
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999,
    thresholdPercent: 5,
    fridaySnapshot: snapshot("friday", "PASS", 42424, 355),
  });
  assert.equal(session.startedAt, 42424);
});

// --- Checkpoints ---

test("a PASS checkpoint keeps the session healthy (TRUST_INTACT)", () => {
  let session = freshSession();
  session = recordTrustCheckpoint(session, snapshot("saturday", "PASS", 2));
  assert.equal(session.trustContinuity.status, "TRUST_INTACT");
  assert.equal(session.checkpoints.length, 1);
});

test("a failed checkpoint marks trust as broken", () => {
  let session = freshSession();
  session = recordTrustCheckpoint(session, snapshot("saturday", "FAIL", 2));
  assert.equal(session.trustContinuity.status, "TRUST_BROKEN");
  assert.equal(session.trustContinuity.brokenAt, "saturday");
});

test("a later PASS does not erase a previous failure", () => {
  let session = freshSession();
  session = recordTrustCheckpoint(session, snapshot("saturday", "PASS", 2));
  session = recordTrustCheckpoint(session, snapshot("sunday", "FAIL", 3));
  session = recordTrustCheckpoint(session, snapshot("monday", "PASS", 4, 330));

  assert.equal(session.trustContinuity.status, "TRUST_BROKEN", "a later PASS must not reset continuity to intact");
  assert.equal(session.trustContinuity.brokenAt, "sunday", "must still point at the FIRST break, not be overwritten");
});

test("the first failure timestamp is preserved even after later checkpoints", () => {
  let session = freshSession();
  session = recordTrustCheckpoint(session, snapshot("saturday", "PASS", 2));
  session = recordTrustCheckpoint(session, snapshot("sunday", "FAIL", 3));
  session = recordTrustCheckpoint(session, snapshot("monday", "PASS", 4, 330));

  assert.equal(getFirstTrustBreakTimestamp(session), 3, "must be Sunday's own timestamp (3), not Monday's (4) or Friday's (1)");
});

test("multiple failures are all recorded, not just the first", () => {
  let session = freshSession();
  session = recordTrustCheckpoint(session, snapshot("saturday", "WARNING", 2));
  session = recordTrustCheckpoint(session, snapshot("sunday", "FAIL", 3));

  assert.equal(session.trustContinuity.brokenReasons.length, 2);
  assert.equal(session.trustContinuity.brokenAt, "saturday", "brokenAt is still the FIRST one even though both are recorded");
});

test("recording a checkpoint on a NOT_STARTED session is a no-op, not an error", () => {
  const notStarted = freshSession("FAIL");
  const result = recordTrustCheckpoint(notStarted, snapshot("saturday", "PASS", 2));
  assert.deepEqual(result, notStarted);
});

test("recording a checkpoint on an already-SETTLED session is a no-op", () => {
  let session = freshSession();
  session = recordTrustCheckpoint(session, snapshot("monday", "PASS", 2, 330));
  session = evaluateProtectionSettlement(session);
  assert.equal(session.status, "SETTLED");

  const after = recordTrustCheckpoint(session, snapshot("saturday", "PASS", 99));
  assert.deepEqual(after, session, "a settled session's history must not change");
});

// --- Settlement ---

test("valid trust + threshold crossed -> SETTLEMENT_ELIGIBLE", () => {
  let session = freshSession("PASS", 355);
  session = recordTrustCheckpoint(session, snapshot("saturday", "PASS", 2));
  session = recordTrustCheckpoint(session, snapshot("sunday", "PASS", 3));
  session = recordTrustCheckpoint(session, snapshot("monday", "PASS", 4, 330)); // ~7% drop
  session = evaluateProtectionSettlement(session);

  assert.equal(session.status, "SETTLED");
  assert.equal(session.settlement?.outcome, "SETTLEMENT_ELIGIBLE");
});

test("broken trust + threshold crossed -> SETTLEMENT_BLOCKED", () => {
  let session = freshSession("PASS", 355);
  session = recordTrustCheckpoint(session, snapshot("saturday", "PASS", 2));
  session = recordTrustCheckpoint(session, snapshot("sunday", "FAIL", 3));
  session = recordTrustCheckpoint(session, snapshot("monday", "PASS", 4, 330));
  session = evaluateProtectionSettlement(session);

  assert.equal(session.settlement?.outcome, "SETTLEMENT_BLOCKED");
});

test("valid trust + threshold NOT crossed -> NO_PAYOUT", () => {
  let session = freshSession("PASS", 355);
  session = recordTrustCheckpoint(session, snapshot("saturday", "PASS", 2));
  session = recordTrustCheckpoint(session, snapshot("sunday", "PASS", 3));
  session = recordTrustCheckpoint(session, snapshot("monday", "PASS", 4, 352)); // <1% drop
  session = evaluateProtectionSettlement(session);

  assert.equal(session.settlement?.outcome, "NO_PAYOUT");
});

test("broken trust + threshold NOT crossed -> still SETTLEMENT_BLOCKED, never NO_PAYOUT", () => {
  let session = freshSession("PASS", 355);
  session = recordTrustCheckpoint(session, snapshot("saturday", "FAIL", 2));
  session = recordTrustCheckpoint(session, snapshot("sunday", "PASS", 3));
  session = recordTrustCheckpoint(session, snapshot("monday", "PASS", 4, 354));
  session = evaluateProtectionSettlement(session);

  assert.equal(session.settlement?.outcome, "SETTLEMENT_BLOCKED");
});

test("final Safety Gate failure on Monday itself -> SETTLEMENT_BLOCKED, even with a spotless Sat/Sun", () => {
  let session = freshSession("PASS", 355);
  session = recordTrustCheckpoint(session, snapshot("saturday", "PASS", 2));
  session = recordTrustCheckpoint(session, snapshot("sunday", "PASS", 3));
  // Captured BEFORE Monday is recorded, specifically to check Sat/Sun's own
  // continuity in isolation — trustContinuity after this point correctly
  // includes Monday's own checkpoint too (it folds the whole history), so
  // checking it post-Monday would conflate the two things being tested.
  const continuityBeforeMonday = session.trustContinuity;

  session = recordTrustCheckpoint(session, snapshot("monday", "FAIL", 4));
  session = evaluateProtectionSettlement(session);

  assert.equal(continuityBeforeMonday.status, "TRUST_INTACT", "Sat/Sun continuity was fine on its own");
  assert.equal(session.settlement?.outcome, "SETTLEMENT_BLOCKED", "but Monday's own failure still blocks it");
});

test("no valid active session (never started) -> settlement cannot proceed", () => {
  const notStarted = freshSession("FAIL");
  const result = evaluateProtectionSettlement(notStarted);
  assert.equal(result.status, "NOT_STARTED");
  assert.equal(result.settlement, undefined);
});

test("no valid active session (no Monday checkpoint recorded yet) -> settlement cannot proceed", () => {
  let session = freshSession();
  session = recordTrustCheckpoint(session, snapshot("saturday", "PASS", 2));
  const result = evaluateProtectionSettlement(session);

  assert.equal(result.status, "ACTIVE", "must remain ACTIVE, not be force-settled with no Monday data");
  assert.equal(result.settlement, undefined);
});

// --- No duplication of Safety Gate / Weekend Trust Monitor logic ---

test("the session's continuity result is behaviorally identical to calling evaluateTrustContinuity() directly on the same history — proving no separate/duplicated logic", () => {
  let session = freshSession();
  const sat = snapshot("saturday", "WARNING", 2);
  const sun = snapshot("sunday", "PASS", 3);
  session = recordTrustCheckpoint(session, sat);
  session = recordTrustCheckpoint(session, sun);

  const independentlyComputed = evaluateTrustContinuity([sat, sun]);
  assert.deepEqual(session.trustContinuity, independentlyComputed);
});

test("the session's settlement result is behaviorally identical to calling decideSettlement() directly — proving no separate/duplicated settlement rules", () => {
  let session = freshSession("PASS", 355);
  const sat = snapshot("saturday", "PASS", 2);
  const mon = snapshot("monday", "PASS", 4, 330);
  session = recordTrustCheckpoint(session, sat);
  session = recordTrustCheckpoint(session, mon);
  session = evaluateProtectionSettlement(session);

  const independentContinuity = evaluateTrustContinuity([sat, mon]);
  const independentSettlement = decideSettlement({
    trustContinuity: independentContinuity,
    mondaySnapshot: mon,
    thresholdCrossed: true,
  });

  assert.deepEqual(session.settlement, independentSettlement);
});
