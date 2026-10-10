import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReadyToSign } from "./settlementAuthorizationIssuer.ts";
import { hashProtectionSessionId } from "./settlementAuthorizationCore.ts";
import type { ProtectionMonitoringSession } from "./protectionMonitoringSession.ts";
import type { OnChainPolicySummary } from "./settlementContractReader.ts";
import type { CheckResult, SafetyGateResult } from "@/lib/types";
import type { SettlementDecision, TrustContinuityResult, TrustSnapshot } from "./weekendTrustMonitor.ts";

// Run with: node --experimental-strip-types --test src/lib/protection/*.test.mts

const OWNER = "0xf62e44f516B5aCa7A84BF482B95060927f0de167" as const;
const TRUSTED_SIGNER = "0x803C1a275E70D35bB4F1E73B344e45f614FfA96F" as const;
const SESSION_ID = "bstocks-TSLA-0xowner-1700000000000";

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "test data" };
}

function gate(status: "PASS" | "FAIL"): SafetyGateResult {
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
    reasons: ["test"],
    timestamp: 0,
  };
}

function snapshot(): TrustSnapshot {
  return { checkpoint: "monday", timestamp: 2_000_000, safetyGateResult: gate("PASS") };
}

function continuity(status: "TRUST_INTACT" | "TRUST_BROKEN"): TrustContinuityResult {
  return { status, brokenReasons: [], snapshots: [] };
}

function decision(outcome: SettlementDecision["outcome"]): SettlementDecision {
  return {
    outcome,
    reason: "test",
    thresholdCrossed: outcome === "SETTLEMENT_ELIGIBLE",
    trustContinuity: continuity(outcome === "SETTLEMENT_BLOCKED" ? "TRUST_BROKEN" : "TRUST_INTACT"),
    mondaySnapshot: snapshot(),
    isDevelopmentOnly: true,
  };
}

function baseSession(overrides: Partial<ProtectionMonitoringSession> = {}): ProtectionMonitoringSession {
  return {
    sessionId: SESSION_ID,
    underlying: "TSLA",
    wrapper: "bstocks",
    startedAt: 1_000_000,
    expiresAt: 2_000_000,
    thresholdPercent: 5,
    fridaySnapshot: { checkpoint: "friday", timestamp: 1_000_000, safetyGateResult: gate("PASS") },
    checkpoints: [],
    trustContinuity: continuity("TRUST_INTACT"),
    status: "SETTLED",
    settlement: decision("SETTLEMENT_ELIGIBLE"),
    onChainPolicyId: "1",
    ...overrides,
  };
}

function basePolicy(overrides: Partial<OnChainPolicySummary> = {}): OnChainPolicySummary {
  return {
    policyId: "1",
    owner: OWNER,
    underlyingTicker: "TSLA",
    tokenizedStockContract: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f",
    wrapper: 0,
    coveredPositionValue: BigInt(2_000_000_000_000_000_000),
    thresholdBps: BigInt(300),
    premiumAmount: BigInt(80_000_000_000_000_000),
    maxPayoutAmount: BigInt(2_000_000_000_000_000_000),
    startTime: BigInt(1_700_000_000),
    expiryTime: BigInt(1_700_300_000),
    protectionSessionId: hashProtectionSessionId(SESSION_ID),
    status: 1, // ACTIVE
    settled: false,
    ...overrides,
  };
}

test("eligible, settled session with a matching ACTIVE policy and a correctly-configured signer -> ready to sign", () => {
  const result = checkReadyToSign({
    session: baseSession(),
    onChainPolicy: basePolicy(),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.policyId, BigInt(1));
});

test("not-eligible (threshold not crossed) is STILL ready to sign — eligible:false is a valid, signable outcome", () => {
  const result = checkReadyToSign({
    session: baseSession({ settlement: decision("NO_PAYOUT") }),
    onChainPolicy: basePolicy(),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, true);
});

test("blocked (broken trust continuity) is STILL ready to sign, with eligible:false — never silently dropped", () => {
  const result = checkReadyToSign({
    session: baseSession({ settlement: decision("SETTLEMENT_BLOCKED") }),
    onChainPolicy: basePolicy(),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, true);
});

test("session not yet settled -> not ready, explicit reason", () => {
  const result = checkReadyToSign({
    session: baseSession({ status: "ACTIVE", settlement: undefined }),
    onChainPolicy: basePolicy(),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /has not reached a settlement decision/i);
});

test("already has a settlementAuthorization -> idempotent, never re-signs", () => {
  const result = checkReadyToSign({
    session: baseSession({
      settlementAuthorization: {
        domain: { name: "WeekendGuardSettlement", version: "1", chainId: 56, verifyingContract: "0xaaaa000000000000000000000000000000aaaa" },
        authorization: { policyId: "1", eligible: true, finalReferencePrice: "0", settlementTimestamp: "0", authorizationExpiry: "0", nonce: "0" },
        signature: "0x00",
        settlementOutcome: "SETTLEMENT_ELIGIBLE",
        generatedAt: 0,
      },
    }),
    onChainPolicy: basePolicy(),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /already (been )?generated/i);
});

test("no onChainPolicyId -> nothing to authorize", () => {
  const result = checkReadyToSign({
    session: baseSession({ onChainPolicyId: undefined }),
    onChainPolicy: null,
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /not linked to an on-chain policy/i);
});

test("SETTLEMENT_SIGNER_PRIVATE_KEY not configured -> explicit, actionable reason, not a crash", () => {
  const result = checkReadyToSign({
    session: baseSession(),
    onChainPolicy: basePolicy(),
    signerConfigured: false,
    configuredSignerAddress: undefined,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /SETTLEMENT_SIGNER_PRIVATE_KEY/);
});

test("on-chain policy already resolved (status ELIGIBLE, not ACTIVE) -> refuses, already handled", () => {
  const result = checkReadyToSign({
    session: baseSession(),
    onChainPolicy: basePolicy({ status: 2 }),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /not ACTIVE/);
});

test("on-chain policy's protectionSessionId does not match this session -> refuses to sign (binding check)", () => {
  const result = checkReadyToSign({
    session: baseSession(),
    onChainPolicy: basePolicy({ protectionSessionId: hashProtectionSessionId("a-completely-different-session") }),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /does not match this session/);
});

test("configured signer address does not match the contract's trustedSigner() -> refuses, would be rejected on-chain anyway", () => {
  const wrongSigner = "0x1111111111111111111111111111111111111111" as const;
  const result = checkReadyToSign({
    session: baseSession(),
    onChainPolicy: basePolicy(),
    signerConfigured: true,
    configuredSignerAddress: wrongSigner,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /does not match the contract's trustedSigner/);
});

test("could not read the on-chain policy (RPC unreachable) -> explicit reason, not a crash", () => {
  const result = checkReadyToSign({
    session: baseSession(),
    onChainPolicy: null,
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: TRUSTED_SIGNER,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /Could not read the on-chain policy/);
});

test("could not read the contract's trustedSigner() -> explicit reason, not a crash", () => {
  const result = checkReadyToSign({
    session: baseSession(),
    onChainPolicy: basePolicy(),
    signerConfigured: true,
    configuredSignerAddress: TRUSTED_SIGNER,
    onChainTrustedSigner: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /Could not read the contract's trustedSigner/);
});
