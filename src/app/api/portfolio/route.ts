import { NextResponse } from "next/server";
import type { Address } from "viem";
import { isAddress } from "viem";
import { assessPortfolio } from "@/lib/agent/orchestrator";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * GET /api/portfolio?address=0x...
 *
 * Runs the full agent workflow server-side (position detection -> Safety
 * Gate -> offer eligibility) for a connected wallet address, so that
 * secrets like PYTH_API_KEY / BSC_RPC_URL never reach the browser.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "A valid BSC wallet address is required." }, { status: 400 });
  }

  try {
    const result = await assessPortfolio(address as Address);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
