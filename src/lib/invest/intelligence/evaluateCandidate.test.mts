import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCandidate } from "./evaluateCandidate.ts";
import type { CheckResult, SafetyGateResult, SafetyGateStatus, TokenizedStock } from "@/lib/types";

function check(passed: boolean | null, value?: number | string, threshold?: number | string, message = "test"): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", value, threshold, message };
}

function stock(overrides: Partial<TokenizedStock> = {}): TokenizedStock {
  return {
    underlying: "TSLA",
    name: "TSLA (Binance RWA: bstocks, TSLAB)",
    symbol: "TSLAB",
    wrapper: "bstocks",
    chain: "bsc",
    tokenAddress: "0xabc",
    price: 355.5,
    referencePrice: 354.9,
    liquidityUsd: 2_000_000,
    priceAgeSeconds: 12,
    marketStatus: "open",
    source: "binance-rwa",
    health: "healthy",
    ...overrides,
  };
}

function gate(status: SafetyGateStatus, checks: Partial<SafetyGateResult["checks"]> = {}): SafetyGateResult {
  const hardPass = status !== "FAIL";
  return {
    status,
    underlying: "TSLA",
    wrapper: "bstocks",
    checks: {
      liquidity: check(hardPass, 2_000_000, 50_000),
      priceFreshness: check(hardPass, 12, 60),
      referenceDeviation: check(hardPass, 0.17, 2),
      marketStatus: check(hardPass, "open"),
      crossWrapperConsistency: check(status === "PASS" ? true : status === "WARNING" ? false : true, 0.3, 1),
      ...checks,
    },
    reasons: [status],
    timestamp: 1_700_000_000_000,
  };
}

test("candidate normalization: a clean PASS maps every check to PASS and operationalStatus to PASS", () => {
  const evalResult = evaluateCandidate(stock(), gate("PASS"));
  assert.equal(evalResult.operationalStatus, "PASS");
  assert.ok(evalResult.checks.every((c) => c.status === "PASS"));
  assert.equal(evalResult.failedChecks.length, 0);
  assert.equal(evalResult.underlying, "TSLA");
  assert.equal(evalResult.wrapper, "bstocks");
  assert.equal(evalResult.tokenSymbol, "TSLAB");
});

test("missing price: facts.tokenPrice is undefined, never fabricated as 0 or a fallback", () => {
  const evalResult = evaluateCandidate(stock({ price: undefined }), gate("FAIL", { priceFreshness: check(null) }));
  assert.equal(evalResult.facts.tokenPrice, undefined);
});

test("missing Pyth data: referenceDeviation check with passed=null maps to UNKNOWN, not PASS or FAIL", () => {
  const evalResult = evaluateCandidate(
    stock({ referencePrice: undefined }),
    gate("WARNING", { referenceDeviation: check(null, undefined, 2, "Pyth reference unavailable") })
  );
  const refCheck = evalResult.checks.find((c) => c.name === "Independent reference");
  assert.equal(refCheck?.status, "UNKNOWN");
  assert.equal(refCheck?.message, "Pyth reference unavailable");
});

test("stale price: priceFreshness check fails, and the numeric age is carried through verbatim from the existing check", () => {
  const evalResult = evaluateCandidate(
    stock({ priceAgeSeconds: 180 }),
    gate("FAIL", { priceFreshness: check(false, 180, 60, "Price is 180s old, exceeding the 60s threshold") })
  );
  const freshnessCheck = evalResult.checks.find((c) => c.name === "Price freshness");
  assert.equal(freshnessCheck?.status, "FAIL");
  assert.equal(freshnessCheck?.value, 180);
  assert.equal(freshnessCheck?.threshold, 60);
  assert.ok(evalResult.failedChecks.some((c) => c.name === "Price freshness"));
});

test("failed liquidity: liquidity check fails with its own reason, surfaced in failedChecks", () => {
  const evalResult = evaluateCandidate(
    stock({ liquidityUsd: undefined }),
    gate("FAIL", { liquidity: check(false, undefined, 50_000, "No qualifying trusted-quote pool was found.") })
  );
  const liquidityCheck = evalResult.failedChecks.find((c) => c.name === "Trusted liquidity");
  assert.ok(liquidityCheck);
  assert.equal(liquidityCheck?.message, "No qualifying trusted-quote pool was found.");
});

