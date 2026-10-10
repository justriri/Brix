import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTransactionError, mapQuoteError } from "./transactionErrors.ts";

test("user rejection in the wallet maps to a plain cancellation message", () => {
  const result = mapTransactionError({ name: "UserRejectedRequestError", message: "User rejected the request." });
  assert.equal(result.userMessage, "The transaction was cancelled in your wallet.");
  assert.match(result.rawMessage, /User rejected/);
});

test("insufficient gas (BNB) maps to a specific gas message", () => {
  const result = mapTransactionError({ message: "insufficient funds for gas * price + value" });
  assert.match(result.userMessage, /BNB/);
});

test("insufficient token balance/allowance maps to a specific balance message", () => {
  const result = mapTransactionError({ message: "ERC20: transfer amount exceeds balance" });
  assert.match(result.userMessage, /does not have enough/);
});

test("router's INSUFFICIENT_OUTPUT_AMOUNT revert maps to a slippage-specific message", () => {
  const result = mapTransactionError({ message: "execution reverted: PancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT" });
  assert.match(result.userMessage, /slippage/);
});

test("an expired deadline maps to a deadline-specific message", () => {
  const result = mapTransactionError({ message: "execution reverted: PancakeRouter: EXPIRED" });
  assert.match(result.userMessage, /deadline/);
});

test("a wrong-chain error maps to a network-switch message", () => {
  const result = mapTransactionError({ message: "chain mismatch: expected BSC mainnet" });
  assert.match(result.userMessage, /network/);
});

test("no wallet provider maps to a connect-wallet message", () => {
  const result = mapTransactionError(new Error("No wallet provider found."));
  assert.match(result.userMessage, /No wallet is connected/);
});

test("an unrecognized error falls back to a generic message, but preserves the raw message for debugging", () => {
  const result = mapTransactionError(new Error("some totally novel RPC error 0xdeadbeef"));
  assert.equal(result.userMessage, "The transaction failed. See details for the technical error.");
  assert.match(result.rawMessage, /0xdeadbeef/);
});

test("a plain string error is handled without throwing", () => {
  const result = mapTransactionError("weird string error");
  assert.equal(typeof result.userMessage, "string");
});

test("a null/undefined error is handled without throwing", () => {
  const result = mapTransactionError(null);
  assert.equal(typeof result.userMessage, "string");
});

// Transport/RPC classification (live-diagnosed: Smart Router's on-chain
// reads returned HTTP 429 repeatedly against a rate-limited RPC during the
// "Get Buy Quote isn't working" investigation) — shared by both mappers.

test("mapTransactionError: an HTTP 429 maps to a rate-limit-specific message, not the generic fallback", () => {
  const result = mapTransactionError({ message: "HTTP request failed. Status: 429" });
  assert.match(result.userMessage, /rate-limit|busy/i);
  assert.notEqual(result.userMessage, "The transaction failed. See details for the technical error.");
});

test("mapTransactionError: a request timeout maps to a timeout-specific message", () => {
  const result = mapTransactionError({ message: "Request timeout 3000ms" });
  assert.match(result.userMessage, /timed out/i);
});

test("mapTransactionError: a DNS/connect failure maps to a network-reachability message", () => {
  const result = mapTransactionError({ message: "fetch failed", cause: new Error("getaddrinfo ENOTFOUND 56.rpc.thirdweb.com") });
  assert.match(result.userMessage, /reach the blockchain network/i);
});

// WeekendGuardSettlement.sol's own revert reasons — live-diagnosed: a
// read-only simulateContract() dry run against the real deployed contract
// reproduced "WeekendGuard: insufficient reserve" (totalReserve is
// currently $0), which fell through to the generic fallback before this
// classifier existed, hiding a real, specific, on-chain reason.

test("mapTransactionError: 'insufficient reserve' maps to a specific, non-generic message naming the reserve pool, not the wallet/network", () => {
  const result = mapTransactionError({ message: "execution reverted: WeekendGuard: insufficient reserve" });
  assert.match(result.userMessage, /reserve/i);
  assert.notEqual(result.userMessage, "The transaction failed. See details for the technical error.");
});

test("mapTransactionError: 'exceeds exposure cap' maps to a specific message", () => {
  const result = mapTransactionError({ message: "execution reverted: WeekendGuard: exceeds exposure cap" });
  assert.match(result.userMessage, /exposure cap/i);
});

test("mapTransactionError: 'exceeds per-user cap' maps to a specific message", () => {
  const result = mapTransactionError({ message: "execution reverted: WeekendGuard: exceeds per-user cap" });
  assert.match(result.userMessage, /per wallet|per-user/i);
});

test("mapTransactionError: an unrecognized WeekendGuard revert still surfaces its own reason text, not a generic fallback", () => {
  const result = mapTransactionError({ message: "execution reverted: WeekendGuard: bad threshold" });
  assert.match(result.userMessage, /bad threshold/i);
  assert.notEqual(result.userMessage, "The transaction failed. See details for the technical error.");
});

// mapQuoteError — deliberately separate from mapTransactionError (see its
// own doc comment): buildPurchaseQuote()'s own clear safety messages must
// survive verbatim, not get replaced by a generic fallback.

test("mapQuoteError: 'no executable route' is passed through verbatim, not replaced by a generic message", () => {
  const original = "No executable route was found from USDT to TSLAon through PancakeSwap right now — this token may not have enough on-chain liquidity to buy.";
  const result = mapQuoteError(new Error(original));
  assert.equal(result.userMessage, original);
});

test("mapQuoteError: the executable-liquidity gate's rejection message is passed through verbatim", () => {
  const original = "This pool does not have enough executable liquidity for a trade this size (estimated price impact 10.44%, which is above the 3.00% safety limit). Try a smaller amount, or wait for deeper liquidity.";
  const result = mapQuoteError(new Error(original));
  assert.equal(result.userMessage, original);
});

test("mapQuoteError: an HTTP 429 during quote fetching maps to a rate-limit message, not a liquidity message", () => {
  const result = mapQuoteError({ message: "HTTP request failed. Status: 429" });
  assert.match(result.userMessage, /rate-limit|busy/i);
  assert.doesNotMatch(result.userMessage, /liquidity/i, "a transport failure must never be misreported as a liquidity failure");
});

test("mapQuoteError: a timeout during quote fetching maps to a timeout message, not a liquidity message", () => {
  const result = mapQuoteError({ message: "Request timeout 10000ms" });
  assert.match(result.userMessage, /timed out/i);
  assert.doesNotMatch(result.userMessage, /liquidity/i);
});

test("mapQuoteError: an unrecognized error falls back to a quote-specific generic message (distinct wording from the transaction-stage fallback), preserving the raw message", () => {
  const result = mapQuoteError(new Error("some totally novel RPC error 0xdeadbeef"));
  assert.match(result.userMessage, /quote/i);
  assert.match(result.rawMessage, /0xdeadbeef/);
});

test("mapQuoteError: a null/plain-string error is handled without throwing", () => {
  assert.equal(typeof mapQuoteError(null).userMessage, "string");
  assert.equal(typeof mapQuoteError("weird string error").userMessage, "string");
});
