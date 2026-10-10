import { NextResponse } from "next/server";
import { discoverCandidates } from "@/lib/invest/intelligence/candidateDiscovery";
import { assessTickerViaBinanceRwa } from "@/lib/agent/binanceRwaRiskMonitor";
import { SUPPORTED_TICKERS } from "@/lib/config/assets";
import { respondToAssistantMessage } from "@/lib/invest/assistant/assistantResponder";
import { serializeBigInts } from "@/lib/invest/serializeBigInts";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/assistant
 *
 * Fetches FRESH intelligence data on every call (never cached/stale —
 * build brief §12: "the assistant must never present stale data as
 * current") via the EXISTING, unmodified discoverCandidates() +
 * assessTickerViaBinanceRwa(), then runs the deterministic action pipeline
 * (+ optional LLM rephrasing, both server-side only). No credential of any
 * kind — Binance, Pyth, or the LLM's own API key — is ever present in the
 * response; only the already-public CandidateGroup/quote structures and
 * natural-language text are returned.
 *
 * Body: { message: string }
 */
interface RequestBody {
  message: string;
}

const MAX_MESSAGE_LENGTH = 500;

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` }, { status: 400 });
  }

  try {
    const dataFetchedAt = Date.now();
    const { groups } = await discoverCandidates(SUPPORTED_TICKERS, assessTickerViaBinanceRwa);
    const response = await respondToAssistantMessage(body.message, groups, dataFetchedAt);
    // A quote-preview response carries a real PurchaseQuote (spotPurchaseCore.ts)
    // with bigint fields — JSON.stringify can't serialize those natively
    // (found live while verifying this route); serializeBigInts converts
    // them to exact decimal strings, never altering the values themselves.
    return NextResponse.json(serializeBigInts(response));
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
