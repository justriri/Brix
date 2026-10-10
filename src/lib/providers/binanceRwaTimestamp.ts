/**
 * Pure, dependency-free parsing of Binance RWA's `tokenPriceUpdatedAt`
 * field into an age in seconds.
 *
 * Deliberately factored into its own file with ZERO imports (not even the
 * project's "@/" path alias) so it can be unit-tested directly with
 * Node's built-in test runner (see binanceRwaTimestamp.test.mts) without
 * needing a bundler or ts-node to resolve path aliases.
 *
 * Confirmed live (this build, 2026-09-29 and again 2026-10-01):
 * tokenPriceUpdatedAt is a 13-digit Unix-milliseconds epoch, e.g.
 * 1790901452636 / 1790904034644.
 *
 * BUG FIXED HERE (2026-10-01): a live value of 1790904034644 — a valid,
 * current 13-digit ms timestamp — produced `ageSeconds = -1` and was
 * rejected as "implausible" by the old zero-tolerance check. The digit
 * count / unit interpretation was never the problem; the problem was
 * treating ANY negative age (the timestamp a moment "ahead" of our own
 * clock, from ordinary clock skew or request latency) as invalid. Fixed
 * by tolerating a small window of "future" skew (clamped to age 0) while
 * still rejecting genuinely implausible timestamps beyond that window.
 */

/**
 * A timestamp up to this many seconds "ahead" of `now` is treated as
 * normal clock skew / request latency, not evidence of bad data, and
 * clamped to age 0. Anything beyond this is still rejected as
 * implausible — this is a tolerance window, not a loosening of the
 * fail-closed behavior for genuinely bad timestamps.
 */
export const CLOCK_SKEW_TOLERANCE_SECONDS = 5;

const THIRTEEN_DIGIT_MS_EPOCH = /^\d{13}$/;
const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;

export interface ParsedPriceAge {
  ageSeconds?: number;
  /** Present (with ageSeconds undefined) when the timestamp could not be trusted. Callers must treat this as UNKNOWN — never fabricate a value. */
  rejectionReason?: string;
}

/**
 * Parses a Binance `tokenPriceUpdatedAt` value into an age in seconds
 * relative to `now` (defaults to the real current time; overridable for
 * deterministic tests).
 *
 *  - Requires a 13-digit value (Unix milliseconds) — Binance's confirmed
 *    format for this field. A different digit count is reported as
 *    unparseable rather than silently guessed at as seconds vs.
 *    milliseconds.
 *  - A timestamp up to CLOCK_SKEW_TOLERANCE_SECONDS "ahead" of `now` is
 *    clamped to age 0 (normal clock skew / request latency).
 *  - A timestamp more than CLOCK_SKEW_TOLERANCE_SECONDS in the future, or
 *    more than ten years in the past, is rejected as implausible.
 *  - Missing/non-finite input is rejected.
 * Never fabricates or substitutes a value in any rejection case.
 */
export function parseTokenPriceUpdatedAt(
  updatedAtRaw: number | undefined,
  now: number = Date.now()
): ParsedPriceAge {
  if (typeof updatedAtRaw !== "number" || !Number.isFinite(updatedAtRaw)) {
    return { rejectionReason: "No tokenPriceUpdatedAt value was provided." };
  }

  const digitString = Math.trunc(Math.abs(updatedAtRaw)).toString();
  if (!THIRTEEN_DIGIT_MS_EPOCH.test(digitString)) {
    return {
      rejectionReason: `tokenPriceUpdatedAt (${updatedAtRaw}) has ${digitString.length} digits, not the 13 expected for a Unix-milliseconds timestamp.`,
    };
  }

  const rawAgeSeconds = Math.floor((now - updatedAtRaw) / 1000);

  if (rawAgeSeconds < -CLOCK_SKEW_TOLERANCE_SECONDS || rawAgeSeconds > TEN_YEARS_SECONDS) {
    return {
      rejectionReason: `tokenPriceUpdatedAt (${updatedAtRaw}) did not parse into a plausible age (got ${rawAgeSeconds}s).`,
    };
  }

  // Within tolerance but still technically negative (e.g. -1s, the exact
  // live case that motivated this fix) -> clamp to 0 rather than return a
  // negative age to the freshness check.
  return { ageSeconds: Math.max(0, rawAgeSeconds) };
}
