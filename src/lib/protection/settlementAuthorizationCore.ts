import { keccak256, toBytes } from "viem";
import type { SettlementDecision } from "@/lib/protection/weekendTrustMonitor";

/**
 * Pure, dependency-free EIP-712 message assembly for the settlement
 * authorization bridge between WeekendGuardSettlement.sol (contracts/) and
 * the existing, unmodified off-chain trust pipeline. Mirrors the exact
 * struct layout hashed on-chain (see the contract's
 * SETTLEMENT_AUTHORIZATION_TYPEHASH) — field names, order, and Solidity
 * types below must stay byte-for-byte identical to the contract, or
 * ECDSA.recover() there will not match what was signed here.
 *
 * This file does NOT decide eligibility or compute a reference price — it
 * only repackages an already-computed `SettlementDecision` (from
 * weekendTrustMonitor.ts's decideSettlement(), unmodified) into the shape
 * the contract expects. The one judgment call already made off-chain
 * (Safety Gate -> trust continuity -> threshold -> SettlementOutcome) is
 * NOT re-derived or second-guessed here.
 */

/** Matches the contract's `Wrapper` enum ordering exactly (BSTOCKS=0, ONDO=1, XSTOCKS=2) — changing this file's order without changing the contract's (or vice versa) would silently mis-encode every policy's wrapper. */
export const CONTRACT_WRAPPER_INDEX = { bstocks: 0, ondo: 1, xstocks: 2 } as const;

/**
 * keccak256 of the off-chain sessionId string — the exact value the
 * contract stores as `Policy.protectionSessionId` at purchase time (see
 * settlementContractClient.ts's purchaseProtectionOnChain). The ONE place
 * this hash is computed, reused by both the browser-side purchase flow and
 * the server-side settlement-authorization route's binding check (security
 * patch, see reports/Settlement audit and deployment readiness.md section
 * E/L) — both sides must compute this identically or a legitimate policy
 * would never bind-check successfully.
 */
export function hashProtectionSessionId(sessionId: string): `0x${string}` {
  return keccak256(toBytes(sessionId));
}

