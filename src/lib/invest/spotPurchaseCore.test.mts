import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnits } from "viem";
import { buildPurchaseQuote, buildSellQuote, isQuoteExpired, revalidatePurchaseQuote, MAX_PRICE_IMPACT_BPS, type AssetRef } from "./spotPurchaseCore.ts";

const USDT: AssetRef = { address: "0x55d398326f99059ff775485246999027b3197955", symbol: "USDT", decimals: 18 };
const TSLAB: AssetRef = { address: "0x5b1910eaad6450e50f816082aa078c41f10c292f", symbol: "TSLAB", decimals: 18 };
const ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4" as const; // PancakeSwap Smart Router (BSC)

/**
 * Mirrors buildPurchaseQuote's own fair-value formula exactly (not a
 * re-derivation) — used ONLY to compute a default `routerAmountOut` that
 * matches fair value exactly (zero price impact), so every test below that
 * isn't specifically about the executable-liquidity gate keeps asserting
 * the exact same `expectedAmountOut`/`minAmountOut` numbers it did before
 * `routerAmountOut` became the real source of expectedAmountOut.
 */
function fairValueAmountOut(raw: string, inputDecimals: number, outputDecimals: number, quoteAssetPriceUsd: number, stockPriceUsd: number): bigint {
  const amountIn = parseUnits(raw, inputDecimals);
  const quotePriceFixed = BigInt(Math.round(quoteAssetPriceUsd * 1e8));
  const stockPriceFixed = BigInt(Math.round(stockPriceUsd * 1e8));
  const numerator = amountIn * quotePriceFixed * 10n ** BigInt(outputDecimals);
  const denominator = stockPriceFixed * 10n ** BigInt(inputDecimals);
  return numerator / denominator;
}

function baseParams(overrides: Partial<Parameters<typeof buildPurchaseQuote>[0]> = {}) {
  const merged = {
    quoteAmountInRaw: "10",
    inputAsset: USDT,
    outputAsset: TSLAB,
    quoteAssetPriceUsd: 1,
    stockPriceUsd: 355.5,
    slippageBps: 50,
    routeDescription: "100% V2",
    routerAddress: ROUTER,
    now: 1_000_000,
    ...overrides,
  };
  return {
    ...merged,
    routerAmountOut:
      overrides.routerAmountOut ??
      fairValueAmountOut(merged.quoteAmountInRaw, merged.inputAsset.decimals, merged.outputAsset.decimals, merged.quoteAssetPriceUsd, merged.stockPriceUsd),
  };
}

test("normal purchase: $10 of USDT for an $355.50 stock computes exact amounts", () => {
  const quote = buildPurchaseQuote(baseParams());
  const amountIn = 10n * 10n ** 18n;
  assert.equal(quote.amountIn, amountIn);
  // Mirrors the implementation's own documented formula exactly (not a
  // re-derivation) — this test exists to pin the formula's output to a
  // concrete, hand-checkable number, not to re-implement it independently.
  const quotePriceFixed = BigInt(Math.round(1 * 1e8));
  const stockPriceFixed = BigInt(Math.round(355.5 * 1e8));
  const expected = (amountIn * quotePriceFixed * 10n ** 18n) / (stockPriceFixed * 10n ** 18n);
  assert.equal(quote.expectedAmountOut, expected);
  // Independently sanity-check against the known real-world ratio (10 / 355.5 ≈ 0.028129 TSLAB).
  const asFloat = Number(quote.expectedAmountOut) / 1e18;
  assert.ok(Math.abs(asFloat - 10 / 355.5) < 1e-6);
  assert.equal(quote.minAmountOut, (quote.expectedAmountOut * 9950n) / 10000n);
  assert.equal(quote.routeDescription, "100% V2");
  assert.equal(quote.routerAddress, ROUTER);
  assert.equal(quote.quotedAt, 1_000_000);
  assert.equal(quote.expiresAt, 1_000_000 + 30_000);
});

test("tiny purchase: the smallest representable input amount still produces a sane (possibly zero) output, never throws", () => {
  const quote = buildPurchaseQuote(baseParams({ quoteAmountInRaw: "0.000000000000000001" })); // 1 wei of USDT
  assert.equal(quote.amountIn, 1n);
  assert.ok(quote.expectedAmountOut >= 0n);
  assert.ok(quote.minAmountOut <= quote.expectedAmountOut);
});

