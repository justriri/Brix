import { NextResponse } from "next/server";
import { devOnlyGuardResponse } from "@/lib/devOnlyGuard";
import { getBinanceRwaStocksForTicker } from "@/lib/providers/binanceRwaStock";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * GET /api/dev/binance-rwa-test
 *
 * Small server-side verification path (per build brief) proving the
 * Binance RWA provider's normalization works end-to-end using TSLA on BSC.
 * Uses the same lib/providers/binanceRwaStock.ts path as the real
 * /api/binance-rwa integration (see lib/agent/binanceRwaRiskMonitor.ts) so
 * this route can't silently drift from what the Safety Gate actually
 * consumes — it just skips running the Safety Gate itself, returning the
 * normalized TokenizedStock objects raw for inspection.
 *
 * DEV/DIAGNOSTIC ONLY: not linked from any UI nav, not connected to
 * protection/payout execution. BINANCE_WEB3_API_KEY/SECRET stay
 * server-side — this route only ever returns the resulting data, never
 * the credentials themselves.
 */
export async function GET() {
  const guard = devOnlyGuardResponse();
  if (guard) return guard;

  try {
    const result = await getBinanceRwaStocksForTicker("TSLA");
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
