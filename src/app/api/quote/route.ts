import { NextResponse } from "next/server";
import type { Address } from "viem";
import { isAddress } from "viem";
import { assessPortfolio, requestQuoteForPosition } from "@/lib/agent/orchestrator";
import { toUserMessage } from "@/lib/errors";
import type { Wrapper } from "@/lib/types";

export const runtime = "nodejs";

interface QuoteRequestBody {
  address: string;
  wrapper: Wrapper;
  underlying: string;
  thresholdPercent: number;
}

/**
 * POST /api/quote
 * body: { address, wrapper, underlying, thresholdPercent }
 *
 * Returns a clearly-labelled development-only ProtectionQuote (see
 * lib/protection/quote.ts) for one of the caller's already-detected
 * positions, or 403 if the Safety Gate doesn't currently allow an offer.
 */
export async function POST(request: Request) {
  let body: QuoteRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.address || !isAddress(body.address)) {
    return NextResponse.json({ error: "A valid BSC wallet address is required." }, { status: 400 });
  }
  if (!Number.isFinite(body.thresholdPercent) || body.thresholdPercent <= 0) {
    return NextResponse.json({ error: "thresholdPercent must be a positive number." }, { status: 400 });
  }

  try {
    const { assessments } = await assessPortfolio(body.address as Address);
    const assessment = assessments.find(
      (a) => a.position.stock.wrapper === body.wrapper && a.position.stock.underlying === body.underlying
    );

    if (!assessment) {
      return NextResponse.json({ error: "No matching position found for this wallet." }, { status: 404 });
    }
    if (!assessment.canOfferProtection) {
      return NextResponse.json(
        { error: `Protection is not offered for this position: ${assessment.offerReason}` },
        { status: 403 }
      );
    }

    const quote = await requestQuoteForPosition(assessment, body.thresholdPercent);
    return NextResponse.json({ quote });
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