test("large purchase: a very large input amount computes without overflow (BigInt has no fixed width)", () => {
  const quote = buildPurchaseQuote(baseParams({ quoteAmountInRaw: "1000000000" })); // $1B
  assert.equal(quote.amountIn, 1_000_000_000n * 10n ** 18n);
  assert.ok(quote.expectedAmountOut > 0n);
  assert.ok(quote.minAmountOut > 0n && quote.minAmountOut <= quote.expectedAmountOut);
});

test("zero amount is rejected, not silently turned into a zero-output quote", () => {
  assert.throws(() => buildPurchaseQuote(baseParams({ quoteAmountInRaw: "0" })));
});

test("a negative-looking amount string is rejected", () => {
  assert.throws(() => buildPurchaseQuote(baseParams({ quoteAmountInRaw: "-5" })));
});

test("invalid slippage (negative or above 100%) is rejected", () => {
  assert.throws(() => buildPurchaseQuote(baseParams({ slippageBps: -1 })));
  assert.throws(() => buildPurchaseQuote(baseParams({ slippageBps: 10_001 })));
});

test("exact slippage boundary: 0 bps means minAmountOut === expectedAmountOut; 10000 bps means minAmountOut === 0", () => {
  const zeroSlippage = buildPurchaseQuote(baseParams({ slippageBps: 0 }));
  assert.equal(zeroSlippage.minAmountOut, zeroSlippage.expectedAmountOut);

  const maxSlippage = buildPurchaseQuote(baseParams({ slippageBps: 10_000 }));
  assert.equal(maxSlippage.minAmountOut, 0n);
});

test("rounding direction: minAmountOut always floors, never exceeds what the slippage tolerance implies", () => {
  // Pick numbers that don't divide evenly to exercise real flooring.
  const quote = buildPurchaseQuote(baseParams({ quoteAmountInRaw: "7", stockPriceUsd: 3, slippageBps: 33 }));
  const exact = (quote.expectedAmountOut * BigInt(10_000 - 33)) / 10_000n;
  assert.equal(quote.minAmountOut, exact);
  assert.ok(quote.minAmountOut <= quote.expectedAmountOut);
});

test("decimal conversion: a non-18-decimal input and a non-18-decimal output are both handled via exact parseUnits, no float drift", () => {
  const sixDecimalUsdc: AssetRef = { address: "0x0000000000000000000000000000000000000001", symbol: "USDC6", decimals: 6 };
  const eightDecimalStock: AssetRef = { address: "0x0000000000000000000000000000000000000002", symbol: "STK8", decimals: 8 };
  const quote = buildPurchaseQuote(
    baseParams({
      quoteAmountInRaw: "10",
      inputAsset: sixDecimalUsdc,
      outputAsset: eightDecimalStock,
      stockPriceUsd: 10,
    })
  );
  assert.equal(quote.amountIn, 10_000_000n); // 10 * 1e6
  assert.equal(quote.expectedAmountOut, 100_000_000n); // 1 stock token at 1e8
});

test("minimum received calculation matches a hand-computed example exactly", () => {
  const quote = buildPurchaseQuote(baseParams({ quoteAmountInRaw: "100", stockPriceUsd: 200, slippageBps: 250 })); // 2.5% slippage
  // 100 USDT / $200 = 0.5 stock tokens = 5e17 base units
  assert.equal(quote.expectedAmountOut, 500_000_000_000_000_000n);
  // 97.5% of that
  assert.equal(quote.minAmountOut, (500_000_000_000_000_000n * 9750n) / 10000n);
});

test("quote expiry: a quote is not expired before its window, and is expired at/after it", () => {
  const quote = buildPurchaseQuote(baseParams({ now: 1_000_000, validityMs: 30_000 }));
  assert.equal(isQuoteExpired(quote, 1_029_999), false);
  assert.equal(isQuoteExpired(quote, 1_030_000), true);
  assert.equal(isQuoteExpired(quote, 1_030_001), true);
});

test("revalidatePurchaseQuote: an unchanged, unexpired quote passes", () => {
  const quote = buildPurchaseQuote(baseParams({ now: 1_000_000 }));
  const reason = revalidatePurchaseQuote(
    quote,
    { routerAddress: ROUTER, inputAssetAddress: USDT.address, outputAssetAddress: TSLAB.address },
    1_000_100
  );
  assert.equal(reason, null);
});

