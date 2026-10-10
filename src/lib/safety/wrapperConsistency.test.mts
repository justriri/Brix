import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCrossWrapperConsistency, crossWrapperOutcome } from "./wrapperConsistency.ts";
import type { CheckResult, TokenizedStock } from "../types.ts";

// Run with: node --experimental-strip-types --test src/lib/safety/*.test.mts

function stock(overrides: Partial<TokenizedStock> & { wrapper: TokenizedStock["wrapper"] }): TokenizedStock {
  return {
    underlying: "TSLA",
    name: "Tesla",
    chain: "bsc",
    source: "test",
    health: "healthy",
    ...overrides,
  };
}

test("AGREEMENT: a comparable wrapper with enough liquidity and a close price -> passed true, outcome AGREEMENT", () => {
  const main = stock({ wrapper: "bstocks", price: 375.47, liquidityUsd: 1_900_000 });
  const other = stock({ wrapper: "ondo", price: 376.0, liquidityUsd: 100_000 });
  const result = checkCrossWrapperConsistency(main, [other]);
  assert.equal(result.passed, true);
  assert.equal(crossWrapperOutcome(result), "AGREEMENT");
});

test("DISAGREEMENT: a comparable (sufficiently liquid) wrapper whose price conflicts beyond the threshold -> passed false, outcome DISAGREEMENT", () => {
  const main = stock({ wrapper: "bstocks", price: 375.47, liquidityUsd: 1_900_000 });
  const other = stock({ wrapper: "ondo", price: 300.0, liquidityUsd: 100_000 }); // way beyond 4%
  const result = checkCrossWrapperConsistency(main, [other]);
  assert.equal(result.passed, false);
  assert.equal(crossWrapperOutcome(result), "DISAGREEMENT");
  assert.match(result.message, /disagrees/);
});

test("INCONCLUSIVE: no other wrapper has a price at all (missing comparison market) -> passed null, outcome INCONCLUSIVE", () => {
  const main = stock({ wrapper: "bstocks", price: 375.47, liquidityUsd: 1_900_000 });
  const other = stock({ wrapper: "xstocks", price: undefined, liquidityUsd: undefined });
  const result = checkCrossWrapperConsistency(main, [other]);
  assert.equal(result.passed, null);
  assert.equal(crossWrapperOutcome(result), "INCONCLUSIVE");
});

test("INCONCLUSIVE: the other wrapper has a price but dust-level liquidity, below the trust threshold -> treated as unavailable, not a real disagreement", () => {
  // The live-diagnosed case: Ondo's TSLA pool quoted $0.41 of trusted-quote
  // liquidity — a real, non-spam quote asset, but far too thin to be a
  // genuine price reading.
  const main = stock({ wrapper: "bstocks", price: 375.47, liquidityUsd: 1_900_000 });
  const dustWrapper = stock({ wrapper: "ondo", price: 342.37, liquidityUsd: 0.41 });
  const result = checkCrossWrapperConsistency(main, [dustWrapper]);
  assert.equal(result.passed, null, "a dust-liquidity price must not be treated as a trustworthy comparison");
  assert.equal(crossWrapperOutcome(result), "INCONCLUSIVE");
  assert.doesNotMatch(result.message, /disagrees/, "must not be misreported as a real disagreement");
});

test("INCONCLUSIVE: this wrapper's own price is unavailable -> nothing to compare, regardless of other wrappers", () => {
  const main = stock({ wrapper: "bstocks", price: undefined, liquidityUsd: 1_900_000 });
  const other = stock({ wrapper: "ondo", price: 376.0, liquidityUsd: 100_000 });
  const result = checkCrossWrapperConsistency(main, [other]);
  assert.equal(result.passed, null);
  assert.equal(crossWrapperOutcome(result), "INCONCLUSIVE");
});

test("AGREEMENT: among multiple comparable wrappers, the closest agreement determines the outcome", () => {
  const main = stock({ wrapper: "bstocks", price: 375.47, liquidityUsd: 1_900_000 });
  const close = stock({ wrapper: "ondo", price: 376.0, liquidityUsd: 100_000 });
  const far = stock({ wrapper: "xstocks", price: 500.0, liquidityUsd: 100_000 });
  const result = checkCrossWrapperConsistency(main, [close, far]);
  assert.equal(result.passed, true, "the closest comparable wrapper agrees, so the check should pass even though another wrapper disagrees wildly");
});

test("token-to-share ratio differences are normalized before comparing two wrappers' prices", () => {
  // Same underlying per-share price ($376), but main's token represents 2
  // shares (raw per-token price ~$752) while the other's represents 1
  // share — a raw, un-normalized comparison would look like a huge
  // disagreement; normalized, they agree.
  const main = stock({ wrapper: "bstocks", price: 752.0, liquidityUsd: 1_900_000, tokenToShareRatio: 2 });
  const other = stock({ wrapper: "ondo", price: 376.0, liquidityUsd: 100_000, tokenToShareRatio: 1 });
  const result = checkCrossWrapperConsistency(main, [other]);
  assert.equal(result.passed, true, "a ratio difference must not be misreported as a price disagreement");
});

test("a genuine disagreement still surfaces correctly after ratio-normalizing both sides", () => {
  const main = stock({ wrapper: "bstocks", price: 752.0, liquidityUsd: 1_900_000, tokenToShareRatio: 2 }); // $376/share
  const other = stock({ wrapper: "ondo", price: 300.0, liquidityUsd: 100_000, tokenToShareRatio: 1 }); // $300/share — genuinely different
  const result = checkCrossWrapperConsistency(main, [other]);
  assert.equal(result.passed, false);
});

test("crossWrapperOutcome: maps every CheckResult.passed tri-state explicitly", () => {
  const agree: CheckResult = { id: "x", label: "x", passed: true, severity: "soft", message: "" };
  const disagree: CheckResult = { id: "x", label: "x", passed: false, severity: "soft", message: "" };
  const inconclusive: CheckResult = { id: "x", label: "x", passed: null, severity: "soft", message: "" };
  assert.equal(crossWrapperOutcome(agree), "AGREEMENT");
  assert.equal(crossWrapperOutcome(disagree), "DISAGREEMENT");
  assert.equal(crossWrapperOutcome(inconclusive), "INCONCLUSIVE");
});
