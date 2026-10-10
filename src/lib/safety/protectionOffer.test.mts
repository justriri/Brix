import { test } from "node:test";
import assert from "node:assert/strict";
import { decideProtectionOffer } from "./protectionOffer.ts";
import type { CheckResult, SafetyGateResult } from "../types.ts";

// Run with: node --experimental-strip-types --test src/lib/safety/*.test.mts

function check(passed: boolean | null, overrides: Partial<CheckResult> = {}): CheckResult {
  return { id: "x", label: "x", passed, severity: "hard", message: "ok", ...overrides };
}

function gate(overrides: Partial<SafetyGateResult> = {}): SafetyGateResult {
  const crossWrapperConsistency = overrides.checks?.crossWrapperConsistency ?? check(true, { severity: "soft" });
  const hardPassed = overrides.status !== "FAIL";
  return {
    status: "PASS",
    underlying: "TSLA",
    wrapper: "bstocks",
    checks: {
      liquidity: check(hardPassed),
      priceFreshness: check(hardPassed),
      referenceDeviation: check(hardPassed),
      marketStatus: check(hardPassed),
      crossWrapperConsistency,
    },
    reasons: ["All checks passed."],
    timestamp: 0,
    ...overrides,
  };
}

// Save/restore so these tests never leak env state into other test files
// (node's test runner may share a process across files in this suite).
async function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("valid comparison data with agreeing prices -> AGREEMENT, offered, not a test-mode override", () => {
  const result = gate({ checks: { ...gate().checks, crossWrapperConsistency: check(true, { severity: "soft" }) } });
  const decision = decideProtectionOffer(result);
  assert.equal(decision.crossWrapperOutcome, "AGREEMENT");
  assert.equal(decision.canOffer, true);
  assert.equal(decision.isTestModeOverride, false);
});

test("valid comparison data with conflicting prices -> DISAGREEMENT, blocked, regardless of test mode", async () => {
  await withEnv({ NODE_ENV: "development", WEEKENDGUARD_ALLOW_INCONCLUSIVE_PROTECTION_TEST: "true" }, () => {
    const result = gate({ status: "WARNING", checks: { ...gate().checks, crossWrapperConsistency: check(false, { severity: "soft" }) } });
    const decision = decideProtectionOffer(result);
    assert.equal(decision.crossWrapperOutcome, "DISAGREEMENT");
    assert.equal(decision.canOffer, false, "a genuine price disagreement must never be offered, even with the dev test-mode override enabled");
    assert.equal(decision.isTestModeOverride, false);
    assert.match(decision.reason, /disagrees/);
  });
});

test("missing comparison markets (INCONCLUSIVE) with test mode OFF -> blocked, same as production default", () => {
  const result = gate({ status: "WARNING", checks: { ...gate().checks, crossWrapperConsistency: check(null, { severity: "soft" }) } });
  const decision = decideProtectionOffer(result);
  assert.equal(decision.crossWrapperOutcome, "INCONCLUSIVE");
  assert.equal(decision.canOffer, false);
  assert.equal(decision.isTestModeOverride, false);
});

test("INCONCLUSIVE with test mode ON (non-production + explicit opt-in) -> offered, explicitly marked as a test-mode override", async () => {
  await withEnv({ NODE_ENV: "development", WEEKENDGUARD_ALLOW_INCONCLUSIVE_PROTECTION_TEST: "true" }, () => {
    const result = gate({ status: "WARNING", checks: { ...gate().checks, crossWrapperConsistency: check(null, { severity: "soft" }) } });
    const decision = decideProtectionOffer(result);
    assert.equal(decision.canOffer, true);
    assert.equal(decision.isTestModeOverride, true, "must be explicitly flagged, never presented as a verified PASS");
    assert.match(decision.reason, /TEST MODE/);
  });
});

