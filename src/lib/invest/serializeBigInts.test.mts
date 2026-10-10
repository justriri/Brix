import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeBigInts } from "./serializeBigInts.ts";

test("a top-level bigint is converted to its exact decimal string", () => {
  assert.equal(serializeBigInts(123456789012345678901234567890n), "123456789012345678901234567890");
});

test("a bigint nested inside an object survives round-trip exactly, including values beyond Number.MAX_SAFE_INTEGER", () => {
  const big = 9_999_999_999_999_999_999_999n; // far beyond 2^53
  const result = serializeBigInts({ amountIn: big, symbol: "USDT" });
  assert.equal(result.amountIn, big.toString());
  assert.equal(BigInt(result.amountIn), big);
});

test("a bigint nested inside an array is converted too", () => {
  const result = serializeBigInts([1n, 2n, 3n]);
  assert.deepEqual(result, ["1", "2", "3"]);
});

test("non-bigint values (numbers, strings, booleans, null) pass through unchanged", () => {
  const input = { a: 1, b: "two", c: true, d: null, e: undefined };
  const result = serializeBigInts(input);
  assert.equal(result.a, 1);
  assert.equal(result.b, "two");
  assert.equal(result.c, true);
  assert.equal(result.d, null);
});

test("a realistic PurchaseQuote-shaped object with three bigint fields serializes without throwing", () => {
  const quote = {
    amountIn: 10000000000000000000n,
    expectedAmountOut: 28129395218002812n,
    minAmountOut: 27988718221712798n,
    slippageBps: 50,
    quotedAt: 1000,
    expiresAt: 31000,
  };
  const result = serializeBigInts(quote);
  assert.equal(result.amountIn, "10000000000000000000");
  assert.equal(result.slippageBps, 50);
});
