import { NextResponse } from "next/server";
import { getSession } from "@/lib/protection/protectionSessionStore";
import { evaluateAuthorizationRequest } from "@/lib/protection/settlementAuthorizationCore";
import { isSettlementSignerConfigured, signSettlementAuthorization } from "@/lib/protection/settlementSigner";
import { getOnChainPolicy } from "@/lib/protection/settlementContractReader";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/dev/settlement-authorization
 *
 * SECURITY PATCH (see reports/Settlement audit and deployment readiness.md,
 * sections E/L — read that before changing this file again). The audit
 * found this route would sign a validly-usable `eligible: true`
 * authorization for ANY caller-supplied `policyId`, using whatever
 * `sessionId` the caller ALSO supplied, with NO check that the two actually
 * belonged together, and NO authentication at all. Both are fixed here.
 * Nothing else about the settlement architecture changed: the contract
 * (WeekendGuardSettlement.sol), the EIP-712 message shape, and the
 * off-chain trust pipeline are all untouched — the audit already confirmed
 * those are sound.
 *
 * This route is now pure HTTP plumbing: authenticate, fetch the two
 * inputs (the off-chain session, the on-chain policy), and hand them to
 * evaluateAuthorizationRequest() (settlementAuthorizationCore.ts, pure,
 * directly unit-tested) — which is the ONLY place that decides whether
 * signing is allowed. Signing happens strictly after that function returns
 * `ok: true`; there is no code path that signs first and checks after.
 *
 * AUTH (mirrors /api/protection-scheduler's environment-aware pattern —
 * see that route's own doc comment and DEPLOYMENT.md section 5 for the
 * precedent this follows): SETTLEMENT_AUTHORIZATION_SECRET is a SEPARATE,
 * dedicated secret, not reused from SCHEDULER_TRIGGER_SECRET — signing
 * authority is a materially more sensitive privilege than triggering a
 * monitoring check, and bundling them would let anyone who can trigger
 * monitoring also mint settlement authorizations. If unset: open in
 * development (NODE_ENV !== "production"), FAILS CLOSED (503) in
 * production. Accepted as `Authorization: Bearer <secret>` or
 * `?secret=<secret>`, matching the scheduler route's own convention.
 *
 * Body: { sessionId: string, policyId: string, nonce: string }
 */
interface RequestBody {
  sessionId: string;
  policyId: string;
  nonce: string;
}

type AuthCheck = "AUTHORIZED" | "UNAUTHORIZED" | "NOT_CONFIGURED_IN_PRODUCTION";

function checkAuthorization(request: Request): AuthCheck {
  const required = process.env.SETTLEMENT_AUTHORIZATION_SECRET;
  if (!required) {
    return process.env.NODE_ENV === "production" ? "NOT_CONFIGURED_IN_PRODUCTION" : "AUTHORIZED";
  }

  const { searchParams } = new URL(request.url);
  const fromQuery = searchParams.get("secret");
  const authHeader = request.headers.get("authorization");
  const fromHeader = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : undefined;

  return fromQuery === required || fromHeader === required ? "AUTHORIZED" : "UNAUTHORIZED";
}

export async function POST(request: Request) {
  const auth = checkAuthorization(request);
  if (auth === "NOT_CONFIGURED_IN_PRODUCTION") {
    console.error(
      "[settlement-authorization] blocked: SETTLEMENT_AUTHORIZATION_SECRET is not set in a production environment — refusing to sign anything. Set SETTLEMENT_AUTHORIZATION_SECRET to enable this endpoint."
    );
    return NextResponse.json(
      { error: "Settlement authorization is disabled: SETTLEMENT_AUTHORIZATION_SECRET is not configured for this production deployment." },
      { status: 503 }
    );
  }
  if (auth === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isSettlementSignerConfigured()) {
    return NextResponse.json(
      { error: "SETTLEMENT_SIGNER_PRIVATE_KEY is not configured — cannot sign a settlement authorization." },
      { status: 503 }
    );
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.sessionId || !body.policyId || !body.nonce) {
    return NextResponse.json({ error: "sessionId, policyId, and nonce are required." }, { status: 400 });
  }

  const verifyingContract = process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS;
  if (!verifyingContract) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS is not configured — no deployed contract to sign for." },
      { status: 503 }
    );
  }

  let policyId: bigint;
  let nonce: bigint;
  try {
    policyId = BigInt(body.policyId);
    nonce = BigInt(body.nonce);
  } catch {
    return NextResponse.json({ error: "policyId and nonce must be valid integers." }, { status: 400 });
  }

  // Fetch the two inputs the pure decision function needs. Fetched in this
  // order (session first) to match the audit's required sequence, though
  // the evaluation itself re-checks both regardless of fetch order.
  const session = getSession(body.sessionId);
  const onChainPolicy = await getOnChainPolicy(verifyingContract as `0x${string}`, policyId);

  const evaluation = evaluateAuthorizationRequest({ sessionId: body.sessionId, policyId, nonce, session, onChainPolicy });
  if (!evaluation.ok) {
    return NextResponse.json({ error: evaluation.error }, { status: evaluation.status });
  }

  try {
    const chainId = Number(process.env.NEXT_PUBLIC_SETTLEMENT_CHAIN_ID ?? "97"); // BSC testnet by default — see DEPLOYMENT.md
    const domain = {
      name: "WeekendGuardSettlement" as const,
      version: "1" as const,
      chainId,
      verifyingContract: verifyingContract as `0x${string}`,
    };
    const signature = await signSettlementAuthorization(domain, evaluation.message);

    return NextResponse.json({
      domain,
      authorization: {
        policyId: evaluation.message.policyId.toString(),
        eligible: evaluation.message.eligible,
        finalReferencePrice: evaluation.message.finalReferencePrice.toString(),
        settlementTimestamp: evaluation.message.settlementTimestamp.toString(),
        authorizationExpiry: evaluation.message.authorizationExpiry.toString(),
        nonce: evaluation.message.nonce.toString(),
      },
      signature,
      settlementOutcome: evaluation.settlementOutcome,
    });
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