test("revalidatePurchaseQuote: an expired quote is rejected even if nothing else changed", () => {
  const quote = buildPurchaseQuote(baseParams({ now: 1_000_000, validityMs: 30_000 }));
  const reason = revalidatePurchaseQuote(
    quote,
    { routerAddress: ROUTER, inputAssetAddress: USDT.address, outputAssetAddress: TSLAB.address },
    1_030_000
  );
  assert.match(reason ?? "", /expired/);
});

// Executable-liquidity gate (TSLAB INSUFFICIENT_OUTPUT_AMOUNT fix): even
// with the correct V2 pool selected, a price-feed estimate can diverge from
// what that pool's real reserves would actually deliver. expectedAmountOut
// must come from the real pool (routerAmountOut), and a trade the pool
// cannot execute without excessive price impact must be rejected before a
// quote is ever produced.

test("expectedAmountOut comes from the live routerAmountOut, not the price-feed estimate, when the two differ (within tolerance)", () => {
  const fairValue = fairValueAmountOut("10", 18, 18, 1, 355.5);
  // A plausible real pool quote: slightly below fair value (normal, small
  // AMM curve effect), but well within MAX_PRICE_IMPACT_BPS.
  const realPoolOutput = (fairValue * 9_800n) / 10_000n; // 2% below fair value
  const quote = buildPurchaseQuote(baseParams({ routerAmountOut: realPoolOutput }));
  assert.equal(quote.expectedAmountOut, realPoolOutput, "expectedAmountOut must be the real pool's output, not the price-feed fair-value estimate");
  assert.notEqual(quote.expectedAmountOut, fairValue);
  assert.equal(quote.minAmountOut, (realPoolOutput * 9_950n) / 10_000n);
});

test("reproduces the live TSLAB bug exactly: a correct V2 pool whose real output is far below fair value is rejected before a quote is produced", () => {
  // Live-measured figures from the TSLAB diagnosis: price-based minAmountOut
  // implied ~0.0001309 TSLAB, the real V2 pool's getAmountsOut returned
  // ~0.0001248 TSLAB for the same trade — a ~4.63% shortfall, enough alone
  // to trigger PancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT even though the
  // correct pool was selected. Exercised here via equivalent small numbers.
  const fairValue = fairValueAmountOut("10", 18, 18, 1, 355.5);
  const realThinPoolOutput = (fairValue * 9_000n) / 10_000n; // 10% shortfall — past the 3% limit
  assert.throws(
    () => buildPurchaseQuote(baseParams({ routerAmountOut: realThinPoolOutput })),
    /executable liquidity/i,
    "a trade the real pool cannot fill without excessive price impact must fail safely, with a clear liquidity message, before any quote (and therefore before any wallet signature) is produced"
  );
});

test("a pool that can fill none of the trade (routerAmountOut = 0) while fair value is meaningfully positive is rejected, not silently quoted as a zero-output purchase", () => {
  assert.throws(() => buildPurchaseQuote(baseParams({ routerAmountOut: 0n })), /executable liquidity/i);
});

test("price impact at/just under the limit passes; comfortably over it fails — not a vague cutoff", () => {
  const fairValue = fairValueAmountOut("10", 18, 18, 1, 355.5);
  const atLimit = fairValue - (fairValue * BigInt(MAX_PRICE_IMPACT_BPS)) / 10_000n;
  const quote = buildPurchaseQuote(baseParams({ routerAmountOut: atLimit }));
  assert.equal(quote.expectedAmountOut, atLimit);

  // A further 50bps of shortfall — unambiguously past the limit (unlike a
  // single extra basis point, which at this magnitude can be swallowed by
  // integer-bps flooring on either side of the boundary).
  const wellOver = atLimit - (fairValue * 50n) / 10_000n;
  assert.throws(() => buildPurchaseQuote(baseParams({ routerAmountOut: wellOver })), /executable liquidity/i);
});

test("priceImpactBps on the returned quote reflects the real divergence from fair value, and is 0 when routerAmountOut matches fair value exactly", () => {
  const fairValue = fairValueAmountOut("10", 18, 18, 1, 355.5);
  const exact = buildPurchaseQuote(baseParams({ routerAmountOut: fairValue }));
  assert.equal(exact.priceImpactBps, 0);

  const twoPercentShort = (fairValue * 9_800n) / 10_000n;
  const impacted = buildPurchaseQuote(baseParams({ routerAmountOut: twoPercentShort }));
  assert.equal(impacted.priceImpactBps, 200);
});

