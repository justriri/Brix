/**
 * Documented, deterministic Safety Gate thresholds.
 *
 * Per the build brief: "Use thresholds based on the research memo. Do not
 * invent arbitrary thresholds without documenting them." The research memo
 * (reports/Weekend protection strategy memo.md, section 6) specifies WHICH
 * checks must exist and that they must be documented and deterministic; it
 * does not hand down exact numeric cutoffs (that level of detail was
 * explicitly left to implementation). Every constant below therefore cites
 * the concrete fact it was derived from, rather than being picked
 * arbitrarily.
 */

export const SAFETY_THRESHOLDS = {
  /**
   * Reference price must be no older than this to be trusted DURING OPEN
   * MARKET HOURS. Derived from OneTicker's own published gate (60s quote
   * staleness cutoff — research report, "yostocks_oneticker_verification"
   * section) as a reasonable, precedented order of magnitude for an
   * actively-trading reference during market hours. We intentionally do
   * NOT reuse OneTicker's exact policy structure or values verbatim (see
   * strategy memo section 6) — this is our own, independently chosen
   * number in the same broad range.
   */
  MAX_REFERENCE_AGE_SECONDS_MARKET_OPEN: 120,

  /**
   * Reference price age allowance WHEN THE MARKET IS CLOSED. A frozen
   * Friday-close price is expected and correct here (research report:
   * a real Chainlink AAPL/USD feed was documented freezing 48-58 hours over
   * an ordinary weekend, 81+ hours over Labor Day) — so closed-market
   * staleness must not be penalized the same way open-market staleness is.
   * Set generously above a long weekend (81h Labor Day case + margin).
   */
  MAX_REFERENCE_AGE_SECONDS_MARKET_CLOSED: 96 * 60 * 60, // 96 hours

  /**
   * Minimum DEX liquidity (USD) for a wrapper to be considered usable.
   * Derived directly from real, live-observed liquidity figures for the
   * SAME tickers this MVP supports (fetched via DexScreener during this
   * build): bStocks TSLAB ~$1.9M+, NVDAB ~$3.35M, Ondo AAPLon pools as thin
   * as ~$3.8k-$8k. $50k is set well below the healthy bStocks pools and
   * well above the observed-thin Ondo pools, so it actually discriminates
   * between the two rather than passing everything or failing everything.
   *
   * IMPORTANT — this threshold's calibration basis (bStocks TSLAB ~$1.9M+)
   * assumed liquidity could be measured across BOTH V2 and V3 PancakeSwap
   * pools. For a period, trustedQuoteLiquidity.ts restricted this
   * measurement to V2-only pools (to stay consistent with a V2-only
   * execution path), which made the ACTUAL measure it's compared against
   * here drop to ~$15k for the same TSLAB — well below this threshold,
   * despite TSLAB having deep, real, executable liquidity. That V2-only
   * restriction has since been removed (execution moved to PancakeSwap's
   * Smart Router, which routes through V2 and V3) specifically so this
   * threshold's original calibration basis holds again — see
   * trustedQuoteLiquidity.ts's own module doc for the live-verified numbers.
   */
  MIN_LIQUIDITY_USD: 50_000,

  /**
   * Maximum acceptable |wrapper price - reference price| / reference price,
   * as a percentage. yostocks (research report) uses a documented ±1% rule
   * for its own quote-acceptance logic; we adopt the same order of
   * magnitude as a defensible, precedented starting point for "does this
   * wrapper's price look right", while independently implementing our own
   * check rather than reusing yostocks' code or exact wording.
   */
  MAX_REFERENCE_DEVIATION_PERCENT: 2,

  /**
   * Cross-wrapper consistency threshold: how far two wrappers of the same
   * underlying may disagree (as % of the lower price) before being flagged
   * as inconsistent, expressed as the higher of MAX_REFERENCE_DEVIATION_PERCENT
   * doubled — since two independently-deviating wrappers can each be
   * borderline-acceptable vs. the reference yet disagree with each other by
   * up to roughly double that amount.
   */
  MAX_CROSS_WRAPPER_DEVIATION_PERCENT: 4,
} as const;
