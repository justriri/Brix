import { NextResponse } from "next/server";
import { devOnlyGuardResponse } from "@/lib/devOnlyGuard";
import { getRealTrustSnapshot } from "@/lib/protection/trustSnapshot";
import { assessTickerViaBinanceRwa } from "@/lib/agent/binanceRwaRiskMonitor";
import { isCheckpointTrusted, type TrustCheckpointLabel } from "@/lib/protection/weekendTrustMonitor";
import { toUserMessage } from "@/lib/errors";
import type { Wrapper } from "@/lib/types";
import { SUPPORTED_TICKERS } from "@/lib/config/assets";

export const runtime = "nodejs";

const VALID_CHECKPOINTS: TrustCheckpointLabel[] = ["friday", "saturday", "sunday", "monday"];
const VALID_WRAPPERS: Wrapper[] = ["bstocks", "ondo"];

/**
 * GET /api/dev/trust-snapshot?ticker=TSLA&wrapper=bstocks&checkpoint=friday
 *
 * DEV/DEMO ONLY (build brief Task 4): produces ONE real, live TrustSnapshot
 * right now — real Binance RWA + Pyth data through the EXISTING, unmodified
 * assessTickerViaBinanceRwa() / runSafetyGate() — via
 * lib/protection/trustSnapshot.ts, which contains no Safety Gate logic of
 * its own.
 *
 * This is NOT a weekend monitoring run and there is no scheduler behind
 * it: `checkpoint` only labels what this one live snapshot would represent
 * if it were captured at that point in an actual weekend cycle. Calling
 * this route repeatedly over a real weekend and feeding the results into
 * runWeekendTrustMonitor() would work, but nothing in this codebase does
 * that automatically yet.
 *
 * BUG FIX (BRIX product-positioning pass): this route used to reject every
 * ticker except "TSLA" outright, but its only caller, LiveTrustSnapshot.tsx,
 * ALSO hardcoded "TSLA" regardless of which wrapper it was asked to render —
 * so the two bugs canceled each other out into something worse than an
 * error: every AAPL/NVDA "Live Trust Snapshot" silently rendered TSLA's real
 * data under the wrong ticker's label. Same root cause as the two prior
 * cross-ticker bugs in this codebase (binance-rwa-quote's hardcoded
 * "TSLA", BuySpotPanel's missing `underlying`) — now fixed at both ends.
 */
export async function GET(request: Request) {
  const guard = devOnlyGuardResponse();
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "TSLA";
  const wrapperParam = searchParams.get("wrapper") ?? "bstocks";
  const checkpointParam = searchParams.get("checkpoint") ?? "friday";

  if (!SUPPORTED_TICKERS.includes(ticker as (typeof SUPPORTED_TICKERS)[number])) {
    return NextResponse.json({ error: `ticker must be one of: ${SUPPORTED_TICKERS.join(", ")}` }, { status: 400 });
  }
  if (!VALID_WRAPPERS.includes(wrapperParam as Wrapper)) {
    return NextResponse.json({ error: `wrapper must be one of: ${VALID_WRAPPERS.join(", ")}` }, { status: 400 });
  }
  if (!VALID_CHECKPOINTS.includes(checkpointParam as TrustCheckpointLabel)) {
    return NextResponse.json({ error: `checkpoint must be one of: ${VALID_CHECKPOINTS.join(", ")}` }, { status: 400 });
  }

  try {
    const result = await getRealTrustSnapshot(
      ticker,
      wrapperParam as Wrapper,
      checkpointParam as TrustCheckpointLabel,
      assessTickerViaBinanceRwa
    );

    return NextResponse.json({
      snapshot: result.snapshot,
      isTrusted: result.snapshot ? isCheckpointTrusted(result.snapshot) : false,
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
