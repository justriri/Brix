import { test } from "node:test";
import assert from "node:assert/strict";
import { compareCandidates } from "./compareCandidates.ts";
import { evaluateCandidate } from "./evaluateCandidate.ts";
import type { CheckResult, SafetyGateResult, SafetyGateStatus, TokenizedStock, Wrapper } from "@/lib/types";

function check(passed: boolean | null, message = "test"): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message };
}

function stock(wrapper: Wrapper, overrides: Partial<TokenizedStock> = {}): TokenizedStock {
  return {
    underlying: "TSLA",
    name: `TSLA (${wrapper})`,
    wrapper,
    chain: "bsc",
    price: 355,
    source: "binance-rwa",
    health: "healthy",
    ...overrides,
  };
}

function gate(status: SafetyGateStatus, wrapper: Wrapper, checks: Partial<SafetyGateResult["checks"]> = {}): SafetyGateResult {
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
      crossWrapperConsistency: check(status === "PASS"),
      ...checks,
    },
    reasons: [status],
    timestamp: 0,
  };
}

test("wrapper comparison: when one wrapper fails liquidity and the other passes, the difference names exactly that check and reason", () => {
  const bstocks = evaluateCandidate(stock("bstocks"), gate("PASS", "bstocks"));
  const ondo = evaluateCandidate(
    stock("ondo"),
    gate("FAIL", "ondo", { liquidity: check(false, "No qualifying trusted-quote pool was found.") })
  );

  const comparison = compareCandidates([bstocks, ondo]);
  const liquidityDiff = comparison.differences.find((d) => d.checkName === "Trusted liquidity");
  assert.ok(liquidityDiff, "a liquidity difference must be reported");
  assert.match(liquidityDiff!.description, /bstocks PASS/);
  assert.match(liquidityDiff!.description, /ondo FAIL/);
  assert.match(liquidityDiff!.description, /No qualifying trusted-quote pool was found/);
});

test("when every wrapper agrees on a check, no difference is reported for it", () => {
  const bstocks = evaluateCandidate(stock("bstocks"), gate("PASS", "bstocks"));
  const ondo = evaluateCandidate(stock("ondo"), gate("PASS", "ondo"));

  const comparison = compareCandidates([bstocks, ondo]);
  assert.equal(comparison.differences.length, 0);
});

test("never selects a winner — the comparison result has no 'best'/'recommended' field at all", () => {
  const bstocks = evaluateCandidate(stock("bstocks"), gate("PASS", "bstocks"));
  const ondo = evaluateCandidate(stock("ondo"), gate("FAIL", "ondo", { liquidity: check(false) }));
  const comparison = compareCandidates([bstocks, ondo]);
  assert.ok(!("best" in comparison));
  assert.ok(!("winner" in comparison));
  assert.ok(!("recommended" in comparison));
});

test("a single wrapper (no comparison possible) still returns a valid structure with zero differences", () => {
  const bstocks = evaluateCandidate(stock("bstocks"), gate("PASS", "bstocks"));
  const comparison = compareCandidates([bstocks]);
  assert.equal(comparison.wrappers.length, 1);
  assert.equal(comparison.differences.length, 0);
});

test("throws on an empty wrapper list rather than returning a nonsensical comparison", () => {
  assert.throws(() => compareCandidates([]));
});

test("multiple simultaneous differences (liquidity AND cross-wrapper consistency) are all reported, not just the first", () => {
  const bstocks = evaluateCandidate(stock("bstocks"), gate("PASS", "bstocks"));
  const ondo = evaluateCandidate(
    stock("ondo"),
    gate("FAIL", "ondo", { liquidity: check(false), crossWrapperConsistency: check(false, "Deviation exceeds threshold") })
  );
  const comparison = compareCandidates([bstocks, ondo]);
  const checkNames = comparison.differences.map((d) => d.checkName);
  assert.ok(checkNames.includes("Trusted liquidity"));
  assert.ok(checkNames.includes("Cross-wrapper consistency"));
});
