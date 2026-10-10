import { NextResponse } from "next/server";
import { getAllSupportedStocks } from "@/lib/providers";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * GET /api/market
 *
 * Live market overview across all supported tickers/wrappers — shown even
 * before a wallet is connected, so the Safety Gate's real behavior is
 * visible immediately in a demo.
 */
export async function GET() {
  try {
    const stocks = await getAllSupportedStocks();
    return NextResponse.json({ stocks });
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
