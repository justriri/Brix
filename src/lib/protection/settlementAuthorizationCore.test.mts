import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSettlementAuthorizationMessage,
  evaluateAuthorizationRequest,
  hashProtectionSessionId,
  type OnChainPolicyLike,
  type SessionLike,
} from "./settlementAuthorizationCore.ts";
import { decideSettlement, type TrustContinuityResult, type TrustSnapshot } from "./weekendTrustMonitor.ts";
import type { CheckResult, SafetyGateResult, SafetyGateStatus } from "@/lib/types";

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "test" };
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
      crossWrapperConsistency: check(status === "PASS"),
    },
    primaryReference:
      referencePrice !== undefined ? { name: "Pyth Equity.US.TSLA/USD", price: referencePrice, publishTimeSec: 1700000000 } : undefined,
    reasons: [status],
    timestamp: 0,
  };
}

function mondaySnap(status: SafetyGateStatus, timestamp: number, referencePrice?: number): TrustSnapshot {
  return { checkpoint: "monday", timestamp, safetyGateResult: gateResult(status, referencePrice) };
}

const INTACT: TrustContinuityResult = { status: "TRUST_INTACT", brokenReasons: [], snapshots: [] };
const BROKEN: TrustContinuityResult = { status: "TRUST_BROKEN", brokenAt: "sunday", brokenReasons: ["sunday: FAIL"], snapshots: [] };

test("SETTLEMENT_ELIGIBLE decision -> eligible: true, reference price scaled by 1e8", () => {
  const decision = decideSettlement({
    trustContinuity: INTACT,
    mondaySnapshot: mondaySnap("PASS", 4_000_000, 330.5),
    thresholdCrossed: true,
  });
  assert.equal(decision.outcome, "SETTLEMENT_ELIGIBLE");

  const msg = buildSettlementAuthorizationMessage({ decision, policyId: 7n, nonce: 1n, now: 5_000_000 });
  assert.equal(msg.eligible, true);
  assert.equal(msg.policyId, 7n);
  assert.equal(msg.nonce, 1n);
  assert.equal(msg.finalReferencePrice, 33_050_000_000n); // 330.5 * 1e8
  assert.equal(msg.settlementTimestamp, 4_000n); // 4_000_000ms -> 4000s
});

test("SETTLEMENT_BLOCKED decision -> eligible: false, even though threshold was crossed", () => {
  const decision = decideSettlement({
    trustContinuity: BROKEN,
    mondaySnapshot: mondaySnap("PASS", 4_000_000, 300),
    thresholdCrossed: true,
  });
  assert.equal(decision.outcome, "SETTLEMENT_BLOCKED");

  const msg = buildSettlementAuthorizationMessage({ decision, policyId: 1n, nonce: 2n });
  assert.equal(msg.eligible, false);
});

test("NO_PAYOUT decision -> eligible: false", () => {
  const decision = decideSettlement({
    trustContinuity: INTACT,
    mondaySnapshot: mondaySnap("PASS", 4_000_000, 354),
    thresholdCrossed: false,
  });
  assert.equal(decision.outcome, "NO_PAYOUT");

  const msg = buildSettlementAuthorizationMessage({ decision, policyId: 1n, nonce: 3n });
  assert.equal(msg.eligible, false);
});

test("missing reference price (trust broken, Monday's own gate failed) -> finalReferencePrice is 0, never fabricated", () => {
  const decision = decideSettlement({
    trustContinuity: INTACT,
    mondaySnapshot: mondaySnap("FAIL", 4_000_000, undefined),
    thresholdCrossed: false,
  });
  assert.equal(decision.outcome, "SETTLEMENT_BLOCKED");

  const msg = buildSettlementAuthorizationMessage({ decision, policyId: 1n, nonce: 4n });
  assert.equal(msg.finalReferencePrice, 0n);
  assert.equal(msg.eligible, false);
});

test("authorizationExpiry defaults to now + 1 hour, and respects an explicit override", () => {
  const decision = decideSettlement({
    trustContinuity: INTACT,
    mondaySnapshot: mondaySnap("PASS", 4_000_000, 330),
    thresholdCrossed: true,
  });

  const defaultMsg = buildSettlementAuthorizationMessage({ decision, policyId: 1n, nonce: 1n, now: 10_000_000 });
  assert.equal(defaultMsg.authorizationExpiry, 10_000n + 3600n);

  const customMsg = buildSettlementAuthorizationMessage({
    decision,
    policyId: 1n,
    nonce: 1n,
    now: 10_000_000,
    authorizationValiditySeconds: 60n,
  });
  assert.equal(customMsg.authorizationExpiry, 10_000n + 60n);
});

