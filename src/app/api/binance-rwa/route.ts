import { NextResponse } from "next/server";
import { assessTickerViaBinanceRwa } from "@/lib/agent/binanceRwaRiskMonitor";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * GET /api/binance-rwa?ticker=TSLA
 *
 * First Safety-Gate-consuming integration of Binance RWA Data (per the
 * integration brief) — TSLA only for now. Credentials stay server-side
 * (lib/providers/binanceRwa.ts). Not connected to protection/payout.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "TSLA";

  if (ticker !== "TSLA") {
    return NextResponse.json(
      { error: "Only TSLA is supported for the Binance RWA integration so far." },
      { status: 400 }
    );
  }

  try {
    const result = await assessTickerViaBinanceRwa(ticker);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
