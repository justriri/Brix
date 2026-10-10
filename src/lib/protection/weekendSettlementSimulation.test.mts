import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateProtectionSettlement,
  recordTrustCheckpoint,
  startProtectionSession,
} from "./protectionMonitoringSession.ts";
import { checkReadyToSign } from "./settlementAuthorizationIssuer.ts";
import { hashProtectionSessionId } from "./settlementAuthorizationCore.ts";
import type { CheckResult, SafetyGateResult } from "@/lib/types";
import type { TrustSnapshot } from "./weekendTrustMonitor.ts";
import type { OnChainPolicySummary } from "./settlementContractReader.ts";

/**
 * End-to-end SIMULATION of a full weekend monitoring window — Friday entry
 * through Monday settlement — using ONLY fabricated-for-this-test
 * TrustSnapshot data (never a real network call, never real prices). This
 * is deliberately an INTEGRATION test across pieces that already have
 * their own unit tests in isolation (protectionMonitoringSession.test.mts
 * doesn't exist as a separate file — this IS that coverage, combined with
 * the newly-added settlement-authorization-readiness check): the point is
 * to prove the REAL functions wired together (startProtectionSession ->
 * recordTrustCheckpoint x3 -> evaluateProtectionSettlement ->
 * checkReadyToSign) produce the right end state for three realistic
 * scenarios, not just that each function is individually correct.
 *
 * Simulated prices are injected directly as SafetyGateResult.primaryReference
 * values on hand-built TrustSnapshot objects — no provider, no fetch, no
 * Binance/Pyth/DexScreener call of any kind. Nothing here ever touches a
 * real RPC, a real contract, or mainnet.
 */

const TRUSTED_SIGNER = "0x803C1a275E70D35bB4F1E73B344e45f614FfA96F" as const;

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "simulated" };
}

/** A fabricated Safety Gate result at a given simulated price — PASS by default, or an explicit FAIL to simulate a genuine data/provider breakdown at that checkpoint. */
function simulatedGate(price: number, status: "PASS" | "FAIL" = "PASS"): SafetyGateResult {
  const hardPass = status === "PASS";
  return {
    status,
    underlying: "TSLA",
    wrapper: "bstocks",
    checks: {
      liquidity: check(hardPass),
      priceFreshness: check(hardPass),
      referenceDeviation: check(hardPass),
      marketStatus: check(hardPass),
      crossWrapperConsistency: check(true),
    },
    primaryReference: { name: "Simulated Pyth TSLA/USD", price, publishTimeSec: 0 },
    reasons: status === "PASS" ? ["All checks passed."] : ["Simulated provider outage for this checkpoint."],
    timestamp: 0,
  };
}

function simulatedSnapshot(checkpoint: TrustSnapshot["checkpoint"], timestamp: number, price: number, status: "PASS" | "FAIL" = "PASS"): TrustSnapshot {
  return { checkpoint, timestamp, safetyGateResult: simulatedGate(price, status) };
}

function matchingOnChainPolicy(sessionId: string): OnChainPolicySummary {
  return {
    policyId: "1",
    owner: "0xf62e44f516B5aCa7A84BF482B95060927f0de167",
    underlyingTicker: "TSLA",
    tokenizedStockContract: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f",
    wrapper: 0,
    coveredPositionValue: BigInt(2_000_000_000_000_000_000),
    thresholdBps: BigInt(500),
    premiumAmount: BigInt(80_000_000_000_000_000),
    maxPayoutAmount: BigInt(2_000_000_000_000_000_000),
    startTime: BigInt(1_700_000_000),
    expiryTime: BigInt(1_700_300_000),
    protectionSessionId: hashProtectionSessionId(sessionId),
    status: 1,
    settled: false,
  };
}

