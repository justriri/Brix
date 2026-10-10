import type { SafetyGateResult, TokenizedStock } from "@/lib/types";
import { evaluateCandidate } from "./evaluateCandidate.ts";
import type { CandidateGroup } from "./intelligenceTypes.ts";

/**
 * Thin async orchestration layer — the ONLY non-pure file in this module.
 * Discovers candidates by calling an injected `fetchAssessments` function
 * once per ticker (matching the exact shape of the EXISTING, unmodified
 * `assessTickerViaBinanceRwa` from lib/agent/binanceRwaRiskMonitor.ts —
 * injected rather than imported directly so this file stays testable with
 * a fake fetcher, same pattern as trustSnapshot.ts's `FetchAssessmentsFn`).
 *
 * xStocks is correctly never discovered here — not because it is filtered
 * out, but because it is not part of what Binance's own RWA search returns
 * (see binanceRwaRiskMonitor.ts's own doc comment: "never against xStocks,
 * not exposed by this API"). This engine does not reach for the separate
 * DexScreener-only xstocks.ts provider, so it never pretends xStocks is an
 * available candidate here (build brief Phase 1 §1's explicit requirement).
 */

export interface DiscoveryAssessment {
  stock: TokenizedStock;
  safetyGateResult: SafetyGateResult;
}

export interface FetchAssessmentsResult {
  assessments: DiscoveryAssessment[];
  warnings: string[];
}

export type FetchAssessmentsFn = (ticker: string) => Promise<FetchAssessmentsResult>;

export interface DiscoverCandidatesResult {
  groups: CandidateGroup[];
  warnings: string[];
}

/**
 * Discovers and evaluates every wrapper available for each ticker in
 * `tickers`, grouped by underlying. A ticker that errors or returns no
 * wrappers is skipped with a warning, not a thrown failure — one bad
 * ticker must not prevent the others from being discovered (the same
 * failure-isolation principle already used by protectionScheduler.ts for
 * multiple sessions).
 *
 * Tickers are fetched CONCURRENTLY, not one-at-a-time — `fetchAssessments`
 * for one ticker has no dependency on another's result, so there is no
 * reason the whole response should wait on TSLA, then AAPL, then NVDA in
 * series. Per-ticker error isolation is unchanged: each ticker's own
 * try/catch still runs independently (via Promise.allSettled), so one
 * ticker failing can never affect another's result. Output order still
 * matches the input `tickers` order, not whichever happened to resolve
 * first, so the response stays deterministic.
 */
export async function discoverCandidates(tickers: string[], fetchAssessments: FetchAssessmentsFn): Promise<DiscoverCandidatesResult> {
  const warnings: string[] = [];
  const groups: CandidateGroup[] = [];

  const results = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const { assessments, warnings: tickerWarnings } = await fetchAssessments(ticker);
      return { ticker, assessments, tickerWarnings };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const ticker = tickers[i];
    const result = results[i];

    if (result.status === "rejected") {
      const err = result.reason;
      warnings.push(`Could not discover candidates for ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const { assessments, tickerWarnings } = result.value;
    warnings.push(...tickerWarnings);

    if (assessments.length === 0) {
      warnings.push(`No tokenized-stock wrappers were returned for ${ticker}.`);
      continue;
    }

    groups.push({
      underlying: ticker,
      wrappers: assessments.map((a) => evaluateCandidate(a.stock, a.safetyGateResult)),
    });
  }

  return { groups, warnings };
}
