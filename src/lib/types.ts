/**
 * Core normalized types for WeekendGuard.
 *
 * The rest of the application (Safety Gate, agent, dashboard) is written
 * against these types only. Nothing outside lib/providers/* should know
 * whether a price came from bStocks, Ondo, Chainlink, Pyth, or a dev
 * fallback — it should only see a TokenizedStock / CheckResult /
 * SafetyGateResult.
 */

export type Wrapper = "bstocks" | "ondo" | "xstocks" | "unknown";

export type Chain = "bsc" | "solana" | "ethereum" | "unknown";

export type MarketStatus = "open" | "closed" | "paused" | "unknown";

export type Health = "healthy" | "warning" | "failed" | "unknown";

/**
 * A named, independent price observation used as a reference or fallback
 * (e.g. "Pyth Equity.US.TSLA/USD", "Pyth Equity.Index.AAPL/USD").
 */
export interface ReferenceSource {
  name: string;
  price: number;
  /** Unix seconds when this price was published by the source. */
  publishTimeSec: number;
  /** Optional confidence interval reported by the source, in price units. */
  confidence?: number;
  /** True if the underlying market this price tracks trades 24/7 (e.g. a synthetic "index" feed), not just during regular trading hours. */
  isAlwaysOn?: boolean;
}

/**
 * A single tokenized-stock instrument as issued by one wrapper on one chain.
 * This is the normalized shape every provider (bstocks, ondo, xstocks,
 * chainlink, pyth) must produce.
 */
export interface TokenizedStock {
  /** Underlying ticker, e.g. "TSLA". */
  underlying: string;
  /** Human-readable name, e.g. "Tesla, Inc. (bStocks)". */
  name: string;
  /** The wrapper's own on-chain token symbol, e.g. "TSLAB", if known — distinct from `name`, which is a longer display label. Optional: not every provider surfaces this separately from `name`. */
  symbol?: string;
  wrapper: Wrapper;
  chain: Chain;
  /** On-chain contract address, if this wrapper/underlying pair exists on-chain on `chain`. */
  tokenAddress?: string;
  /** Number of decimals the token uses on-chain, if known. */
  decimals?: number;

  /** Last observed wrapper price in USD (from a DEX or the wrapper's own API), if available. */
  price?: number;
  /** Independent reference price in USD (e.g. Pyth/Chainlink equity feed), if available. */
  referencePrice?: number;
  /** Which reference source produced `referencePrice`, if any. */
  referenceSource?: ReferenceSource;

  /** Age of `price` in seconds, if derivable (e.g. from last on-chain swap). */
  priceAgeSeconds?: number;
  /**
   * Human-readable label for what `priceAgeSeconds` is the age OF (e.g.
   * "Binance token price"). Optional — when unset, the freshness check
   * falls back to `referenceSource?.name`, which is correct for providers
   * where the price's own age and the independent reference's age are the
   * same timestamp. Set this explicitly whenever they're NOT the same
   * (e.g. Binance RWA: priceAgeSeconds comes from Binance's own
   * tokenPriceUpdatedAt, while referenceSource is a separate, independent
   * Pyth price used only for the deviation check) — otherwise the
   * freshness message would misattribute the age to the wrong source.
   */
  priceSourceLabel?: string;

  liquidityUsd?: number;
  volume24hUsd?: number;

  /**
   * How many underlying shares one on-chain token represents (e.g. 1.0 for
   * a strict 1:1 wrapper). Used to normalize BOTH the cross-wrapper
   * consistency check and the reference-deviation check to a per-SHARE
   * price before comparing — comparing raw per-TOKEN prices across two
   * wrappers (or against a per-share reference) with different ratios
   * would misreport a real ratio difference as a price disagreement.
   * Undefined (not assumed 1.0 by a silent default inside a check — see
   * safety/wrapperConsistency.ts / safety/referenceDeviation.ts, which
   * treat an undefined ratio as 1.0 explicitly, not implicitly) when the
   * provider hasn't fetched it.
   */
  tokenToShareRatio?: number;

