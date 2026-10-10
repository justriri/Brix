import { test } from "node:test";
import assert from "node:assert/strict";
import { runAssistantAction, type AssistantDependencies } from "./assistantActions.ts";
import { evaluateCandidate } from "../intelligence/evaluateCandidate.ts";
import type { CandidateGroup } from "../intelligence/intelligenceTypes.ts";
import type { CheckResult, SafetyGateResult, TokenizedStock, Wrapper } from "@/lib/types";

/**
 * Every test here uses a FAKE getSmartRouterTrade (never the real
 * network/RPC-backed one) — build brief Phase 2 §15: "do not make unit
 * tests depend on live APIs." The quote-preview tests prove the assistant
 * reuses buildPurchaseQuote() correctly without ever touching a real chain.
 */

function check(passed: boolean | null, value?: number | string, message = "test"): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", value, message };
}

function stock(ticker: string, wrapper: Wrapper, symbol: string, overrides: Partial<TokenizedStock> = {}): TokenizedStock {
  return {
    underlying: ticker,
    name: `${ticker} (${wrapper})`,
    symbol,
    wrapper,
    chain: "bsc",
    tokenAddress: `0x${ticker}${wrapper}`,
    price: 100,
    decimals: 18,
    source: "test",
    health: "healthy",
    ...overrides,
  };
}

function gate(underlying: string, wrapper: Wrapper, status: SafetyGateResult["status"] = "PASS", checks: Partial<SafetyGateResult["checks"]> = {}): SafetyGateResult {
  const hardPass = status !== "FAIL";
  return {
    status,
    underlying,
    wrapper,
    checks: {
      liquidity: check(hardPass),
      priceFreshness: check(hardPass),
      referenceDeviation: check(hardPass),
      marketStatus: check(hardPass),
      crossWrapperConsistency: check(status === "PASS"),
      ...checks,
    },
    reasons: [status],
    timestamp: 12345,
  };
}

const TSLA_GROUP: CandidateGroup = {
  underlying: "TSLA",
  wrappers: [
    evaluateCandidate(stock("TSLA", "bstocks", "TSLAB"), gate("TSLA", "bstocks", "PASS")),
    evaluateCandidate(stock("TSLA", "ondo", "TSLAon"), gate("TSLA", "ondo", "FAIL", { liquidity: check(false, undefined, "No qualifying trusted-quote pool was found.") })),
  ],
};

// A minimal fake Smart Router trade — only the fields assistantActions.ts
// actually reads (outputAmount.quotient, routes[].percent/.type). $10 /
// $100 per token = 0.1 token at 18 decimals — matches the price-based fair
// value exactly, so existing assertions pinned to that number stay valid:
// this fake route represents a deep, undistorted route, not the thin-route
// bug scenario (covered separately in spotPurchaseCore.test.mts).
type FakeTrade = Awaited<ReturnType<AssistantDependencies["getSmartRouterTrade"]>>;
function fakeTrade(outputAmountRaw: bigint): FakeTrade {
  return {
    outputAmount: { quotient: outputAmountRaw },
    routes: [{ percent: 100, type: 0 }],
  } as unknown as FakeTrade;
}

const FAKE_DEPS_WITH_POOL: AssistantDependencies = {
  getSmartRouterTrade: async () => fakeTrade(100_000_000_000_000_000n),
};

const FAKE_DEPS_NO_POOL: AssistantDependencies = {
  getSmartRouterTrade: async () => null,
};

test("correct use of supplied data: list-available reflects exactly the operational statuses already computed, nothing new", async () => {
  const { reply, groundedFacts } = await runAssistantAction("What's currently available?", [TSLA_GROUP], 1000, FAKE_DEPS_WITH_POOL);
  assert.match(reply, /TSLA/);
  assert.match(reply, /bstocks \(TSLAB\): PASS/);
  assert.match(reply, /ondo \(TSLAon\): FAIL/);
  assert.deepEqual(groundedFacts.groups, [TSLA_GROUP]);
});

test("no fabricated Safety Gate results: explain-status for the failing wrapper reports FAIL and the real failure reason verbatim", async () => {
  const { reply, groundedFacts } = await runAssistantAction("Why did TSLAon fail?", [TSLA_GROUP], 1000, FAKE_DEPS_WITH_POOL);
  assert.match(reply, /Operational status: FAIL/);
  assert.match(reply, /No qualifying trusted-quote pool was found\./);
  assert.equal(groundedFacts.evaluation?.wrapper, "ondo");
});

