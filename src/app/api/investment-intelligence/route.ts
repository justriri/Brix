import { NextResponse } from "next/server";
import { discoverCandidates, type DiscoverCandidatesResult } from "@/lib/invest/intelligence/candidateDiscovery";
import { assessTickerWithFallback } from "@/lib/agent/binanceRwaRiskMonitor";
import { SUPPORTED_TICKERS } from "@/lib/config/assets";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * GET /api/investment-intelligence
 *
 * Thin HTTP wrapper around discoverCandidates() (pure orchestration) and
 * assessTickerViaBinanceRwa() (EXISTING, unmodified — already live-verified
 * in earlier phases). Unlike /api/binance-rwa (restricted to TSLA only, a
 * deliberate narrow scope from an earlier integration phase —
 * assessTickerViaBinanceRwa() itself is fully generic per-ticker, confirmed
 * by reading lib/agent/binanceRwaRiskMonitor.ts directly), this route
 * covers every ticker in the existing SUPPORTED_TICKERS list (TSLA, AAPL,
 * NVDA) — the full set this codebase already has verified BSC contract
 * addresses for in lib/config/assets.ts.
 *
 * Never exposes BINANCE_WEB3_API_KEY/SECRET or PYTH_API_KEY — those are
 * read only inside the existing, unmodified provider files
 * (providers/binanceRwa.ts, providers/pyth.ts), never touched here, and
 * nothing in this route's response shape could leak them (it only returns
 * the already-public CandidateGroup/CandidateEvaluation structures).
 *
 * SHORT IN-PROCESS CACHE: this is the single most expensive route in the
 * app (a multi-API discovery across three tickers), and both the landing
 * page (hero preview + markets preview) and /app's Markets panel call it
 * within seconds of each other on the exact "click Start investing" path.
 * A short TTL avoids redundant, byte-for-byte-identical live fetches in
 * that window. 20s is well inside the UI's own existing 5-minute
 * staleness tolerance (InvestmentIntelligencePanel's `isStale` check), and
 * every cached response still carries its own real `fetchedAt` — never a
 * fabricated "just now" timestamp for genuinely older data. Per-process
 * only (not shared across serverless instances); that's fine here since
 * its only job is smoothing the handful of seconds between two page loads
 * in one user's session, not acting as a system of record.
 */
const CACHE_TTL_MS = 20_000;
let cache: { result: DiscoverCandidatesResult; fetchedAt: number } | null = null;
let inFlight: Promise<DiscoverCandidatesResult> | null = null;

export async function GET() {
  try {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json({ ...cache.result, fetchedAt: cache.fetchedAt });
    }

    // A second request arriving while the first is still in flight (e.g.
    // the landing page's hero preview AND markets preview both fetching
    // on first paint) reuses that same in-flight call rather than firing
    // a redundant second one.
    if (!inFlight) {
      inFlight = discoverCandidates(SUPPORTED_TICKERS, assessTickerWithFallback).finally(() => {
        inFlight = null;
      });
    }
    const result = await inFlight;
    const fetchedAt = Date.now();
    cache = { result, fetchedAt };
    return NextResponse.json({ ...result, fetchedAt });
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
