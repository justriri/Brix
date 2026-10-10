import { test } from "node:test";
import assert from "node:assert/strict";
import { getRealTrustSnapshot, type AssessmentLike, type FetchAssessmentsFn } from "./trustSnapshot.ts";
import { isCheckpointTrusted } from "./weekendTrustMonitor.ts";
import type { CheckResult, SafetyGateResult, SafetyGateStatus } from "@/lib/types";

// Run with: node --experimental-strip-types --test src/lib/protection/*.test.mts
// No network/provider calls happen in this file — assessTickerViaBinanceRwa
// is replaced entirely by a fake fetchAssessments(), per the build brief's
// "mock the providers in unit tests rather than depending on live internet
// data."

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "fixture" };
}

function gateResult(status: SafetyGateStatus, wrapper: "bstocks" | "ondo" = "bstocks"): SafetyGateResult {
  const hardPass = status !== "FAIL";
  return {
    status,
    underlying: "TSLA",
    wrapper,
    checks: {
      liquidity: check(hardPass),
      priceFreshness: check(hardPass),
      referenceDeviation: check(hardPass),
      marketStatus: check(hardPass),
      crossWrapperConsistency: check(status === "PASS" ? true : status === "WARNING" ? false : true),
    },
    reasons: status === "PASS" ? ["All checks passed."] : [`Status was ${status}.`],
    timestamp: 0,
  };
}

function fakeAssessment(wrapper: "bstocks" | "ondo", status: SafetyGateStatus): AssessmentLike {
  return { stock: { wrapper }, safetyGateResult: gateResult(status, wrapper) };
}

function fakeFetcher(assessments: AssessmentLike[], warnings: string[] = []): FetchAssessmentsFn {
  return async () => ({ assessments, warnings });
}

test("produces a real-shaped TrustSnapshot from a matching mocked assessment", async () => {
  const fetcher = fakeFetcher([fakeAssessment("bstocks", "PASS"), fakeAssessment("ondo", "FAIL")]);

  const result = await getRealTrustSnapshot("TSLA", "bstocks", "friday", fetcher, 12345);

  assert.ok(result.snapshot);
  assert.equal(result.snapshot!.checkpoint, "friday");
  assert.equal(result.snapshot!.timestamp, 12345);
  assert.equal(result.snapshot!.safetyGateResult.status, "PASS");
  assert.equal(result.snapshot!.safetyGateResult.wrapper, "bstocks");
});

test("picks the assessment matching the requested wrapper, not just the first one", async () => {
  const fetcher = fakeFetcher([fakeAssessment("ondo", "FAIL"), fakeAssessment("bstocks", "PASS")]);

  const result = await getRealTrustSnapshot("TSLA", "ondo", "friday", fetcher);

  assert.equal(result.snapshot!.safetyGateResult.status, "FAIL");
  assert.equal(result.snapshot!.safetyGateResult.wrapper, "ondo");
});

test("no matching wrapper found -> snapshot is null, with a clear warning, never fabricated", async () => {
  const fetcher = fakeFetcher([fakeAssessment("bstocks", "PASS")]);

  const result = await getRealTrustSnapshot("TSLA", "ondo", "friday", fetcher);

  assert.equal(result.snapshot, null);
  assert.ok(result.warnings.some((w) => w.includes("ondo")));
});

test("upstream warnings are preserved alongside the snapshot, not swallowed", async () => {
  const fetcher = fakeFetcher([fakeAssessment("bstocks", "PASS")], ["Binance RWA search for \"TSLA\" returned no BSC bStocks/Ondo tokens."]);

  const result = await getRealTrustSnapshot("TSLA", "bstocks", "friday", fetcher);

  assert.ok(result.snapshot);
  assert.ok(result.warnings.includes("Binance RWA search for \"TSLA\" returned no BSC bStocks/Ondo tokens."));
});

test("defaults the timestamp to the current clock when not supplied", async () => {
  const before = Date.now();
  const result = await getRealTrustSnapshot("TSLA", "bstocks", "friday", fakeFetcher([fakeAssessment("bstocks", "PASS")]));
  const after = Date.now();

  assert.ok(result.snapshot!.timestamp >= before && result.snapshot!.timestamp <= after);
});

test("a real-shaped snapshot plugs directly into the existing isCheckpointTrusted() from weekendTrustMonitor.ts with no adapter code needed", async () => {
  const trusted = await getRealTrustSnapshot("TSLA", "bstocks", "friday", fakeFetcher([fakeAssessment("bstocks", "PASS")]));
  const broken = await getRealTrustSnapshot("TSLA", "bstocks", "friday", fakeFetcher([fakeAssessment("bstocks", "WARNING")]));

  assert.equal(isCheckpointTrusted(trusted.snapshot!), true);
  assert.equal(isCheckpointTrusted(broken.snapshot!), false);
});

test("a rejected fetchAssessments propagates (no silent swallowing of a hard failure)", async () => {
  const failingFetcher: FetchAssessmentsFn = async () => {
    throw new Error("simulated provider outage");
  };

  await assert.rejects(() => getRealTrustSnapshot("TSLA", "bstocks", "friday", failingFetcher), /simulated provider outage/);
});
