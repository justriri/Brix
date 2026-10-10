import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTokenPriceUpdatedAt, CLOCK_SKEW_TOLERANCE_SECONDS } from "./binanceRwaTimestamp.ts";

// Run with: node --experimental-strip-types --test src/lib/providers/binanceRwaTimestamp.test.mts

test("valid 13-digit Unix-millisecond timestamp, 5 minutes old -> correct age in seconds", () => {
  const now = 1_790_900_000_000; // arbitrary fixed "now" for a deterministic test
  const fiveMinutesMs = 5 * 60 * 1000;
  const updatedAt = now - fiveMinutesMs;

  const result = parseTokenPriceUpdatedAt(updatedAt, now);

  assert.equal(result.rejectionReason, undefined);
  assert.equal(result.ageSeconds, 5 * 60);
});

test("the exact live bug case: a current 13-digit timestamp 1s ahead of our clock (normal clock skew) -> age 0, NOT rejected", () => {
  // Reproduces the real failure: tokenPriceUpdatedAt=1790904034644 produced
  // "did not parse into a plausible age (got -1s)" before this fix.
  const updatedAt = 1_790_904_034_644;
  const now = updatedAt - 1_000; // our clock is 1s "behind" the timestamp

  const result = parseTokenPriceUpdatedAt(updatedAt, now);

  assert.equal(result.rejectionReason, undefined, "a 1s-ahead timestamp must not be rejected as implausible");
  assert.equal(result.ageSeconds, 0, "a slightly-future timestamp from clock skew should clamp to age 0, not go negative");
});

test(`a timestamp right at the clock-skew tolerance boundary (${CLOCK_SKEW_TOLERANCE_SECONDS}s ahead) -> still accepted, clamped to 0`, () => {
  const now = 1_790_900_000_000;
  const updatedAt = now + CLOCK_SKEW_TOLERANCE_SECONDS * 1000;

  const result = parseTokenPriceUpdatedAt(updatedAt, now);

  assert.equal(result.rejectionReason, undefined);
  assert.equal(result.ageSeconds, 0);
});

test("a timestamp meaningfully beyond the clock-skew tolerance (ahead by 1 minute) -> rejected as implausible, not clamped", () => {
  const now = 1_790_900_000_000;
  const updatedAt = now + 60_000; // 1 minute ahead — a real data/parsing problem, not clock skew

  const result = parseTokenPriceUpdatedAt(updatedAt, now);

  assert.equal(result.ageSeconds, undefined, "fail-closed behavior must be preserved for genuinely implausible future timestamps");
  assert.ok(result.rejectionReason);
});

test("a 10-digit (Unix-seconds-style) timestamp -> rejected for wrong digit count, never silently reinterpreted", () => {
  const now = 1_790_900_000_000;
  const tenDigitValue = Math.floor(now / 1000); // what this value would look like if it were (wrongly) seconds instead of ms

  const result = parseTokenPriceUpdatedAt(tenDigitValue, now);

  assert.equal(result.ageSeconds, undefined);
  assert.match(result.rejectionReason ?? "", /13 expected/);
});

test("an implausibly old timestamp (more than 10 years in the past) -> rejected, fail-closed preserved", () => {
  const now = 1_790_900_000_000;
  const elevenYearsMs = 11 * 365 * 24 * 60 * 60 * 1000;
  // Needs to remain a 13-digit value to isolate this from the digit-count check.
  const updatedAt = now - elevenYearsMs;

  const result = parseTokenPriceUpdatedAt(updatedAt, now);

  assert.equal(result.ageSeconds, undefined);
  assert.ok(result.rejectionReason);
});

test("missing/undefined timestamp -> rejected, never fabricated", () => {
  const result = parseTokenPriceUpdatedAt(undefined, 1_790_900_000_000);

  assert.equal(result.ageSeconds, undefined);
  assert.match(result.rejectionReason ?? "", /No tokenPriceUpdatedAt/);
});

test("non-finite timestamp (NaN) -> rejected, never fabricated", () => {
  const result = parseTokenPriceUpdatedAt(NaN, 1_790_900_000_000);

  assert.equal(result.ageSeconds, undefined);
  assert.ok(result.rejectionReason);
});