  marketStatus?: MarketStatus;

  /** Short machine-readable description of where `price` came from, e.g. "dexscreener:pancakeswap". */
  source: string;

  health: Health;

  /**
   * True if any field on this object is a clearly-labelled development
   * fallback rather than a live read. Must never be true silently — see
   * `notes` for the reason.
   */
  isDevData?: boolean;

  /** Human-readable caveats surfaced to the UI (e.g. "liquidity below MVP floor", "requires PYTH_API_KEY"). */
  notes?: string[];
}

/** A user's actual on-chain holding of one TokenizedStock. */
export interface Position {
  stock: TokenizedStock;
  /** Human-readable token balance (already divided by decimals). */
  balance: number;
  /** Raw on-chain balance as a string (bigint-safe). */
  balanceRaw: string;
  usdValue?: number;
}

export type CheckSeverity = "hard" | "soft";

export interface CheckResult {
  id: string;
  label: string;
  /** null means "could not be evaluated" (e.g. missing data), not "passed". */
  passed: boolean | null;
  severity: CheckSeverity;
  value?: number | string;
  threshold?: number | string;
  message: string;
}

/**
 * FAIL is reserved for a hard check that was actually evaluated and did not
 * pass (e.g. deviation genuinely exceeds the threshold, liquidity is
 * genuinely below the floor). UNAVAILABLE means a hard check could not be
 * evaluated at all (missing price/reference/liquidity data from every
 * source tried) — a data-availability gap, not a confirmed failure. Collapsing
 * these into one FAIL status is exactly the bug this type split fixes: see
 * safety/safetyGate.ts's status derivation.
 */
export type SafetyGateStatus = "PASS" | "WARNING" | "FAIL" | "UNAVAILABLE";

export interface SafetyGateChecks {
  liquidity: CheckResult;
  priceFreshness: CheckResult;
  referenceDeviation: CheckResult;
  marketStatus: CheckResult;
  crossWrapperConsistency: CheckResult;
}

export interface SafetyGateResult {
  status: SafetyGateStatus;
  underlying: string;
  wrapper: Wrapper;
  checks: SafetyGateChecks;
  primaryReference?: ReferenceSource;
  fallbackReference?: ReferenceSource;
  reasons: string[];
  timestamp: number;
}

export interface ProtectionQuote {
  underlying: string;
  wrapper: Wrapper;
  /** Position value in USD being covered — same meaning as "position value". */
  coverageAmount: number;
  thresholdPercent: number;
  premium: number;
  /** Quote/policy expiry — the weekend-protection window's end (next market open). */
  expiresAt: number;
  safetyGateResult: SafetyGateResult;
  /** Always true today. WeekendGuard does not execute real settlement yet — see lib/protection/policy.ts. */
  isDevelopmentOnly: true;

  // --- Optional fields, added for the Binance-RWA-sourced quote flow. ---
  // Left undefined by the original Position-based getProtectionQuote()
  // (lib/protection/quote.ts) — that function needs no changes for this
  // extension; a quote missing these is just as valid as one that has them.
  /** Token quantity held (distinct from `coverageAmount`, its USD value). */
  positionAmount?: number;
  /** Maximum amount payable if the protection triggers. Currently always equal to `coverageAmount` (full-coverage, binary payout) — see reports/Weekend protection strategy memo.md section 7. A demo assumption, not derived from real underwriting. */
  maxPayoutAmount?: number;
  /** Always "quote_only" today — no quote produced by this codebase represents an active, purchased, or triggerable policy. */
  policyStatus?: "quote_only" | "active" | "expired" | "triggered" | "void";
  /** When this quote was generated (ms epoch) — distinct from `expiresAt`. */
  quotedAt?: number;
  /** Human-readable description of the coverage window, e.g. "Now through next market open (weekend gap window)". */
  coveragePeriodLabel?: string;
}
