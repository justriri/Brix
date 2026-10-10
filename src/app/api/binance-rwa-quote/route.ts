import { NextResponse } from "next/server";
import type { Address } from "viem";
import { isAddress } from "viem";
import { assessTickerViaBinanceRwa } from "@/lib/agent/binanceRwaRiskMonitor";
import { getBinanceRwaProtectionQuote } from "@/lib/protection/binanceRwaQuote";
import { toUserMessage } from "@/lib/errors";
import type { Wrapper } from "@/lib/types";

export const runtime = "nodejs";

interface QuoteRequestBody {
  address: string;
  wrapper: Wrapper;
  thresholdPercent: number;
  /** Defaults to "TSLA" ONLY for backward compatibility with the original TSLA-only integration — any caller that can see more than one ticker (e.g. InvestmentIntelligencePanel.tsx) MUST pass this explicitly. */
  underlying?: string;
}

/**
 * POST /api/binance-rwa-quote
 * body: { address, wrapper, thresholdPercent, underlying? }
 *
 * Weekend protection quote flow, Binance-RWA-sourced. Re-derives the SAME
 * assessment /api/investment-intelligence already computes (via the same,
 * unmodified assessTickerViaBinanceRwa), then reads the caller's real
 * on-chain balance and computes a development-only quote — never a
 * transaction, never fund movement, never real premium collection. See
 * lib/protection/binanceRwaQuote.ts and binanceRwaQuoteCore.ts for the
 * (unmodified-from-here) quote math.
 *
 * BUG FIX (product-hardening audit): this route used to hardcode
 * `assessTickerViaBinanceRwa("TSLA")` regardless of which wrapper was being
 * protected. That was invisible while only a TSLA-only panel ever called
 * it, but became a real cross-layer bug once the multi-ticker Investment
 * Intelligence panel started reusing this same quote flow for AAPL/NVDA
 * too: a request to protect an AAPL wrapper would have silently matched
 * against TSLA's assessment instead (same `wrapper` value, wrong
 * underlying). `underlying` is now a required-in-practice input, defaulted
 * to "TSLA" only so the original caller shape still works unchanged.
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

  const underlying = body.underlying ?? "TSLA";

  try {
    const { assessments } = await assessTickerViaBinanceRwa(underlying);
    const assessment = assessments.find((a) => a.stock.wrapper === body.wrapper);

    if (!assessment) {
      return NextResponse.json({ error: `No matching Binance RWA ${underlying} wrapper was found.` }, { status: 404 });
    }

    const result = await getBinanceRwaProtectionQuote(assessment, body.address as Address, body.thresholdPercent);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
