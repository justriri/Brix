import { test } from "node:test";
import assert from "node:assert/strict";
import { getSettlementSignerConfigError, isSettlementSignerConfigured } from "./settlementSigner.ts";

// Run with: node --experimental-strip-types --test src/lib/protection/*.test.mts
//
// LIVE-DIAGNOSED CASE (this exact bug was found while verifying this task):
// SETTLEMENT_SIGNER_PRIVATE_KEY was configured, but held a 12-word phrase
// instead of a raw private key — isSettlementSignerConfigured() returned
// true (just checking truthiness) even though signing would have thrown.
// These tests lock in the fix: presence AND format are both required, and
// the diagnostic message never includes the actual value either way.

async function withKey(value: string | undefined, fn: () => void) {
  const saved = process.env.SETTLEMENT_SIGNER_PRIVATE_KEY;
  try {
    if (value === undefined) delete process.env.SETTLEMENT_SIGNER_PRIVATE_KEY;
    else process.env.SETTLEMENT_SIGNER_PRIVATE_KEY = value;
    fn();
  } finally {
    if (saved === undefined) delete process.env.SETTLEMENT_SIGNER_PRIVATE_KEY;
    else process.env.SETTLEMENT_SIGNER_PRIVATE_KEY = saved;
  }
}

test("unset -> not configured, with a clear 'not set' diagnostic", async () => {
  await withKey(undefined, () => {
    assert.equal(isSettlementSignerConfigured(), false);
    assert.match(getSettlementSignerConfigError() ?? "", /not set/i);
  });
});

test("a 12-word mnemonic phrase (the live-diagnosed bad case: a seed phrase pasted in where a raw key was expected) -> not configured, diagnosed as malformed, value never echoed in the message", async () => {
  // A generic, made-up 12-word example — not any real phrase — purely to
  // exercise the "looks like words, not hex" shape that was actually found.
  const examplePhrase = "apple bridge castle dolphin eagle forest garden harbor island jungle kite lantern";
  await withKey(examplePhrase, () => {
    assert.equal(isSettlementSignerConfigured(), false);
    const message = getSettlementSignerConfigError() ?? "";
    assert.match(message, /not a valid private key/i);
    assert.doesNotMatch(message, /apple bridge castle/);
  });
});

test("a well-formed 0x + 64-hex-char value -> configured, no config error", async () => {
  await withKey(`0x${"a".repeat(64)}`, () => {
    assert.equal(isSettlementSignerConfigured(), true);
    assert.equal(getSettlementSignerConfigError(), null);
  });
});

test("missing the 0x prefix -> not configured, even with otherwise-valid-looking hex", async () => {
  await withKey("a".repeat(64), () => {
    assert.equal(isSettlementSignerConfigured(), false);
    assert.match(getSettlementSignerConfigError() ?? "", /not a valid private key/i);
  });
});

test("wrong length (too short) -> not configured", async () => {
  await withKey(`0x${"a".repeat(40)}`, () => {
    assert.equal(isSettlementSignerConfigured(), false);
  });
});

test("non-hex characters -> not configured", async () => {
  await withKey(`0x${"z".repeat(64)}`, () => {
    assert.equal(isSettlementSignerConfigured(), false);
  });
});