test("routerAmountOut exceeding fair value (pool briefly favorable) is never treated as negative price impact", () => {
  const fairValue = fairValueAmountOut("10", 18, 18, 1, 355.5);
  const better = fairValue + fairValue / 10n; // 10% better than fair value
  const quote = buildPurchaseQuote(baseParams({ routerAmountOut: better }));
  assert.equal(quote.priceImpactBps, 0);
  assert.equal(quote.expectedAmountOut, better);
});

test("revalidatePurchaseQuote: a changed router, input asset, or output asset each independently invalidates the quote", () => {
  const quote = buildPurchaseQuote(baseParams({ now: 1_000_000 }));
  const other = "0x0000000000000000000000000000000000000099" as const;

  assert.match(
    revalidatePurchaseQuote(quote, { routerAddress: other, inputAssetAddress: USDT.address, outputAssetAddress: TSLAB.address }, 1_000_100) ?? "",
    /router/
  );
  assert.match(
    revalidatePurchaseQuote(quote, { routerAddress: ROUTER, inputAssetAddress: other, outputAssetAddress: TSLAB.address }, 1_000_100) ?? "",
    /input asset/
  );
  assert.match(
    revalidatePurchaseQuote(quote, { routerAddress: ROUTER, inputAssetAddress: USDT.address, outputAssetAddress: other }, 1_000_100) ?? "",
    /output asset/
  );
});

// buildSellQuote — the sell direction (stock -> USDT) of the exact same
// math, with the asset roles reversed. These tests mirror the buy-side
// ones above exactly (same fair-value formula, same inputs transposed) to
// prove the wrapper maps prices to the correct side rather than swapping
// them backwards.

test("buildSellQuote: zero price impact when routerAmountOut matches fair value exactly, with input/output asset roles reversed from a buy", () => {
  const amountOut = fairValueAmountOut("2", TSLAB.decimals, USDT.decimals, 355.5, 1);
  const quote = buildSellQuote({
    quoteAmountInRaw: "2",
    inputAsset: TSLAB,
    outputAsset: USDT,
    stockPriceUsd: 355.5, // price of the input (TSLAB)
    quoteAssetPriceUsd: 1, // price of the output (USDT)
    routerAmountOut: amountOut,
    slippageBps: 50,
    routeDescription: "100% V3",
    routerAddress: ROUTER,
    now: 1_000_000,
  });
  assert.equal(quote.inputAsset.symbol, "TSLAB");
  assert.equal(quote.outputAsset.symbol, "USDT");
  assert.equal(quote.expectedAmountOut, amountOut);
  assert.equal(quote.priceImpactBps, 0);
});

test("buildSellQuote: a router output materially below fair value is rejected by the same executable-liquidity gate buy uses", () => {
  const fair = fairValueAmountOut("2", TSLAB.decimals, USDT.decimals, 355.5, 1);
  const tooLow = (fair * 9000n) / 10000n; // 10% short — well beyond MAX_PRICE_IMPACT_BPS
  assert.throws(
    () =>
      buildSellQuote({
        quoteAmountInRaw: "2",
        inputAsset: TSLAB,
        outputAsset: USDT,
        stockPriceUsd: 355.5,
        quoteAssetPriceUsd: 1,
        routerAmountOut: tooLow,
        slippageBps: 50,
        routeDescription: "100% V3",
        routerAddress: ROUTER,
        now: 1_000_000,
      }),
    /executable liquidity/
  );
});

test("buildSellQuote: minAmountOut reflects the slippage tolerance on the USDT proceeds, not the token amount sold", () => {
  const amountOut = fairValueAmountOut("5", TSLAB.decimals, USDT.decimals, 355.5, 1);
  const quote = buildSellQuote({
    quoteAmountInRaw: "5",
    inputAsset: TSLAB,
    outputAsset: USDT,
    stockPriceUsd: 355.5,
    quoteAssetPriceUsd: 1,
    routerAmountOut: amountOut,
    slippageBps: 100, // 1.00%
    routeDescription: "100% V3",
    routerAddress: ROUTER,
    now: 1_000_000,
  });
  assert.equal(quote.minAmountOut, (amountOut * 9900n) / 10000n);
});
