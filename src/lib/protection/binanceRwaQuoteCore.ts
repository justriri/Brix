/**
 * Pure, dependency-free quote-assembly logic for the Binance-RWA-sourced
 * weekend protection quote flow. Takes already-known primitives (position
 * amount/value, the already-computed Safety Gate status, a pre-looked-up
 * premium rate, a pre-computed expiry) and deterministically assembles the
 * quote fields — it does NOT read a wallet balance, call Binance/Pyth, or
 * compute the premium-tier lookup or next-market-open itself. That
 * orchestration lives in binanceRwaQuote.ts (a normal app file using the
 * project's "@/" import alias); this file stays zero-import specifically
 * so it's directly unit-testable with Node's test runner (see
 * binanceRwaQuoteCore.test.mts) without pulling in either flow's provider/
 * chain import graph — the same pattern already used for
 * binanceRwaTimestamp.ts and trustedQuoteLiquidity.ts.
 *
 * STILL A DEMO/SIMULATION LAYER: this never purchases, activates, collects
 * a premium, or moves funds — it only computes the numbers/labels a quote
 * would show. See lib/protection/policy.ts for the (untouched, still
 * fully disabled) real settlement functions this would eventually call.
 */

/** Mirrors (does not import) the one-line eligibility rule already
 * established in lib/agent/orchestrator.ts's canOfferProtection(): only a
 * PASS-ing Safety Gate makes a position eligible for a quote. Kept as a
 * direct, trivial condition here — rather than importing that function —
 * specifically so this module stays zero-import and independently
 * testable; orchestrator.ts's own copy of this rule is untouched. */
export type SafetyGateStatusLike = "PASS" | "WARNING" | "FAIL" | "UNAVAILABLE";

export interface BinanceRwaProtectionQuoteInput {
  underlying: string;
  /** Kept as a plain string (not the app's Wrapper type) to stay zero-import — the caller narrows/casts when assembling the final typed ProtectionQuote. */
  wrapper: string;
  safetyGateStatus: SafetyGateStatusLike;
  /** Token quantity held. Must be > 0 for a quote to be produced — there's no position to protect otherwise. */
  positionAmount: number;
  /** USD value of the position (positionAmount × the wrapper's own price). */
  positionValueUsd: number;
  thresholdPercent: number;
  /** Pre-computed via lib/protection/premiumTiers.ts's getIllustrativeRatePercent() — not looked up here. */
  premiumRatePercent: number;
  /** Pre-computed via lib/marketCalendar.ts's getNextMarketOpen() — not computed here. */
  expiresAt: number;
  /** Defaults to Date.now() — override for deterministic tests. */
  now?: number;
}

export interface BinanceRwaProtectionQuoteCore {
  underlying: string;
  wrapper: string;
  positionAmount: number;
  coverageAmount: number;
  thresholdPercent: number;
  premium: number;
  maxPayoutAmount: number;
  policyStatus: "quote_only";
  quotedAt: number;
  expiresAt: number;
  coveragePeriodLabel: string;
  isDevelopmentOnly: true;
}

/**
 * Deterministically assembles a quote, or returns null if the position
 * isn't eligible (Safety Gate didn't pass, or there's no position at all).
 * Pure: identical input (including an explicit `now`) always produces an
 * identical output. Never collects a premium, never moves funds, never
 * initiates a transaction — it only computes numbers.
 */
export function buildBinanceRwaProtectionQuoteCore(
  input: BinanceRwaProtectionQuoteInput
): BinanceRwaProtectionQuoteCore | null {
  if (input.safetyGateStatus !== "PASS") return null;
  if (!(input.positionAmount > 0)) return null;

  const now = input.now ?? Date.now();
  const premium = Number(((input.positionValueUsd * input.premiumRatePercent) / 100).toFixed(2));

  return {
    underlying: input.underlying,
    wrapper: input.wrapper,
    positionAmount: input.positionAmount,
    coverageAmount: input.positionValueUsd,
    thresholdPercent: input.thresholdPercent,
    premium,
    // Full-coverage, binary payout: the position's full covered value, not
    // a separately-underwritten/partial amount. A demo assumption from the
    // strategy memo's "keep MVP simple" guidance (section 7), not derived
    // from real actuarial pricing — labelled as such in the UI.
    maxPayoutAmount: input.positionValueUsd,
    policyStatus: "quote_only",
    quotedAt: now,
    expiresAt: input.expiresAt,
    coveragePeriodLabel: "Now through next market open (weekend gap window)",
    isDevelopmentOnly: true,
  };
}
