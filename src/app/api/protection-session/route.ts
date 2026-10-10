import { NextResponse } from "next/server";
import { startProtectionSession, linkOnChainPolicy } from "@/lib/protection/protectionMonitoringSession";
import { getSession, saveSession } from "@/lib/protection/protectionSessionStore";
import { getRealTrustSnapshot } from "@/lib/protection/trustSnapshot";
import { assessTickerViaBinanceRwa } from "@/lib/agent/binanceRwaRiskMonitor";
import { getOnChainPolicy } from "@/lib/protection/settlementContractReader";
import { hashProtectionSessionId } from "@/lib/protection/settlementAuthorizationCore";
import type { Wrapper } from "@/lib/types";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/protection-session
 *
 * Closes the one gap that blocked the entire settlement/claim pipeline for
 * a REAL purchase: PurchaseProtectionButton.tsx opens a real on-chain
 * policy, but nothing ever told the off-chain monitoring pipeline
 * (protectionMonitoringSession.ts / protectionScheduler.ts, both
 * unmodified) that policy exists. This route is the bridge, called once
 * right after a real purchase confirms — never from any dev/demo surface
 * (that remains /api/dev/protection-session, untouched).
 *
 * SAFETY:
 *  - The on-chain policy is re-read directly from the deployed contract
 *    (read-only) and its OWN `protectionSessionId` hash must match a hash
 *    of the submitted `sessionId` — the exact same binding check
 *    settlementAuthorizationCore.ts's evaluateAuthorizationRequest already
 *    uses for the settlement-authorization route. A caller who doesn't
 *    already know the real sessionId used at purchase time (a
 *    high-entropy string containing the owner's address and a purchase
 *    timestamp — never guessable, never logged anywhere a third party
 *    could read it) cannot register a session against someone else's
 *    policy.
 *  - IDEMPOTENT: if a session already exists for this sessionId, it is
 *    returned UNCHANGED — never recreated, never overwritten. This matters
 *    because the Friday snapshot establishes the policy's own entry
 *    reference price; silently replacing it on a retried request would
 *    change what "the price dropped enough" is measured against.
 *  - NEVER fabricates a snapshot: the Friday trust snapshot is fetched
 *    fresh, server-side, via the existing real pipeline
 *    (assessTickerViaBinanceRwa -> getRealTrustSnapshot) — nothing from the
 *    request body is ever used as price/safety data. If no live assessment
 *    is available right now, this fails closed with an explicit error
 *    rather than starting a session on invented data.
 */
interface RequestBody {
  sessionId: string;
  underlying: string;
  wrapper: Wrapper;
  onChainPolicyId: string;
  settlementContractAddress: string;
  expiresAt: number;
  thresholdPercent: number;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { sessionId, underlying, wrapper, onChainPolicyId, settlementContractAddress, expiresAt, thresholdPercent } = body;
  if (!sessionId || !underlying || !wrapper || !onChainPolicyId || !settlementContractAddress || !expiresAt || !thresholdPercent) {
    return NextResponse.json(
      { error: "sessionId, underlying, wrapper, onChainPolicyId, settlementContractAddress, expiresAt, and thresholdPercent are all required." },
      { status: 400 }
    );
  }

  const existing = getSession(sessionId);
  if (existing) {
    return NextResponse.json({ session: existing, created: false });
  }

  let policyId: bigint;
  try {
    policyId = BigInt(onChainPolicyId);
  } catch {
    return NextResponse.json({ error: "onChainPolicyId must be a valid integer." }, { status: 400 });
  }

  const onChainPolicy = await getOnChainPolicy(settlementContractAddress as `0x${string}`, policyId);
  if (!onChainPolicy) {
    return NextResponse.json(
      { error: "Could not read the on-chain policy — the contract may be unreachable or misconfigured." },
      { status: 502 }
    );
  }
  if (onChainPolicy.status === 0 /* NONE */) {
    return NextResponse.json({ error: `No on-chain policy exists for policyId "${onChainPolicyId}".` }, { status: 404 });
  }
  const expectedHash = hashProtectionSessionId(sessionId);
  if (onChainPolicy.protectionSessionId !== expectedHash) {
    return NextResponse.json(
      { error: "sessionId does not match the on-chain policy's own protectionSessionId — refusing to register." },
      { status: 403 }
    );
  }

  try {
    const { snapshot, warnings } = await getRealTrustSnapshot(underlying, wrapper, "friday", assessTickerViaBinanceRwa);
    if (!snapshot) {
      return NextResponse.json(
        { error: `Could not get a live Safety Gate snapshot for ${wrapper} ${underlying} right now: ${warnings.join(" ") || "no assessment available"}. The policy was purchased on-chain, but monitoring cannot start until a live snapshot is available — retry shortly.` },
        { status: 502 }
      );
    }

    let session = startProtectionSession({
      sessionId,
      underlying,
      wrapper,
      expiresAt,
      thresholdPercent,
      fridaySnapshot: snapshot,
    });
    session = linkOnChainPolicy(session, onChainPolicyId);
    saveSession(session);

    return NextResponse.json({ session, created: true });
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}

/** GET /api/protection-session?sessionId=... — read-only status check for the claim UI; same session shape /api/dev/protection-session's GET already returns. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId query param is required." }, { status: 400 });
  }
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: `No session found for sessionId "${sessionId}".` }, { status: 404 });
  }
  return NextResponse.json({ session });
}
