import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTrustedQuotePool, TRUSTED_QUOTE_ASSETS, type TrustedQuoteCandidatePair } from "./trustedQuoteLiquidity.ts";
import { SAFETY_THRESHOLDS } from "../safety/thresholds.ts";

// Run with: node --experimental-strip-types --test src/lib/providers/*.test.mts

const USDT = TRUSTED_QUOTE_ASSETS.USDT; // lowercase canonical address
const WBNB = TRUSTED_QUOTE_ASSETS.WBNB;
const SPAM_TOKEN = "0x000000000000000000000000000000deadbeef"; // an address NOT in the trusted set

// Every test pair defaults to labels: ["v2"] — a normal, V2-executable
// pancakeswap pair. Tests specifically about AMM-version filtering override
// dexId/labels explicitly; every other test is about trust-address/TVL
// filtering and is unaffected by this orthogonal dimension.
function pair(overrides: Partial<TrustedQuoteCandidatePair> & { liquidityUsd?: number }): TrustedQuoteCandidatePair {
  const { liquidityUsd, ...rest } = overrides;
  return {
    pairAddress: "0xpair",
    dexId: "pancakeswap",
    labels: ["v2"],
    quoteToken: { address: USDT, symbol: "USDT" },
    liquidity: { usd: liquidityUsd ?? 100_000 },
    priceUsd: "100",
    ...rest,
  };
}

test("a pool quoted against a trusted asset (USDT, by address) is accepted", () => {
  const result = selectTrustedQuotePool([pair({ liquidityUsd: 60_000 })]);
  assert.equal(result.status, "found");
  if (result.status === "found") {
    assert.equal(result.tvlUsd, 60_000);
    assert.equal(result.quoteSymbol, "USDT");
  }
});

test("a pool whose quote token is NOT in the trusted address set is rejected, even with high liquidity", () => {
  const untrusted = pair({
    quoteToken: { address: SPAM_TOKEN, symbol: "USDT" }, // symbol CLAIMS to be USDT, address is not the real one
    liquidityUsd: 5_000_000,
  });
  const result = selectTrustedQuotePool([untrusted]);
  assert.equal(result.status, "no_qualifying_pair", "a spoofed symbol must not pass the address-based check");
});

test("filtering is based on quote token ADDRESS, not a string search over the symbol/name", () => {
  // Same scenario as above, phrased as the specific requirement: a pair
  // whose quoteToken.symbol is literally the string "USDT" but whose
  // quoteToken.address does not match the real USDT contract must be
  // rejected — proving the check isn't a loose name/symbol match.
  const spoofed = pair({ quoteToken: { address: SPAM_TOKEN, symbol: "USDT" }, liquidityUsd: 1_000_000 });
  const legit = pair({ quoteToken: { address: USDT, symbol: "USDT" }, liquidityUsd: 1 });

  const spoofedResult = selectTrustedQuotePool([spoofed]);
  const legitResult = selectTrustedQuotePool([legit]);

  assert.equal(spoofedResult.status, "no_qualifying_pair");
  assert.equal(legitResult.status, "found");
});

test("a near-worthless spam pair (trusted quote but ~$0 liquidity) is rejected, not treated as a qualifying zero", () => {
  const spam = pair({ liquidityUsd: 0 });
  const result = selectTrustedQuotePool([spam]);
  assert.equal(result.status, "no_qualifying_pair");
});

test("among multiple qualifying pairs, the deepest (highest TVL) one is selected — never aggregated", () => {
  const shallow = pair({ pairAddress: "0xshallow", liquidityUsd: 10_000 });
  const deep = pair({ pairAddress: "0xdeep", quoteToken: { address: WBNB, symbol: "WBNB" }, liquidityUsd: 1_973_032.61 });
  const medium = pair({ pairAddress: "0xmedium", liquidityUsd: 87_554 });

  const result = selectTrustedQuotePool([shallow, deep, medium]);

  assert.equal(result.status, "found");
  if (result.status === "found") {
    assert.equal(result.pairAddress, "0xdeep", "must pick the single deepest pair, not sum/average them");
    assert.equal(result.tvlUsd, 1_973_032.61);
  }
});

test("TVL above the $50,000 threshold -> would PASS the liquidity check", () => {
  const result = selectTrustedQuotePool([pair({ liquidityUsd: 1_973_032.61 })]);
  assert.equal(result.status, "found");
  if (result.status === "found") {
    assert.ok(result.tvlUsd >= SAFETY_THRESHOLDS.MIN_LIQUIDITY_USD, "this is the real bStocks TSLAB figure and must clear the threshold");
  }
});

