import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverCandidates, type DiscoveryAssessment, type FetchAssessmentsFn } from "./candidateDiscovery.ts";
import type { CheckResult, SafetyGateResult, SafetyGateStatus, TokenizedStock, Wrapper } from "@/lib/types";

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "test" };
}

function stock(ticker: string, wrapper: Wrapper, overrides: Partial<TokenizedStock> = {}): TokenizedStock {
  return {
    underlying: ticker,
    name: `${ticker} (${wrapper})`,
    symbol: `${ticker}_${wrapper}`,
    wrapper,
    chain: "bsc",
    tokenAddress: `0x${ticker}${wrapper}`,
    price: 100,
    source: "binance-rwa",
    health: "healthy",
    ...overrides,
  };
}

function gate(status: SafetyGateStatus, underlying: string, wrapper: Wrapper): SafetyGateResult {
  const hardPass = status !== "FAIL";
  return {
    status,
    underlying,
    wrapper,
    checks: {
      liquidity: check(hardPass),
      priceFreshness: check(hardPass),
      referenceDeviation: check(hardPass),
      marketStatus: check(hardPass),
      crossWrapperConsistency: check(status === "PASS"),
    },
    reasons: [status],
    timestamp: 0,
  };
}

test("multiple wrappers: a ticker with two wrappers is grouped together under one underlying", async () => {
  const fetchAssessments: FetchAssessmentsFn = async (ticker) => {
    const assessments: DiscoveryAssessment[] = [
      { stock: stock(ticker, "bstocks"), safetyGateResult: gate("PASS", ticker, "bstocks") },
      { stock: stock(ticker, "ondo"), safetyGateResult: gate("FAIL", ticker, "ondo") },
    ];
    return { assessments, warnings: [] };
  };

  const { groups, warnings } = await discoverCandidates(["TSLA"], fetchAssessments);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].underlying, "TSLA");
  assert.equal(groups[0].wrappers.length, 2);
  assert.deepEqual(
    groups[0].wrappers.map((w) => w.wrapper).sort(),
    ["bstocks", "ondo"]
  );
  assert.equal(warnings.length, 0);
});

test("duplicate candidates: if the same wrapper somehow appears twice for one ticker, both are preserved (not deduped away) — the data source is trusted to not duplicate, this layer does not silently drop entries", async () => {
  const fetchAssessments: FetchAssessmentsFn = async (ticker) => ({
    assessments: [
      { stock: stock(ticker, "bstocks"), safetyGateResult: gate("PASS", ticker, "bstocks") },
      { stock: stock(ticker, "bstocks"), safetyGateResult: gate("PASS", ticker, "bstocks") },
    ],
    warnings: [],
  });

  const { groups } = await discoverCandidates(["TSLA"], fetchAssessments);
  assert.equal(groups[0].wrappers.length, 2);
});

test("a ticker with no wrappers returned is skipped with a warning, not included as an empty group", async () => {
  const fetchAssessments: FetchAssessmentsFn = async () => ({ assessments: [], warnings: [] });
  const { groups, warnings } = await discoverCandidates(["AAPL"], fetchAssessments);
  assert.equal(groups.length, 0);
  assert.match(warnings[0], /No tokenized-stock wrappers were returned for AAPL/);
});

test("API failure for one ticker does not prevent discovery of another ticker", async () => {
  const fetchAssessments: FetchAssessmentsFn = async (ticker) => {
    if (ticker === "NVDA") throw new Error("Binance RWA API unavailable");
    return { assessments: [{ stock: stock(ticker, "bstocks"), safetyGateResult: gate("PASS", ticker, "bstocks") }], warnings: [] };
  };

  const { groups, warnings } = await discoverCandidates(["NVDA", "TSLA"], fetchAssessments);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].underlying, "TSLA");
  assert.match(warnings.join(" "), /Could not discover candidates for NVDA.*Binance RWA API unavailable/);
});

test("upstream warnings are preserved, not swallowed", async () => {
  const fetchAssessments: FetchAssessmentsFn = async (ticker) => ({
    assessments: [{ stock: stock(ticker, "bstocks"), safetyGateResult: gate("PASS", ticker, "bstocks") }],
    warnings: ["Binance returned a stale cache header."],
  });
  const { warnings } = await discoverCandidates(["TSLA"], fetchAssessments);
  assert.ok(warnings.includes("Binance returned a stale cache header."));
});

test("multiple tickers each produce their own group, in order", async () => {
  const fetchAssessments: FetchAssessmentsFn = async (ticker) => ({
    assessments: [{ stock: stock(ticker, "bstocks"), safetyGateResult: gate("PASS", ticker, "bstocks") }],
    warnings: [],
  });
  const { groups } = await discoverCandidates(["TSLA", "AAPL", "NVDA"], fetchAssessments);
  assert.deepEqual(
    groups.map((g) => g.underlying),
    ["TSLA", "AAPL", "NVDA"]
  );
});
