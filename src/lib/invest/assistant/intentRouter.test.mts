import { test } from "node:test";
import assert from "node:assert/strict";
import { routeIntent } from "./intentRouter.ts";
import { evaluateCandidate } from "../intelligence/evaluateCandidate.ts";
import type { CandidateGroup } from "../intelligence/intelligenceTypes.ts";
import type { CheckResult, SafetyGateResult, TokenizedStock, Wrapper } from "@/lib/types";

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "test" };
}

function stock(ticker: string, wrapper: Wrapper, symbol: string): TokenizedStock {
  return { underlying: ticker, name: `${ticker} (${wrapper})`, symbol, wrapper, chain: "bsc", price: 100, source: "test", health: "healthy" };
}

function gate(underlying: string, wrapper: Wrapper): SafetyGateResult {
  return {
    status: "PASS",
    underlying,
    wrapper,
    checks: {
      liquidity: check(true),
      priceFreshness: check(true),
      referenceDeviation: check(true),
      marketStatus: check(true),
      crossWrapperConsistency: check(true),
    },
    reasons: ["PASS"],
    timestamp: 0,
  };
}

const GROUPS: CandidateGroup[] = [
  {
    underlying: "TSLA",
    wrappers: [
      evaluateCandidate(stock("TSLA", "bstocks", "TSLAB"), gate("TSLA", "bstocks")),
      evaluateCandidate(stock("TSLA", "ondo", "TSLAon"), gate("TSLA", "ondo")),
    ],
  },
  { underlying: "AAPL", wrappers: [evaluateCandidate(stock("AAPL", "bstocks", "AAPLB"), gate("AAPL", "bstocks"))] },
];

test("'what tokenized stocks are available' routes to list-available", () => {
  assert.deepEqual(routeIntent("What tokenized stocks are currently available?", GROUPS), { type: "list-available" });
});

test("'compare the TSLA wrappers' routes to compare-wrappers with the correct ticker", () => {
  assert.deepEqual(routeIntent("Compare the TSLA wrappers", GROUPS), { type: "compare-wrappers", ticker: "TSLA" });
});

test("'compare' without a recognized ticker routes to unresolved", () => {
  const result = routeIntent("Compare the wrappers please", GROUPS);
  assert.equal(result.type, "unresolved");
});

test("'why did this asset fail the Safety Gate' with a ticker routes to explain-status", () => {
  assert.deepEqual(routeIntent("Why did TSLA fail the Safety Gate?", GROUPS), { type: "explain-status", ticker: "TSLA", wrapper: undefined });
});

test("explain-status resolves a wrapper when the user names the token symbol, not just the wrapper word", () => {
  assert.deepEqual(routeIntent("Is TSLAon available to buy?", GROUPS), { type: "explain-status", ticker: "TSLA", wrapper: "ondo" });
});

test("'what would I get if I spend $10 on TSLAB' routes to quote-preview with ticker, wrapper, and amount", () => {
  assert.deepEqual(routeIntent("What would I get if I spend $10 on TSLAB?", GROUPS), {
    type: "quote-preview",
    ticker: "TSLA",
    wrapper: "bstocks",
    amountUsd: 10,
  });
});

test("'prepare a $25 TSLA purchase' routes to quote-preview even without an explicit wrapper", () => {
  assert.deepEqual(routeIntent("Prepare a $25 TSLA purchase", GROUPS), {
    type: "quote-preview",
    ticker: "TSLA",
    wrapper: undefined,
    amountUsd: 25,
  });
});

test("a dollar amount with no recognized ticker/wrapper falls back to general (not a guessed quote-preview for an unknown asset)", () => {
  const result = routeIntent("What would $10 get me?", GROUPS);
  assert.equal(result.type, "general");
});

test("an amount phrased as '10 usdt' (no dollar sign) is still recognized", () => {
  const result = routeIntent("Prepare a 10 usdt TSLAB purchase", GROUPS);
  assert.equal(result.type, "quote-preview");
  if (result.type === "quote-preview") assert.equal(result.amountUsd, 10);
});

test("an unrecognized, free-form question falls back to 'general' rather than guessing an intent", () => {
  assert.deepEqual(routeIntent("Tell me a joke", GROUPS), { type: "general", question: "Tell me a joke" });
});

test("only tickers actually present in the live groups are recognized — an unlisted ticker falls back to general, never fabricated", () => {
  // "NVDA" is not in GROUPS here, even though it's a real supported ticker elsewhere in the app.
  const result = routeIntent("Compare the NVDA wrappers", GROUPS);
  assert.equal(result.type, "unresolved");
});
