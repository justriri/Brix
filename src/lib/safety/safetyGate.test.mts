import { test } from "node:test";
import assert from "node:assert/strict";
import { runSafetyGate } from "./safetyGate.ts";
import type { TokenizedStock } from "../types.ts";

// Run with: node --experimental-strip-types --test src/lib/safety/*.test.mts

function stock(overrides: Partial<TokenizedStock> & { wrapper: TokenizedStock["wrapper"] }): TokenizedStock {
  return {
    underlying: "TSLA",
    name: "Tesla",
    chain: "bsc",
    source: "test",
    health: "healthy",
    marketStatus: "closed",
    liquidityUsd: 1_900_000,
    priceAgeSeconds: 0,
    ...overrides,
  };
}

test("cross-wrapper prices agree + all hard checks pass -> PASS", () => {
  const main = stock({ wrapper: "bstocks", price: 375.49, referencePrice: 376.29 });
  const other = stock({ wrapper: "ondo", price: 376.0, liquidityUsd: 100_000 });
  const result = runSafetyGate(main, [other]);
  assert.equal(result.status, "PASS");
  assert.equal(result.checks.crossWrapperConsistency.passed, true);
});

test("cross-wrapper comparison unavailable, but a valid authoritative reference corroborates the price -> PASS (the new fallback path)", () => {
  // No comparable other wrapper (e.g. its liquidity is dust) — but this
  // wrapper's own price already agrees with its independent reference
  // (referenceDeviation, a hard check, passes). This is the exact TSLA
  // bstocks scenario live-diagnosed: dust-liquidity Ondo pool made
  // cross-wrapper INCONCLUSIVE, while Pyth's TSLA/USD reference already
  // corroborated bstocks' own price.
  const main = stock({ wrapper: "bstocks", price: 375.49, referencePrice: 376.29 });
  const dustOther = stock({ wrapper: "ondo", price: 342.37, liquidityUsd: 0.41 });
  const result = runSafetyGate(main, [dustOther]);
  assert.equal(result.checks.crossWrapperConsistency.passed, null, "cross-wrapper must be INCONCLUSIVE, not a real disagreement");
  assert.equal(result.status, "PASS", "an independently-corroborated price must not be blocked just because no second wrapper is comparable");
  assert.match(result.reasons.join(" "), /independently corroborated/);
});

test("cross-wrapper prices genuinely disagree -> WARNING, never silently escalated to PASS", () => {
  const main = stock({ wrapper: "bstocks", price: 375.49, referencePrice: 376.29 });
  const disagreeing = stock({ wrapper: "ondo", price: 300.0, liquidityUsd: 100_000 }); // >4% apart
  const result = runSafetyGate(main, [disagreeing]);
  assert.equal(result.checks.crossWrapperConsistency.passed, false);
  assert.equal(result.status, "WARNING");
  assert.match(result.reasons.join(" "), /disagrees/);
});

test("a mandatory hard check (reference deviation itself) fails -> FAIL, regardless of cross-wrapper outcome", () => {
  // The wrapper's own price disagrees with its independent reference by
  // more than the hard-check threshold — a genuine FAIL, not rescued by an
  // agreeing cross-wrapper.
  const main = stock({ wrapper: "bstocks", price: 300.0, referencePrice: 376.29 });
  const agreeingOther = stock({ wrapper: "ondo", price: 300.0, liquidityUsd: 100_000 });
  const result = runSafetyGate(main, [agreeingOther]);
  assert.equal(result.checks.referenceDeviation.passed, false);
  assert.equal(result.status, "FAIL");
});

test("no trustworthy price source available at all (no reference, no comparable wrapper) -> UNAVAILABLE, never PASS and never a confirmed FAIL", () => {
  // Nothing here was ever actually evaluated as wrong — referenceDeviation
  // couldn't run (no independent reference from any tier) and
  // crossWrapperConsistency is merely inconclusive (no comparable
  // wrapper) — this is an absence of evidence, not evidence of a problem.
  // It must still never read as PASS, but conflating it with a genuine
  // FAIL (a check that actually ran and came back false) is the exact bug
  // this status split fixes: see safety/safetyGate.ts's status derivation.
  const main = stock({ wrapper: "bstocks", price: 375.49, referencePrice: undefined });
  const dustOther = stock({ wrapper: "ondo", price: 342.37, liquidityUsd: 0.41 });
  const result = runSafetyGate(main, [dustOther]);
  assert.equal(result.checks.referenceDeviation.passed, null);
  assert.equal(result.checks.crossWrapperConsistency.passed, null);
  assert.equal(
    result.status,
    "UNAVAILABLE",
    "with neither a reference nor a comparable wrapper, this must never pass by default, but it is also not a confirmed failure"
  );
});

test("insufficient liquidity (a hard check) still blocks protection outright, even with an agreeing independent reference", () => {
  const main = stock({ wrapper: "bstocks", price: 375.49, referencePrice: 376.29, liquidityUsd: 10_000 });
  const result = runSafetyGate(main, []);
  assert.equal(result.checks.liquidity.passed, false);
  assert.equal(result.status, "FAIL", "liquidity was actually measured and came back below the threshold — a genuine, confirmed failure");
});

test("no liquidity figure available at all (never measured, not measured-and-low) -> UNAVAILABLE, not FAIL", () => {
  const main = stock({ wrapper: "bstocks", price: 375.49, referencePrice: 376.29, liquidityUsd: undefined });
  const result = runSafetyGate(main, []);
  assert.equal(result.checks.liquidity.passed, null);
  assert.equal(
    result.status,
    "UNAVAILABLE",
    "a missing liquidity figure is a data gap, not evidence the pool is actually thin — must not be shown the same way as the above genuine FAIL"
  );
});

test("a genuine FAIL still wins over an UNAVAILABLE check on the same stock", () => {
  // referenceDeviation is unavailable (no reference) AND liquidity
  // genuinely fails (measured, below threshold) — the confirmed failure
  // must take priority over the mere data gap.
  const main = stock({ wrapper: "bstocks", price: 375.49, referencePrice: undefined, liquidityUsd: 10_000 });
  const result = runSafetyGate(main, []);
  assert.equal(result.checks.referenceDeviation.passed, null);
  assert.equal(result.checks.liquidity.passed, false);
  assert.equal(result.status, "FAIL");
});

test("token-to-share ratio differences are normalized before comparing wrapper price to reference", () => {
  // A wrapper whose token represents 2 shares each: raw per-token price is
  // ~2x the per-share reference, which would look like a huge disagreement
  // if compared raw — but after dividing by the ratio, it agrees exactly.
  const main = stock({ wrapper: "bstocks", price: 752.58, referencePrice: 376.29, tokenToShareRatio: 2 });
  const result = runSafetyGate(main, []);
  assert.equal(result.checks.referenceDeviation.passed, true);
});