test("SIMULATED SCENARIO — eligible: price drops past the 5% threshold, trust intact the whole window -> SETTLEMENT_ELIGIBLE, ready to sign with eligible:true", () => {
  const sessionId = "sim-eligible-session";
  let session = startProtectionSession({
    sessionId,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 4_000_000,
    thresholdPercent: 5,
    fridaySnapshot: simulatedSnapshot("friday", 1_000_000, 400),
  });
  assert.equal(session.status, "ACTIVE", "Friday's gate passed -> protection genuinely starts");

  session = recordTrustCheckpoint(session, simulatedSnapshot("saturday", 2_000_000, 398));
  session = recordTrustCheckpoint(session, simulatedSnapshot("sunday", 3_000_000, 385));
  session = recordTrustCheckpoint(session, simulatedSnapshot("monday", 4_000_000, 370)); // 400 -> 370 = 7.5% drop, past 5%
  session = evaluateProtectionSettlement(session);

  assert.equal(session.status, "SETTLED");
  assert.equal(session.trustContinuity.status, "TRUST_INTACT");
  assert.equal(session.settlement?.outcome, "SETTLEMENT_ELIGIBLE");
  assert.equal(session.settlement?.thresholdCrossed, true);

  const ready = checkReadyToSign({
    session: { ...session, onChainPolicyId: "1" },
    onChainPolicy: matchingOnChainPolicy(sessionId),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(ready.ok, true, "a genuinely eligible, settled session linked to a matching ACTIVE policy must be ready to sign");
});

test("SIMULATED SCENARIO — ineligible (no payout): trust intact all weekend, but the price drop never reaches the threshold -> NO_PAYOUT, ready to sign with eligible:false", () => {
  const sessionId = "sim-ineligible-session";
  let session = startProtectionSession({
    sessionId,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 4_000_000,
    thresholdPercent: 5,
    fridaySnapshot: simulatedSnapshot("friday", 1_000_000, 400),
  });
  session = recordTrustCheckpoint(session, simulatedSnapshot("saturday", 2_000_000, 399));
  session = recordTrustCheckpoint(session, simulatedSnapshot("sunday", 3_000_000, 397));
  session = recordTrustCheckpoint(session, simulatedSnapshot("monday", 4_000_000, 395)); // 400 -> 395 = 1.25% drop, under 5%
  session = evaluateProtectionSettlement(session);

  assert.equal(session.status, "SETTLED");
  assert.equal(session.trustContinuity.status, "TRUST_INTACT");
  assert.equal(session.settlement?.outcome, "NO_PAYOUT");
  assert.equal(session.settlement?.thresholdCrossed, false);

  const ready = checkReadyToSign({
    session: { ...session, onChainPolicyId: "1" },
    onChainPolicy: matchingOnChainPolicy(sessionId),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(ready.ok, true, "a genuinely-not-eligible decision is still a valid, signable (eligible:false) outcome");
});

test("SIMULATED SCENARIO — inconclusive/untrustworthy: a provider outage breaks trust on Saturday, even though price crashes hard and Monday itself looks fine -> SETTLEMENT_BLOCKED, never silently paid", () => {
  const sessionId = "sim-blocked-session";
  let session = startProtectionSession({
    sessionId,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 4_000_000,
    thresholdPercent: 5,
    fridaySnapshot: simulatedSnapshot("friday", 1_000_000, 400),
  });
  // Saturday's checkpoint simulates exactly the "missing/unreliable data"
  // case the audit worried about — a genuine FAIL (provider outage), not
  // merely a price move. This single broken checkpoint must poison the
  // WHOLE window, even though Sunday/Monday individually look perfect and
  // the price crashed far past the threshold.
  session = recordTrustCheckpoint(session, simulatedSnapshot("saturday", 2_000_000, 400, "FAIL"));
  session = recordTrustCheckpoint(session, simulatedSnapshot("sunday", 3_000_000, 300));
  session = recordTrustCheckpoint(session, simulatedSnapshot("monday", 4_000_000, 250)); // a huge, genuine 37.5% drop
  session = evaluateProtectionSettlement(session);

  assert.equal(session.status, "SETTLED");
  assert.equal(session.trustContinuity.status, "TRUST_BROKEN");
  assert.equal(session.trustContinuity.brokenAt, "saturday");
  assert.equal(
    session.settlement?.outcome,
    "SETTLEMENT_BLOCKED",
    "trust broken earlier in the window must block settlement, even though Monday's own check and the price move both look like a clear payout"
  );

  const ready = checkReadyToSign({
    session: { ...session, onChainPolicyId: "1" },
    onChainPolicy: matchingOnChainPolicy(sessionId),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(ready.ok, true, "BLOCKED is still a valid, signable decision — it carries eligible:false, it is never left unsigned/stuck");
});

test("SIMULATED SCENARIO — Friday's own gate fails -> protection never starts at all, no settlement is ever reachable", () => {
  const sessionId = "sim-never-started-session";
  const session = startProtectionSession({
    sessionId,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 4_000_000,
    thresholdPercent: 5,
    fridaySnapshot: simulatedSnapshot("friday", 1_000_000, 400, "FAIL"), // e.g. no live price at all when the user tried to buy
  });
  assert.equal(session.status, "NOT_STARTED");

  // Recording further checkpoints or attempting to evaluate settlement on a
  // NOT_STARTED session must be a safe no-op (protectionMonitoringSession.ts's
  // own existing guard), never fabricate a decision.
  const afterCheckpoint = recordTrustCheckpoint(session, simulatedSnapshot("saturday", 2_000_000, 300));
  assert.equal(afterCheckpoint.checkpoints.length, 0, "a NOT_STARTED session must never accumulate checkpoints");
  const afterSettle = evaluateProtectionSettlement(afterCheckpoint);
  assert.equal(afterSettle.status, "NOT_STARTED", "never silently becomes SETTLED");
  assert.equal(afterSettle.settlement, undefined);
});