test("TVL below the $50,000 threshold -> would FAIL the liquidity check (not UNKNOWN)", () => {
  // The real, live-observed Ondo TSLAon figure from the liquidity investigation.
  const result = selectTrustedQuotePool([pair({ liquidityUsd: 3_479.71 })]);
  assert.equal(result.status, "found", "a real qualifying pool was found — this must be a genuine FAIL, not UNKNOWN");
  if (result.status === "found") {
    assert.ok(result.tvlUsd < SAFETY_THRESHOLDS.MIN_LIQUIDITY_USD);
  }
});

test("no qualifying pair at all -> UNKNOWN (no pairs provided)", () => {
  const result = selectTrustedQuotePool([]);
  assert.equal(result.status, "no_qualifying_pair");
});

test("no qualifying pair at all -> UNKNOWN (pairs exist, none trusted)", () => {
  const result = selectTrustedQuotePool([pair({ quoteToken: { address: SPAM_TOKEN, symbol: "SCAM" }, liquidityUsd: 999_999 })]);
  assert.equal(result.status, "no_qualifying_pair");
});

// Execution-venue consistency (Smart Router migration): execution now
// routes through PancakeSwap's Smart Router, which executes through V2 AND
// V3 — so both must be accepted here, or this module would systematically
// UNDER-report real, executable liquidity (the exact inverse of the
// original TSLAB bug, where a V3-only pool was wrongly trusted while
// execution was V2-only). A pair on a DIFFERENT dex entirely is still
// excluded: Smart Router only knows PancakeSwap's own Factories.

test("a deep V3 pool IS selected when it's the deepest trusted-quote pancakeswap pair — Smart Router can execute against it, unlike the old V2-only router", () => {
  const v3 = pair({ pairAddress: "0xv3deep", labels: ["v3"], liquidityUsd: 1_959_368.35 });
  const v2 = pair({ pairAddress: "0xv2real", labels: ["v2"], liquidityUsd: 1.95 });

  const result = selectTrustedQuotePool([v3, v2]);

  assert.equal(result.status, "found");
  if (result.status === "found") {
    assert.equal(result.pairAddress, "0xv3deep", "the deepest pancakeswap pair wins regardless of V2/V3 label, since Smart Router executes through both");
    assert.equal(result.tvlUsd, 1_959_368.35);
  }
});

test("a pancakeswap pair with no labels at all still qualifies — only the dexId (PancakeSwap vs. another DEX) matters now, not the version label", () => {
  const unlabeled = pair({ labels: undefined, liquidityUsd: 5_000_000 });
  const result = selectTrustedQuotePool([unlabeled]);
  assert.equal(result.status, "found");
});

test("a pair on a DIFFERENT dex is rejected even if V2-labeled — Smart Router only routes through PancakeSwap's own Factories, not any V2-style AMM", () => {
  const otherDexV2 = pair({ dexId: "biswap", labels: ["v2"], liquidityUsd: 5_000_000 });
  const result = selectTrustedQuotePool([otherDexV2]);
  assert.equal(result.status, "no_qualifying_pair");
});

// priceUsd (the fix for the false cross-wrapper "disagreement" bug): the
// trusted pair's own price must be the one callers read — never a
// separately-selected, possibly spam-quoted pair's price.

test("the trusted pair's priceUsd is carried through on a found result", () => {
  const result = selectTrustedQuotePool([pair({ liquidityUsd: 60_000, priceUsd: "374.91" })]);
  assert.equal(result.status, "found");
  if (result.status === "found") {
    assert.equal(result.priceUsd, 374.91);
  }
});

test("a deep spam pair's price is never used: the trusted pair is selected (and its own price returned) even though an untrusted pair has far more liquidity", () => {
  const spamDeep = pair({
    pairAddress: "0xspam",
    quoteToken: { address: SPAM_TOKEN, symbol: "ASX" },
    liquidityUsd: 1_000_000, // deeper than the trusted pair below
    priceUsd: "356.74", // the contaminated/false reading
  });
  const trustedShallow = pair({ pairAddress: "0xreal", liquidityUsd: 3_481, priceUsd: "374.91" });

  const result = selectTrustedQuotePool([spamDeep, trustedShallow]);

  assert.equal(result.status, "found");
  if (result.status === "found") {
    assert.equal(result.pairAddress, "0xreal", "the untrusted-quote pair must never be selected regardless of its liquidity");
    assert.equal(result.priceUsd, 374.91, "price must come from the trusted pair, not the deeper spam-quoted one");
  }
});

test("when trusted-quote pairs exist but none are on PancakeSwap, the reason explicitly says so, not a generic 'no trusted pool' message", () => {
  const otherDexOnly = pair({ dexId: "biswap", labels: ["v2"], liquidityUsd: 1_959_368.35 });
  const result = selectTrustedQuotePool([otherDexOnly]);
  assert.equal(result.status, "no_qualifying_pair");
  if (result.status === "no_qualifying_pair") {
    assert.match(result.reason, /PancakeSwap/i);
  }
});
