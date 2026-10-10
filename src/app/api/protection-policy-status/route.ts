import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { listPoliciesForOwner } from "@/lib/protection/settlementContractReader";
import { listSessions } from "@/lib/protection/protectionSessionStore";
import { POLICY_STATUS_LABELS } from "@/lib/protection/settlementContractAbi";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * GET /api/protection-policy-status?owner=0x...&contract=0x...
 *
 * Customer-facing, read-only. Built for the Portfolio claim section
 * (PHASE 2E) — the one new thing it does is cross-reference a wallet's
 * REAL on-chain policies (scanned directly from the deployed contract,
 * never from the local session store alone) against the off-chain
 * monitoring/settlement state, so the UI can show one honest status per
 * policy without the user ever needing to know a sessionId or policyId.
 *
 * Deliberately does NOT expose a way to generate a NEW authorization —
 * that remains server-side-only, gated by SETTLEMENT_AUTHORIZATION_SECRET
 * (or now, automatically, by the scheduler — settlementAuthorizationIssuer.ts).
 * This route only ever returns an authorization that was ALREADY generated
 * and persisted by that gated process. It is safe to leave unauthenticated
 * beyond the owner-address filter: every field returned is either already
 * public on-chain (policy data) or was already signed by the trusted
 * signer for exactly this policy/decision — reading it back changes
 * nothing and lets no one obtain a signature for a decision that wasn't
 * already made by the real pipeline.
 */
type PolicyStatusLabel =
  | "MONITORING_NOT_STARTED"
  | "MONITORING_IN_PROGRESS"
  | "SETTLED_AWAITING_AUTHORIZATION"
  | "READY_TO_RESOLVE_ELIGIBLE"
  | "READY_TO_RESOLVE_NOT_ELIGIBLE"
  | "RESOLVED_ELIGIBLE_AWAITING_CLAIM"
  | "CLAIMED"
  | "CLOSED_NO_PAYOUT";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner");
  const contract = searchParams.get("contract");

  if (!owner || !isAddress(owner)) {
    return NextResponse.json({ error: "A valid owner address is required." }, { status: 400 });
  }
  if (!contract || !isAddress(contract)) {
    return NextResponse.json({ error: "A valid contract address is required." }, { status: 400 });
  }

  try {
    const policies = await listPoliciesForOwner(contract as Address, owner as Address);
    const sessions = listSessions();

    const results = policies.map((policy) => {
      const session = sessions.find((s) => s.onChainPolicyId === policy.policyId);
      const onChainStatusLabel = POLICY_STATUS_LABELS[policy.status] ?? "UNKNOWN";

      let statusLabel: PolicyStatusLabel;
      if (policy.status === 2 /* ELIGIBLE */) {
        statusLabel = "RESOLVED_ELIGIBLE_AWAITING_CLAIM";
      } else if (policy.status === 3 /* CLAIMED */) {
        statusLabel = "CLAIMED";
      } else if (policy.status === 4 /* CLOSED_NO_PAYOUT */) {
        statusLabel = "CLOSED_NO_PAYOUT";
      } else if (!session) {
        statusLabel = "MONITORING_NOT_STARTED";
      } else if (session.status !== "SETTLED" || !session.settlement) {
        statusLabel = "MONITORING_IN_PROGRESS";
      } else if (!session.settlementAuthorization) {
        statusLabel = "SETTLED_AWAITING_AUTHORIZATION";
      } else if (session.settlement.outcome === "SETTLEMENT_ELIGIBLE") {
        statusLabel = "READY_TO_RESOLVE_ELIGIBLE";
      } else {
        statusLabel = "READY_TO_RESOLVE_NOT_ELIGIBLE";
      }

      // Only ever returned while the policy is still ACTIVE on-chain — once
      // resolved, re-submitting would just revert (policy.status != ACTIVE),
      // so there is no reason to keep handing it out, and doing so could
      // mislead a UI into offering a stale "resolve" action.
      const readyAuthorization =
        policy.status === 1 /* ACTIVE */ && session?.settlementAuthorization ? session.settlementAuthorization : undefined;

      return {
        policyId: policy.policyId,
        underlyingTicker: policy.underlyingTicker,
        wrapper: policy.wrapper,
        tokenizedStockContract: policy.tokenizedStockContract,
        maxPayoutAmount: policy.maxPayoutAmount.toString(),
        premiumAmount: policy.premiumAmount.toString(),
        coveredPositionValue: policy.coveredPositionValue.toString(),
        thresholdBps: policy.thresholdBps.toString(),
        startTime: policy.startTime.toString(),
        expiryTime: policy.expiryTime.toString(),
        onChainStatus: policy.status,
        onChainStatusLabel,
        statusLabel,
        settlementOutcome: session?.settlement?.outcome,
        settlementReason: session?.settlement?.reason,
        trustBrokenAt: session?.trustContinuity.brokenAt,
        readyAuthorization,
      };
    });

    return NextResponse.json({ policies: results });
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 502 });
  }
}