test("failed Safety Gate (FAIL overall): operationalStatus is FAIL, taken directly from the existing SafetyGateResult", () => {
  const evalResult = evaluateCandidate(stock(), gate("FAIL", { liquidity: check(false) }));
  assert.equal(evalResult.operationalStatus, "FAIL");
});

test("unknown status: a check with passed=null is reported as UNKNOWN, never silently treated as safe/PASS", () => {
  const evalResult = evaluateCandidate(stock({ marketStatus: undefined }), gate("WARNING", { marketStatus: check(null, undefined, undefined, "Market status could not be determined.") }));
  const marketCheck = evalResult.checks.find((c) => c.name === "Market status");
  assert.equal(marketCheck?.status, "UNKNOWN");
});

test("timestamps: evaluationTimestamp is taken directly from the existing SafetyGateResult.timestamp, not a new clock reading", () => {
  const evalResult = evaluateCandidate(stock(), gate("PASS"));
  assert.equal(evalResult.evaluationTimestamp, 1_700_000_000_000);
});

test("tokenSymbol falls back to the display name when a dedicated symbol isn't available", () => {
  const evalResult = evaluateCandidate(stock({ symbol: undefined, name: "TSLA (Binance RWA: ondo)" }), gate("PASS"));
  assert.equal(evalResult.tokenSymbol, "TSLA (Binance RWA: ondo)");
});

// canAttemptPurchase (interface-accuracy fix): deliberately diverges from
// operationalStatus === "PASS" for liquidity specifically — see its own
// doc comment on CandidateEvaluation for why.

test("canAttemptPurchase is true when liquidity is the ONLY failing hard check, even though operationalStatus is FAIL", () => {
  // gate("FAIL", ...)'s own hardPass shortcut defaults EVERY check to
  // failed when status is "FAIL" — explicitly pass the other three hard
  // checks as PASS so liquidity really is isolated as the sole failure.
  const evalResult = evaluateCandidate(
    stock(),
    gate("FAIL", {
      liquidity: check(false, 15_000, 50_000, "Deepest qualifying BSC pool has only $15,000 total TVL, below the $50,000 threshold."),
      priceFreshness: check(true, 12, 60),
      referenceDeviation: check(true, 0.17, 2),
      marketStatus: check(true, "open"),
    })
  );
  assert.equal(evalResult.operationalStatus, "FAIL", "the full Safety Gate status still reflects the liquidity failure honestly");
  assert.equal(evalResult.canAttemptPurchase, true, "but Buy Spot should still be reachable — the real executable-liquidity gate runs at quote time");
});

test("canAttemptPurchase is false when price freshness fails, regardless of liquidity", () => {
  const evalResult = evaluateCandidate(
    stock(),
    gate("FAIL", { priceFreshness: check(false, 300, 60, "Price is 300s old, exceeding the 60s threshold") })
  );
  assert.equal(evalResult.canAttemptPurchase, false, "stale price data must still block Buy Spot — this is unrelated to the liquidity-measurement question");
});

test("canAttemptPurchase is false when the independent reference check fails", () => {
  const evalResult = evaluateCandidate(stock(), gate("FAIL", { referenceDeviation: check(false, 5, 2, "Wrapper price deviates 5% from reference") }));
  assert.equal(evalResult.canAttemptPurchase, false);
});

test("canAttemptPurchase is false when market status is unknown (passed: null)", () => {
  const evalResult = evaluateCandidate(stock(), gate("FAIL", { marketStatus: check(null, undefined, undefined, "Market status could not be determined.") }));
  assert.equal(evalResult.canAttemptPurchase, false, "an UNKNOWN hard check must still block, exactly like operationalStatus's own rule");
});

test("canAttemptPurchase is false when cross-wrapper consistency disagrees (WARNING), matching operationalStatus's own treatment of the soft check", () => {
  const evalResult = evaluateCandidate(stock(), gate("WARNING", { crossWrapperConsistency: check(false, 5, 4, "Wrappers disagree by 5%") }));
  assert.equal(evalResult.operationalStatus, "WARNING");
  assert.equal(evalResult.canAttemptPurchase, false, "WARNING still blocks Buy Spot — only the liquidity hard check is treated differently, nothing else");
});