// ---------------------------------------------------------------------
// SECURITY PATCH tests (reports/Settlement audit and deployment readiness.md,
// sections E/L): evaluateAuthorizationRequest() is the ONLY place that
// decides whether a settlement authorization may be signed — these tests
// exercise it directly with fake session/on-chain-policy objects, no
// network or real signing involved, mirroring the brief's exact adversarial
// list (valid / cross-binding / reverse cross-binding / missing policy /
// missing session).
// ---------------------------------------------------------------------

function eligibleSession(): SessionLike {
  const decision = decideSettlement({
    trustContinuity: INTACT,
    mondaySnapshot: mondaySnap("PASS", 4_000_000, 330),
    thresholdCrossed: true,
  });
  return { status: "SETTLED", settlement: decision };
}

function onChainPolicyFor(sessionId: string, status = 1 /* ACTIVE */): OnChainPolicyLike {
  return { protectionSessionId: hashProtectionSessionId(sessionId), status };
}

test("valid case: session A's own policy binds and authorizes successfully", () => {
  const result = evaluateAuthorizationRequest({
    sessionId: "session-A",
    policyId: 1n,
    nonce: 1n,
    session: eligibleSession(),
    onChainPolicy: onChainPolicyFor("session-A"),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.settlementOutcome, "SETTLEMENT_ELIGIBLE");
    assert.equal(result.message.eligible, true);
  }
});

test("cross-binding attack: session A's data requested against policy B (bound to a different session) is rejected", () => {
  const result = evaluateAuthorizationRequest({
    sessionId: "session-A",
    policyId: 2n,
    nonce: 1n,
    session: eligibleSession(),
    // policy 2's own on-chain record is bound to "session-B", not "session-A"
    onChainPolicy: onChainPolicyFor("session-B"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 403);
    assert.match(result.error, /does not match the on-chain policy/);
  }
});

test("reverse cross-binding: session B requested against policy A (bound to session A) is also rejected", () => {
  const result = evaluateAuthorizationRequest({
    sessionId: "session-B",
    policyId: 1n,
    nonce: 1n,
    session: eligibleSession(),
    // policy 1's own on-chain record is bound to "session-A", not "session-B"
    onChainPolicy: onChainPolicyFor("session-A"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 403);
  }
});

test("missing on-chain policy (never created, status NONE) is rejected, not treated as a binding match", () => {
  const result = evaluateAuthorizationRequest({
    sessionId: "session-A",
    policyId: 999n,
    nonce: 1n,
    session: eligibleSession(),
    onChainPolicy: { protectionSessionId: hashProtectionSessionId("session-A"), status: 0 /* NONE */ },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
    assert.match(result.error, /No on-chain policy exists/);
  }
});

test("unreachable/misconfigured contract (onChainPolicy is null) fails closed, never signs", () => {
  const result = evaluateAuthorizationRequest({
    sessionId: "session-A",
    policyId: 1n,
    nonce: 1n,
    session: eligibleSession(),
    onChainPolicy: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 502);
  }
});

test("missing session (never created) is rejected", () => {
  const result = evaluateAuthorizationRequest({
    sessionId: "never-existed",
    policyId: 1n,
    nonce: 1n,
    session: undefined,
    onChainPolicy: onChainPolicyFor("never-existed"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
    assert.match(result.error, /No session found/);
  }
});

test("binding is checked BEFORE eligibility: a mismatched policy is rejected even if the session is not yet settled", () => {
  const notYetSettled: SessionLike = { status: "ACTIVE" };
  const result = evaluateAuthorizationRequest({
    sessionId: "session-A",
    policyId: 1n,
    nonce: 1n,
    session: notYetSettled,
    onChainPolicy: onChainPolicyFor("session-B"), // mismatched on purpose
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    // Must fail with the BINDING error (403), not the "not settled yet" error (409) —
    // proving binding is checked first, per the audit's required ordering.
    assert.equal(result.status, 403);
  }
});

test("a correctly-bound policy whose session has not reached SETTLED yet is rejected (409), distinct from a binding mismatch", () => {
  const notYetSettled: SessionLike = { status: "ACTIVE" };
  const result = evaluateAuthorizationRequest({
    sessionId: "session-A",
    policyId: 1n,
    nonce: 1n,
    session: notYetSettled,
    onChainPolicy: onChainPolicyFor("session-A"), // correctly bound
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
  }
});
