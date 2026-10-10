import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getPythLatestPrice } from "./pyth.ts";
import { isWeekendGuardError } from "../errors.ts";

/**
 * Covers the exact production bug this task found and fixed: a malformed
 * or truncated Pyth Hermes response body (a real HTTP failure mode — an
 * upstream proxy issue, not hypothetical) previously made `res.json()`
 * throw a raw, untyped SyntaxError that escaped getPythLatestPrice
 * entirely untyped. providers/reference.ts only catches
 * `isWeekendGuardError(err)` errors from this call and rethrows anything
 * else — so that raw SyntaxError propagated uncaught all the way through
 * wrapperCommon.ts (which, before this task's fix, had no try/catch
 * around its reference-price call either) into getAllSupportedStocks'
 * Promise.all, failing the ENTIRE /api/market response — every ticker,
 * every wrapper — into a single 502 "unavailable," instead of degrading
 * gracefully for just this one reference lookup.
 */

describe("getPythLatestPrice — malformed response handling", () => {
  test("a response body that isn't valid JSON throws a typed WeekendGuardError, never a raw SyntaxError", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.PYTH_API_KEY;
    process.env.PYTH_API_KEY = "test-key";
    globalThis.fetch = (async () => new Response("this is not valid json", { status: 200 })) as typeof fetch;

    try {
      await assert.rejects(
        getPythLatestPrice("some-feed-id", "Equity.US.TEST/USD"),
        (err: unknown) => {
          assert.ok(isWeekendGuardError(err), "must be a typed WeekendGuardError, not a raw SyntaxError");
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.PYTH_API_KEY;
      else process.env.PYTH_API_KEY = originalKey;
    }
  });
});
