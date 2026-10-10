import type { SafetyGateResult, Wrapper } from "@/lib/types";
import type { TrustCheckpointLabel, TrustSnapshot } from "@/lib/protection/weekendTrustMonitor";

/**
 * Real-data adapter: Binance RWA -> Pyth -> existing Safety Gate -> real
 * TrustSnapshot -> Weekend Trust Monitor.
 *
 * This file does NOT call Binance, Pyth, or re-run any Safety Gate logic
 * itself — it only repackages an already-computed SafetyGateResult (from
 * the EXISTING, unmodified lib/agent/binanceRwaRiskMonitor.ts, which itself
 * calls the EXISTING, unmodified lib/safety/safetyGate.ts) into the
 * TrustSnapshot shape lib/protection/weekendTrustMonitor.ts already
 * defines. The existing Safety Gate remains the single source of truth;
 * this is pure plumbing between it and the (separately pure/deterministic)
 * trust monitor.
 *
 * `fetchAssessments` is REQUIRED, not defaulted to the real
 * assessTickerViaBinanceRwa() here, specifically so this file has zero
 * value-level imports from the provider/agent chain — it stays directly
 * unit-testable with a fake/mocked fetcher (see trustSnapshot.test.mts),
 * without needing any module-mocking framework. The real wiring
 * (`assessTickerViaBinanceRwa`) is supplied by the one real caller —
 * currently src/app/api/dev/trust-snapshot/route.ts — not duplicated here.
 */

/** Structural shape this module needs from one assessment — satisfied as-is by the real BinanceRwaAssessment (lib/agent/binanceRwaRiskMonitor.ts) without any cast, since TokenizedStock already has a `wrapper` field. */
export interface AssessmentLike {
  stock: { wrapper: Wrapper };
  safetyGateResult: SafetyGateResult;
}

export interface FetchAssessmentsResult {
  assessments: AssessmentLike[];
  warnings: string[];
}

/** Matches the real assessTickerViaBinanceRwa()'s signature exactly — the real function is assignable here with no adapter code needed. */
export type FetchAssessmentsFn = (ticker: string) => Promise<FetchAssessmentsResult>;

export interface RealTrustSnapshotResult {
  snapshot: TrustSnapshot | null;
  warnings: string[];
}

/**
 * Produces ONE real TrustSnapshot for `wrapper`'s current assessment of
 * `ticker`, labelled with `checkpoint` (caller's choice — this function has
 * no concept of what day it actually is; it just takes whatever the
 * injected `fetchAssessments` returns right now and stamps it with the
 * checkpoint label the caller asked for). Never fabricates a snapshot: if
 * no matching assessment is found, returns `snapshot: null` with a warning
 * explaining why, exactly like every other provider in this codebase.
 */
export async function getRealTrustSnapshot(
  ticker: string,
  wrapper: Wrapper,
  checkpoint: TrustCheckpointLabel,
  fetchAssessments: FetchAssessmentsFn,
  now: number = Date.now()
): Promise<RealTrustSnapshotResult> {
  const { assessments, warnings } = await fetchAssessments(ticker);
  const assessment = assessments.find((a) => a.stock.wrapper === wrapper);

  if (!assessment) {
    return {
      snapshot: null,
      warnings: [...warnings, `No live Safety Gate assessment was found for ${wrapper} ${ticker}.`],
    };
  }

  return {
    snapshot: { checkpoint, timestamp: now, safetyGateResult: assessment.safetyGateResult },
    warnings,
  };
}