export const SETTLEMENT_AUTHORIZATION_TYPES = {
  SettlementAuthorization: [
    { name: "policyId", type: "uint256" },
    { name: "eligible", type: "bool" },
    { name: "finalReferencePrice", type: "int256" },
    { name: "settlementTimestamp", type: "uint64" },
    { name: "authorizationExpiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface SettlementAuthorizationMessage {
  policyId: bigint;
  eligible: boolean;
  finalReferencePrice: bigint;
  settlementTimestamp: bigint;
  authorizationExpiry: bigint;
  nonce: bigint;
}

export interface Eip712Domain {
  name: "WeekendGuardSettlement";
  version: "1";
  chainId: number;
  verifyingContract: `0x${string}`;
}

/** Fixed-point scale used for `finalReferencePrice` on-chain — 1e8, matching Pyth's own common equity-feed exponent convention, so the carried-through number is directly comparable to what Pyth published, with no further rescaling needed for a human reading the event log. */
const REFERENCE_PRICE_SCALE = BigInt(100_000_000);

function scalePrice(price: number): bigint {
  return BigInt(Math.round(price * Number(REFERENCE_PRICE_SCALE)));
}

export interface BuildAuthorizationParams {
  decision: SettlementDecision;
  policyId: bigint;
  nonce: bigint;
  /** Ms epoch "now" — defaults to Date.now(); explicit for deterministic tests. */
  now?: number;
  /** How long this SIGNED MESSAGE itself stays valid, in seconds — independent of the policy's own expiry (build brief Task 7: "ensure the authorization cannot be replayed" / Task 8 "expired authorization -> no payout"). Defaults to 1 hour: long enough for a relayer to submit the transaction, short enough that a leaked/old authorization can't be replayed long after issuance. */
  authorizationValiditySeconds?: bigint;
}

/**
 * Builds the exact message the contract will hash and verify a signature
 * against. `eligible` is taken DIRECTLY from `decision.outcome ===
 * "SETTLEMENT_ELIGIBLE"` — SETTLEMENT_BLOCKED and NO_PAYOUT both map to
 * `eligible: false`, since the contract only has a binary "pays / doesn't
 * pay" concept; the distinction between "blocked because trust broke" and
 * "no payout because threshold wasn't crossed" is preserved off-chain in
 * the existing SettlementDecision.reason / outcome for display/audit, not
 * discarded, just not representable as a third on-chain state because
 * nothing on-chain needs to act differently between those two cases.
 */
export function buildSettlementAuthorizationMessage(params: BuildAuthorizationParams): SettlementAuthorizationMessage {
  const nowMs = params.now ?? Date.now();
  const nowSec = BigInt(Math.floor(nowMs / 1000));
  const validity = params.authorizationValiditySeconds ?? BigInt(3600);

  const referencePrice = params.decision.mondaySnapshot.safetyGateResult.primaryReference?.price;

  return {
    policyId: params.policyId,
    eligible: params.decision.outcome === "SETTLEMENT_ELIGIBLE",
    // 0 when no trusted reference price exists (e.g. trust was broken) —
    // never fabricated; `eligible` is false in exactly that situation, so
    // this value is carried for transparency only and is not acted on.
    finalReferencePrice: referencePrice !== undefined ? scalePrice(referencePrice) : BigInt(0),
    settlementTimestamp: BigInt(Math.floor(params.decision.mondaySnapshot.timestamp / 1000)),
    authorizationExpiry: nowSec + validity,
    nonce: params.nonce,
  };
}

/**
 * SECURITY PATCH (reports/Settlement audit and deployment readiness.md,
 * sections E/L). Pure decision logic for whether a settlement-authorization
 * request should be signed at all — extracted so the binding check (the
 * actual fix) is directly unit-testable with fake session/on-chain-policy
 * objects, with no network, no HTTP server, and no real signing required.
 * The route (/api/dev/settlement-authorization) does nothing but fetch the
 * two inputs below and call this function before ever touching the signer.
 *
 * Enforces, IN ORDER (the audit explicitly calls out "sign, then validate"
 * as the wrong order — this function is what makes that impossible: nothing
 * downstream of it can run before all of this has already passed):
 *   1. the session exists
 *   2. the on-chain policy exists (status !== NONE — a never-created
 *      policyId is not an error at the Solidity level, since mappings
 *      zero-initialize, so this must be checked explicitly)
 *   3. the policy's own on-chain protectionSessionId matches a hash of the
 *      REQUESTED sessionId — the actual cross-binding fix; checked BEFORE
 *      even looking at whether the session is settled, so a mismatched
 *      request learns nothing about the session's own state
 *   4. the session actually reached a settlement decision
 */
export interface SessionLike {
  status: string;
  settlement?: SettlementDecision;
}

export interface OnChainPolicyLike {
  protectionSessionId: `0x${string}`;
  /** Raw PolicyStatus enum value — 0 means "never created" (NONE). */
  status: number;
}

const ON_CHAIN_POLICY_STATUS_NONE = 0;

export interface EvaluateAuthorizationRequestParams {
  sessionId: string;
  policyId: bigint;
  nonce: bigint;
  session: SessionLike | undefined;
  onChainPolicy: OnChainPolicyLike | null;
  now?: number;
}

export type AuthorizationRequestResult =
  | { ok: true; message: SettlementAuthorizationMessage; settlementOutcome: string }
  | { ok: false; status: number; error: string };

export function evaluateAuthorizationRequest(params: EvaluateAuthorizationRequestParams): AuthorizationRequestResult {
  if (!params.session) {
    return { ok: false, status: 404, error: `No session found for sessionId "${params.sessionId}".` };
  }

  if (!params.onChainPolicy) {
    return {
      ok: false,
      status: 502,
      error: "Could not read the on-chain policy — the contract may be unreachable or misconfigured.",
    };
  }
  if (params.onChainPolicy.status === ON_CHAIN_POLICY_STATUS_NONE) {
    return { ok: false, status: 404, error: `No on-chain policy exists for policyId "${params.policyId}".` };
  }

  const expectedSessionHash = hashProtectionSessionId(params.sessionId);
  if (params.onChainPolicy.protectionSessionId !== expectedSessionHash) {
    return {
      ok: false,
      status: 403,
      error: `sessionId "${params.sessionId}" does not match the on-chain policy's own protectionSessionId — refusing to sign.`,
    };
  }

  if (params.session.status !== "SETTLED" || !params.session.settlement) {
    return {
      ok: false,
      status: 409,
      error: `Session "${params.sessionId}" has not reached a settlement decision yet (status: ${params.session.status}).`,
    };
  }

  const message = buildSettlementAuthorizationMessage({
    decision: params.session.settlement,
    policyId: params.policyId,
    nonce: params.nonce,
    now: params.now,
  });
  return { ok: true, message, settlementOutcome: params.session.settlement.outcome };
}