test("production cannot use the development override, even with the opt-in var explicitly set to true", async () => {
  await withEnv({ NODE_ENV: "production", WEEKENDGUARD_ALLOW_INCONCLUSIVE_PROTECTION_TEST: "true" }, () => {
    const result = gate({ status: "WARNING", checks: { ...gate().checks, crossWrapperConsistency: check(null, { severity: "soft" }) } });
    const decision = decideProtectionOffer(result);
    assert.equal(decision.canOffer, false, "NODE_ENV=production must block the override regardless of the opt-in var");
    assert.equal(decision.isTestModeOverride, false);
  });
});

test("the override var alone (no NODE_ENV override) does nothing unless explicitly 'true'", async () => {
  await withEnv({ NODE_ENV: "development", WEEKENDGUARD_ALLOW_INCONCLUSIVE_PROTECTION_TEST: undefined }, () => {
    const result = gate({ status: "WARNING", checks: { ...gate().checks, crossWrapperConsistency: check(null, { severity: "soft" }) } });
    const decision = decideProtectionOffer(result);
    assert.equal(decision.canOffer, false, "off by default — must be explicitly opted into, never on just because NODE_ENV isn't production");
  });
});

test("stale/malformed/unavailable data surfaced as a hard-check FAIL still blocks protection outright, even with test mode ON", async () => {
  await withEnv({ NODE_ENV: "development", WEEKENDGUARD_ALLOW_INCONCLUSIVE_PROTECTION_TEST: "true" }, () => {
    const result = gate({
      status: "FAIL",
      reasons: ["Price freshness: data is 6 hours old, beyond the allowed staleness window."],
      checks: {
        liquidity: check(true),
        priceFreshness: check(false),
        referenceDeviation: check(true),
        marketStatus: check(true),
        crossWrapperConsistency: check(null, { severity: "soft" }),
      },
    });
    const decision = decideProtectionOffer(result);
    assert.equal(decision.canOffer, false, "a hard-check failure (stale data here) must block protection regardless of the cross-wrapper outcome or test mode");
    assert.equal(decision.isTestModeOverride, false);
    assert.match(decision.reason, /FAILED/);
  });
});

test("UNAVAILABLE (a hard check couldn't be evaluated, not a confirmed failure) still blocks protection, reported honestly rather than as FAILED", async () => {
  await withEnv({ NODE_ENV: "development", WEEKENDGUARD_ALLOW_INCONCLUSIVE_PROTECTION_TEST: "true" }, () => {
    const result = gate({
      status: "UNAVAILABLE",
      reasons: ["Missing either the wrapper price or an independent reference price from this source — deviation is UNKNOWN, not assumed within bounds."],
      checks: {
        liquidity: check(true),
        priceFreshness: check(true),
        referenceDeviation: check(null),
        marketStatus: check(true),
        crossWrapperConsistency: check(null, { severity: "soft" }),
      },
    });
    const decision = decideProtectionOffer(result);
    assert.equal(decision.canOffer, false, "an unverifiable check must still block protection, same as before this status existed");
    assert.equal(decision.isTestModeOverride, false);
    assert.doesNotMatch(decision.reason, /FAILED/, "must not be worded as a confirmed failure when nothing was actually shown to be wrong");
  });
});

test("insufficient liquidity (a hard-check FAIL) still blocks protection outright, even with test mode ON", async () => {
  await withEnv({ NODE_ENV: "development", WEEKENDGUARD_ALLOW_INCONCLUSIVE_PROTECTION_TEST: "true" }, () => {
    const result = gate({
      status: "FAIL",
      reasons: ["Deepest qualifying BSC pool has only $12,000 total TVL against a trusted quote asset, below the $50,000 threshold."],
      checks: {
        liquidity: check(false),
        priceFreshness: check(true),
        referenceDeviation: check(true),
        marketStatus: check(true),
        crossWrapperConsistency: check(null, { severity: "soft" }),
      },
    });
    const decision = decideProtectionOffer(result);
    assert.equal(decision.canOffer, false);
  });
});