test("no fabricated prices: quote-preview uses the exact existing buildPurchaseQuote() math, not an assistant-invented number", async () => {
  const { reply, groundedFacts } = await runAssistantAction("What would $10 of TSLAB get me?", [TSLA_GROUP], 1000, FAKE_DEPS_WITH_POOL);
  const prep = groundedFacts.purchasePreparation;
  assert.ok(prep?.quote);
  // $10 / $100 per token = 0.1 token, matching the same formula spotPurchaseCore.test.mts already verifies independently.
  assert.equal(prep!.quote!.expectedAmountOut, 100_000_000_000_000_000n);
  assert.match(reply, /0\.100000 TSLAB/);
});

test("handling stale data: dataFetchedAt is passed straight through, never re-stamped to 'now' inside the action", async () => {
  const { groundedFacts } = await runAssistantAction("What's available?", [TSLA_GROUP], 999_000, FAKE_DEPS_WITH_POOL);
  assert.equal(groundedFacts.dataFetchedAt, 999_000);
});

test("purchase preparation never executes a transaction — the result carries only a quote object, no tx hash, no signing field of any kind", async () => {
  const { groundedFacts } = await runAssistantAction("What would $10 of TSLAB get me?", [TSLA_GROUP], 1000, FAKE_DEPS_WITH_POOL);
  const prep = groundedFacts.purchasePreparation!;
  assert.ok(!("hash" in prep));
  assert.ok(!("transactionHash" in prep));
  assert.ok(!("signature" in prep));
  assert.equal(typeof prep.amountUsd, "number");
});

test("Safety Gate cannot be bypassed: comparing wrappers surfaces the real failing check, the assistant cannot report both wrappers as passing", async () => {
  const { reply } = await runAssistantAction("Compare the TSLA wrappers", [TSLA_GROUP], 1000, FAKE_DEPS_WITH_POOL);
  assert.match(reply, /bstocks PASS/);
  assert.match(reply, /ondo FAIL/);
});

test("compareCandidates never implies a winner even when asked via the assistant", async () => {
  const { reply } = await runAssistantAction("Compare the TSLA wrappers", [TSLA_GROUP], 1000, FAKE_DEPS_WITH_POOL);
  // Checks for an actual recommendation claim — NOT a bare substring match
  // on "better", since the reply's own honest disclaimer legitimately
  // contains the phrase 'does not pick a "better" wrapper'.
  assert.ok(!/\b(is|was) better\b|\bwinner\s*:|\brecommended\s*:|\bbest choice\b/i.test(reply));
});

test("model/API failure equivalent: a thrown route lookup is reported as unavailable, not a crash or a fabricated quote", async () => {
  const throwingDeps: AssistantDependencies = {
    getSmartRouterTrade: async () => {
      throw new Error("PancakeSwap Smart Router unreachable");
    },
  };
  const { reply, groundedFacts } = await runAssistantAction("What would $10 of TSLAB get me?", [TSLA_GROUP], 1000, throwingDeps);
  assert.equal(groundedFacts.purchasePreparation?.quote, null);
  assert.match(reply, /Smart Router unreachable/);
});

test("no executable route at all reports unavailable, never a fabricated quote", async () => {
  const { reply, groundedFacts } = await runAssistantAction("What would $10 of TSLAB get me?", [TSLA_GROUP], 1000, FAKE_DEPS_NO_POOL);
  assert.equal(groundedFacts.purchasePreparation?.quote, null);
  assert.match(reply, /not currently available/);
  assert.match(groundedFacts.purchasePreparation?.unavailableReason ?? "", /No executable route/);
});

test("a route too thin to execute the trade reports unavailable with a liquidity reason, never a fabricated quote (mirrors the real TSLAB bug)", async () => {
  const thinRouteDeps: AssistantDependencies = {
    // Fair value for $10 of a $100 stock is 0.1 token (1e17 base units);
    // the real route can only deliver 1% of that — far past MAX_PRICE_IMPACT_BPS.
    getSmartRouterTrade: async () => fakeTrade(1_000_000_000_000_000n),
  };
  const { reply, groundedFacts } = await runAssistantAction("What would $10 of TSLAB get me?", [TSLA_GROUP], 1000, thinRouteDeps);
  assert.equal(groundedFacts.purchasePreparation?.quote, null);
  assert.match(reply, /not currently available/);
  assert.match(groundedFacts.purchasePreparation?.unavailableReason ?? "", /executable liquidity/);
});

test("an unresolvable query (ticker not in live data) never fabricates an answer about it", async () => {
  const { reply } = await runAssistantAction("Compare the GOOG wrappers", [TSLA_GROUP], 1000, FAKE_DEPS_WITH_POOL);
  assert.match(reply, /can tell you what's currently available|I couldn't quite parse/);
});
