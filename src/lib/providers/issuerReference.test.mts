import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOndoIssuerReference } from "./issuerReference.ts";

// Run with: node --experimental-strip-types --test src/lib/providers/*.test.mts
// Only parseOndoIssuerReference (pure) is tested directly here —
// getOndoIssuerReference() itself makes a live network call (via
// binanceRwa.ts), consistent with this project's established pattern of
// unit-testing the pure validation/parsing logic and relying on live
// verification for the network-calling wrapper (see dexscreener.ts /
// trustedQuoteLiquidity.ts for the same split).

test("a valid, fresh, Ondo-platform reference price is accepted", () => {
  const result = parseOndoIssuerReference({ platformId: "ondo", marketData: { referencePrice: "339.214352" } });
  assert.ok(result.reference);
  assert.equal(result.reference?.price, 339.214352);
  assert.equal(result.reference?.name, "Binance RWA underlying-market (Ondo issuer reference)");
});

test("bStocks (and any non-Ondo platform) is rejected — this fallback is Ondo-only, by live-verified design", () => {
  const result = parseOndoIssuerReference({ platformId: "bstock", marketData: { referencePrice: "375.49" } });
  assert.equal(result.reference, undefined);
  assert.match(result.unavailableReason ?? "", /Ondo-only/);
});

test("a null referencePrice (confirmed live: bStocks always returns this) is treated as unavailable, never fabricated", () => {
  const result = parseOndoIssuerReference({ platformId: "ondo", marketData: { referencePrice: null } });
  assert.equal(result.reference, undefined);
  assert.match(result.unavailableReason ?? "", /missing or not a valid/);
});

test("a malformed (non-numeric) referencePrice is rejected", () => {
  const result = parseOndoIssuerReference({ platformId: "ondo", marketData: { referencePrice: "not-a-number" } });
  assert.equal(result.reference, undefined);
});

test("a zero or negative referencePrice is rejected, not treated as a valid price", () => {
  assert.equal(parseOndoIssuerReference({ platformId: "ondo", marketData: { referencePrice: "0" } }).reference, undefined);
  assert.equal(parseOndoIssuerReference({ platformId: "ondo", marketData: { referencePrice: "-5" } }).reference, undefined);
});

test("the returned reference is always labelled as always-on (Ondo's underlying-market data tracks continuously, including overnight)", () => {
  const result = parseOndoIssuerReference({ platformId: "ondo", marketData: { referencePrice: "100" } });
  assert.equal(result.reference?.isAlwaysOn, true);
});
