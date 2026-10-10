import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnits } from "viem";
import { validateWithdrawal } from "./withdrawalValidation.ts";

// Run with: node --experimental-strip-types --test src/lib/protection/*.test.mts

const OWNER = "0xf62e44f516B5aCa7A84BF482B95060927f0de167";
const DECIMALS = 18;

function base(overrides: Partial<Parameters<typeof validateWithdrawal>[0]> = {}) {
  return {
    amountRaw: "0.1",
    recipientRaw: OWNER,
    availableReserveRaw: parseUnits("0.538726", DECIMALS),
    decimals: DECIMALS,
    isOwner: true,
    correctChain: true,
    ...overrides,
  };
}

test("a valid amount, well under the available reserve, from the owner, on the right chain, to a valid address -> valid", () => {
  const result = validateWithdrawal(base());
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.amount, parseUnits("0.1", DECIMALS));
    assert.equal(result.recipient, OWNER);
  }
});

test("USDT unit conversion: '0.1' converts to the correct 18-decimal base units, not a raw integer", () => {
  const result = validateWithdrawal(base({ amountRaw: "0.1" }));
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.amount, 100_000_000_000_000_000n);
});

test("amount of exactly zero is rejected", () => {
  const result = validateWithdrawal(base({ amountRaw: "0" }));
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.reason, /greater than zero/i);
});

test("a negative amount string is rejected (parseUnits itself rejects it)", () => {
  const result = validateWithdrawal(base({ amountRaw: "-1" }));
  assert.equal(result.valid, false);
});

test("an amount exceeding the available reserve is rejected, even if it's within totalReserve", () => {
  const result = validateWithdrawal(base({ amountRaw: "1", availableReserveRaw: parseUnits("0.538726", DECIMALS) }));
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.reason, /exceeds the available/i);
});

test("an amount exactly equal to the available reserve is accepted (boundary, not off-by-one)", () => {
  const available = parseUnits("0.538726", DECIMALS);
  const result = validateWithdrawal(base({ amountRaw: "0.538726", availableReserveRaw: available }));
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.amount, available);
});

test("a non-owner wallet is rejected, regardless of a valid amount/recipient", () => {
  const result = validateWithdrawal(base({ isOwner: false }));
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.reason, /owner/i);
});

test("the wrong network is rejected before the owner check even runs", () => {
  const result = validateWithdrawal(base({ isOwner: false, correctChain: false }));
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.reason, /network/i);
});

test("an invalid recipient address (malformed) is rejected", () => {
  const result = validateWithdrawal(base({ recipientRaw: "not-an-address" }));
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.reason, /valid recipient/i);
});

test("an empty recipient address is rejected", () => {
  const result = validateWithdrawal(base({ recipientRaw: "" }));
  assert.equal(result.valid, false);
});

test("a checksum-mismatched but still well-formed hex address is still accepted by isAddress (viem normalizes case)", () => {
  const result = validateWithdrawal(base({ recipientRaw: OWNER.toLowerCase() }));
  assert.equal(result.valid, true);
});

test("a malformed amount string (not parseable) is rejected without throwing", () => {
  const result = validateWithdrawal(base({ amountRaw: "not-a-number" }));
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.reason, /valid USDT amount/i);
});
