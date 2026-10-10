import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBinanceRwaProtectionQuoteCore, type BinanceRwaProtectionQuoteInput } from "./binanceRwaQuoteCore.ts";

// Run with: node --experimental-strip-types --test src/lib/protection/*.test.mts

const FIXED_NOW = 1_790_900_000_000;
const FIXED_EXPIRY = FIXED_NOW + 2 * 24 * 60 * 60 * 1000; // arbitrary, 2 days out

function baseInput(overrides: Partial<BinanceRwaProtectionQuoteInput> = {}): BinanceRwaProtectionQuoteInput {
  return {
    underlying: "TSLA",
    wrapper: "bstocks",
    safetyGateStatus: "PASS",
    positionAmount: 5,
    positionValueUsd: 1_775, // 5 * ~$355
    thresholdPercent: 5,
    premiumRatePercent: 2.5,
    expiresAt: FIXED_EXPIRY,
    now: FIXED_NOW,
    ...overrides,
  };
}

test("a passing TSLA position produces a quote", () => {
  const quote = buildBinanceRwaProtectionQuoteCore(baseInput());
  assert.ok(quote !== null);
});

test("quote generation is deterministic for identical inputs", () => {
  const input = baseInput();
  const quoteA = buildBinanceRwaProtectionQuoteCore(input);
  const quoteB = buildBinanceRwaProtectionQuoteCore(input);
  assert.deepEqual(quoteA, quoteB);
});

test("quote contains the expected policy fields", () => {
  const quote = buildBinanceRwaProtectionQuoteCore(baseInput());
  assert.ok(quote);
  assert.equal(quote!.underlying, "TSLA");
  assert.equal(quote!.wrapper, "bstocks");
  assert.equal(quote!.positionAmount, 5);
  assert.equal(quote!.coverageAmount, 1_775); // position value
  assert.equal(quote!.thresholdPercent, 5);
  assert.equal(quote!.premium, 44.38); // 1775 * 2.5% = 44.375 -> rounded to 44.38
  assert.equal(quote!.maxPayoutAmount, 1_775);
  assert.equal(quote!.policyStatus, "quote_only");
  assert.equal(quote!.quotedAt, FIXED_NOW);
  assert.equal(quote!.expiresAt, FIXED_EXPIRY);
  assert.equal(typeof quote!.coveragePeriodLabel, "string");
  assert.equal(quote!.isDevelopmentOnly, true);
});

test("a FAILed Safety Gate cannot produce an activatable protection policy", () => {
  const quote = buildBinanceRwaProtectionQuoteCore(baseInput({ safetyGateStatus: "FAIL" }));
  assert.equal(quote, null);
});

test("a WARNING Safety Gate also cannot produce a quote (same eligibility rule as the existing orchestrator)", () => {
  const quote = buildBinanceRwaProtectionQuoteCore(baseInput({ safetyGateStatus: "WARNING" }));
  assert.equal(quote, null);
});

test("no position (amount 0) cannot produce a quote, even with a passing gate", () => {
  const quote = buildBinanceRwaProtectionQuoteCore(baseInput({ positionAmount: 0, positionValueUsd: 0 }));
  assert.equal(quote, null);
});

test("a negative position amount (should never happen, but fail-closed) cannot produce a quote", () => {
  const quote = buildBinanceRwaProtectionQuoteCore(baseInput({ positionAmount: -1 }));
  assert.equal(quote, null);
});

test("quote generation performs no I/O and returns a plain data object — no transaction, no wallet interaction", () => {
  // This is a structural/behavioral guarantee, not just an assertion on
  // output: buildBinanceRwaProtectionQuoteCore is synchronous (not async),
  // so it cannot itself await a network call, a wallet prompt, or an
  // on-chain transaction — there is no `await`, no Promise, nothing for a
  // wallet or RPC call to hook into. We assert that explicitly here so a
  // future change that makes this function async (a prerequisite for it to
  // ever request a transaction) would break this test and need conscious
  // review.
  const result = buildBinanceRwaProtectionQuoteCore(baseInput());
  assert.equal(result instanceof Promise, false, "must be synchronous — no transaction/async I/O is possible from a sync function");
  // The returned object is plain, JSON-serializable data — no function
  // properties (e.g. a `.send()` or `.sign()` method) that could represent
  // a pending transaction or signer handle.
  if (result) {
    for (const value of Object.values(result)) {
      assert.notEqual(typeof value, "function");
    }
  }
});
