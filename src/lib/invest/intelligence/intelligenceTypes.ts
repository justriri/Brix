import type { MarketStatus, SafetyGateResult, SafetyGateStatus, TokenizedStock, Wrapper } from "@/lib/types";

/**
 * Shared types for the Investment Intelligence Engine. This layer adds NO
 * new financial/trust logic — it only reorganizes and presents data that
 * already exists on `TokenizedStock` / `SafetyGateResult` (both unmodified).
 * See evaluateCandidate.ts's own doc comment for exactly which existing
 * fields each piece of this type is sourced from.
 */

/** One check's result, normalized to a 3-way status — "never treat missing data as PASS" (build brief Phase 1 §2): `passed: null` always maps to UNKNOWN, never PASS. */
export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";

/**
 * HOW a (non-FAIL) price was actually verified — distinct from
 * operationalStatus, which only says PASS/WARNING/FAIL. Added because a
 * single PASS badge was conflating two materially different situations:
 * a price confirmed by comparison against a SECOND wrapper
 * (CROSS_WRAPPER_CONFIRMED) vs. a price that only ever had ONE source to
 * check against an independent reference (ISSUER_REFERENCE_ONLY) — both
 * reach operationalStatus PASS (see safety/safetyGate.ts), but the UI
 * must not call the second one "verified" the same way as the first.
 */
export type PriceVerificationMode =
  | "CROSS_WRAPPER_CONFIRMED" // a second wrapper's price corroborated this one.
  | "ISSUER_REFERENCE_ONLY" // no comparable second wrapper; the independent reference (Pyth or, for Ondo, the issuer fallback) corroborated this one on its own.
  | "DISAGREEMENT" // a second wrapper's price was available but conflicts beyond the threshold.
  | "UNAVAILABLE"; // neither a comparable wrapper nor a usable independent reference exists right now.

export interface EvaluatedCheck {
  name: string;
  status: CheckStatus;
  /** Already computed by the existing Safety Gate check — never re-derived here (e.g. referenceDeviation.ts already computes this exact percent). */
  value?: number | string;
  threshold?: number | string;
  /** The existing check's own human-readable reason — carried through verbatim, never rewritten. */
  message: string;
}

export interface CandidateFacts {
  tokenPrice?: number;
  referencePrice?: number;
  liquidityUsd?: number;
  priceFreshnessSeconds?: number;
  marketStatus?: MarketStatus;
  /** On-chain decimals, when known — carried through so the assistant's quote-preview action can reuse the existing buildPurchaseQuote() (spotPurchaseCore.ts) without a second on-chain decimals lookup for the stock token itself. */
  decimals?: number;
}

/**
 * The operational evaluation of ONE wrapper of ONE underlying ticker.
 * Deliberately named "operational" everywhere, never "investment score" or
 * "rating" — build brief Phase 1 §3's hard requirement: operational
 * readiness (do the existing checks currently pass?) is kept strictly
 * separate from any notion of investment quality, which this engine never
 * computes or implies.
 */
export interface CandidateEvaluation {
  underlying: string;
  /** The wrapper's own full display name as normalized by the existing provider (e.g. "TSLA (Binance RWA: bstocks, TSLAB)") — carried through as-is, never a fabricated "company name" this codebase doesn't actually have a verified source for. */
  displayName: string;
  wrapper: Wrapper;
  tokenSymbol: string;
  tokenAddress?: string;
  /** Taken DIRECTLY from the existing, unmodified SafetyGateResult.status — not a new status vocabulary. */
  operationalStatus: SafetyGateStatus;
  /**
   * Whether "Buy Spot" should be offered at all — deliberately DIFFERENT
   * from `operationalStatus === "PASS"`. operationalStatus also reflects
   * the "Trusted liquidity" check, an absolute-dollar pool-TVL heuristic
   * that has no idea what a specific trade's real price impact would be.
   * The authoritative "can this actually be bought" answer is
   * spotPurchaseCore.ts's buildPurchaseQuote() executable-liquidity gate —
   * a live, Smart-Router-based, per-trade-size check that already runs
   * before any quote is shown, let alone signed (BuySpotPanel.tsx,
   * assistantActions.ts). Gating the "Buy Spot" button on operationalStatus
   * directly would block navigation to that real check for a wrapper whose
   * ONLY failing signal is the blunt pool-TVL heuristic — even when the
   * live, trade-size-specific route is genuinely fine (confirmed live: a
   * wrapper with ~$9.7k measured pool TVL, failing the $50k threshold,
   * still executed a representative small trade at 1.95% price impact,
   * comfortably under the 3% safety limit). This field is true exactly
   * when every OTHER hard check (price freshness, independent reference,
   * market status) passes — liquidity and the soft cross-wrapper check are
   * excluded from it the same way `runSafetyGate()` excludes the soft
   * check from forcing FAIL, mirrored here for liquidity specifically. It
   * does not replace the Safety Gate and cannot be used to skip it — it
   * only decides whether the user is allowed to ASK for a live quote, which
   * BuySpotPanel/the assistant then independently verify and can still
   * reject.
   */
  canAttemptPurchase: boolean;
  /** See PriceVerificationMode's own doc comment — how operationalStatus's (non-FAIL) price was actually corroborated, shown distinctly in the UI rather than a single undifferentiated PASS. */
  priceVerification: PriceVerificationMode;
  checks: EvaluatedCheck[];
  /** Checks that are not a clean PASS (FAIL or UNKNOWN) — for the "Failed check / Reason" UI. Empty when operationalStatus is PASS. */
  failedChecks: EvaluatedCheck[];
  facts: CandidateFacts;
  /** The existing SafetyGateResult's own timestamp — not a separately-chosen clock reading. */
  evaluationTimestamp: number;
  /** The original, unmodified TokenizedStock this evaluation was built from — carried through so the UI can hand it directly to the EXISTING BuySpotPanel.tsx (same component the Binance RWA TSLA panel already uses) without reconstructing a stock object from the flattened `facts` above. */
  stock: TokenizedStock;
  /** The original, unmodified SafetyGateResult this evaluation was built from — carried through (alongside `stock`) so the UI can hand `{stock, safetyGateResult}` directly to the EXISTING BinanceRwaProtectionQuote.tsx for ANY ticker/wrapper this engine discovers, not just the TSLA-only panel it originally shipped with. No second protection-quote UI is built; this field exists purely to let the existing one be reused more broadly. */
  safetyGateResult: SafetyGateResult;
}

/** All wrappers discovered for one underlying ticker — e.g. TSLA -> [bstocks, ondo]. xStocks is never included here: it is not returned by the Binance RWA search this engine reuses (see candidateDiscovery.ts), so it is correctly absent, not filtered out. */
export interface CandidateGroup {
  underlying: string;
  wrappers: CandidateEvaluation[];
}

export interface WrapperDifference {
  checkName: string;
  /** Plain-language, factual statement of the concrete difference — never a "winner" pick. */
  description: string;
}

export interface WrapperComparison {
  underlying: string;
  wrappers: CandidateEvaluation[];
  differences: WrapperDifference[];
}