test("canAttemptPurchase is true on a clean PASS, same as operationalStatus", () => {
  const evalResult = evaluateCandidate(stock(), gate("PASS"));
  assert.equal(evalResult.canAttemptPurchase, true);
});

test("canAttemptPurchase is true when cross-wrapper data is merely INCONCLUSIVE (passed: null) and the other hard checks pass — mirrors runSafetyGate()'s own updated rule", () => {
  const evalResult = evaluateCandidate(
    stock(),
    gate("PASS", { crossWrapperConsistency: check(null, undefined, undefined, "No comparable wrapper right now.") })
  );
  assert.equal(evalResult.operationalStatus, "PASS", "runSafetyGate() itself already treats INCONCLUSIVE as sufficient alongside a passing independent reference");
  assert.equal(evalResult.canAttemptPurchase, true, "canAttemptPurchase must not be stricter than operationalStatus for the exact same signal");
});

// priceVerification — explicit, user-facing labelling of HOW a non-FAIL
// price was corroborated, independent of operationalStatus/canAttemptPurchase.

test("priceVerification: CROSS_WRAPPER_CONFIRMED when a second wrapper agrees", () => {
  const evalResult = evaluateCandidate(stock(), gate("PASS", { crossWrapperConsistency: check(true, 0.3, 4) }));
  assert.equal(evalResult.priceVerification, "CROSS_WRAPPER_CONFIRMED");
});

test("priceVerification: ISSUER_REFERENCE_ONLY when cross-wrapper is INCONCLUSIVE but the independent reference passed", () => {
  const evalResult = evaluateCandidate(
    stock(),
    gate("PASS", { crossWrapperConsistency: check(null, undefined, undefined, "No comparable wrapper right now.") })
  );
  assert.equal(evalResult.priceVerification, "ISSUER_REFERENCE_ONLY");
});

test("priceVerification: DISAGREEMENT when a second wrapper's price genuinely conflicts", () => {
  const evalResult = evaluateCandidate(stock(), gate("WARNING", { crossWrapperConsistency: check(false, 5, 4, "Wrappers disagree by 5%") }));
  assert.equal(evalResult.priceVerification, "DISAGREEMENT");
});

test("priceVerification: UNAVAILABLE when cross-wrapper is INCONCLUSIVE and the independent reference ALSO isn't available", () => {
  const evalResult = evaluateCandidate(
    stock({ referencePrice: undefined }),
    gate("FAIL", {
      referenceDeviation: check(null, undefined, 2, "No independent reference available."),
      crossWrapperConsistency: check(null, undefined, undefined, "No comparable wrapper right now."),
    })
  );
  assert.equal(evalResult.priceVerification, "UNAVAILABLE");
});

// Regression (product-hardening audit): CandidateEvaluation now also carries
// the full, original `stock` and `safetyGateResult` objects unchanged — the
// exact reconstructive binding InvestmentIntelligencePanel.tsx needs to hand
// {stock, safetyGateResult} straight to the EXISTING BinanceRwaProtectionQuote.tsx
// for ANY ticker/wrapper the engine discovers, not just the TSLA-only panel
// it originally shipped with. These objects must be byte-for-byte the SAME
// data the Safety Gate actually produced — never reconstructed or copied —
// or the protection flow could silently analyze a different asset than the
// one actually evaluated.
test("the original stock and safetyGateResult objects are carried through unchanged, for reuse by the protection flow", () => {
  const inputStock = stock();
  const inputGate = gate("PASS");
  const evalResult = evaluateCandidate(inputStock, inputGate);
  assert.equal(evalResult.stock, inputStock);
  assert.equal(evalResult.safetyGateResult, inputGate);
  // Specifically: the wrapper/underlying BinanceRwaProtectionQuote would key
  // its Binance-RWA-quote request on must match the evaluation it came from.
  assert.equal(evalResult.stock.wrapper, evalResult.wrapper);
  assert.equal(evalResult.stock.underlying, evalResult.underlying);
});
