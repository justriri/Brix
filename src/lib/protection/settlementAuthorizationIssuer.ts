import type { Address } from "viem";
import {
  attachSettlementAuthorization,
  type ProtectionMonitoringSession,
} from "./protectionMonitoringSession.ts";
import {
  buildSettlementAuthorizationMessage,
  hashProtectionSessionId,
  type Eip712Domain,
  type SettlementAuthorizationMessage,
} from "./settlementAuthorizationCore.ts";
import {
  getSettlementSignerAddress,
  getSettlementSignerConfigError,
  isSettlementSignerConfigured,
  signSettlementAuthorization,
} from "./settlementSigner.ts";
import { getOnChainPolicy, getOnChainTrustedSigner, type OnChainPolicySummary } from "./settlementContractReader.ts";

/**
 * Closes the gap between "the off-chain pipeline decided a policy is
 * settled" (protectionMonitoringSession.ts's evaluateProtectionSettlement,
 * unmodified) and "a submittable, signed authorization exists" — without
 * ever touching a wallet or submitting a transaction. This is pure
 * server-side signing (the same trusted-signer key /api/dev/settlement-
 * authorization already uses), called automatically by the scheduler
 * instead of waiting for a human to POST the dev route by hand.
 *
 * Deliberately NEVER submits `resolveSettlement` itself — see
 * PurchaseProtectionButton.tsx-style "the owner's own connected wallet
 * submits the transaction" pattern, reused by the new claim UI. This
 * module's only job is to make sure a correctly-signed authorization is
 * SITTING READY the moment a human (the policy owner) goes to claim.
 */

/**
 * Pure decision core — every reason this can/can't proceed, given
 * already-fetched inputs, with NO network call and NO signing of its own.
 * Directly unit-testable (settlementAuthorizationIssuer.test.mts) the same
 * way settlementAuthorizationCore.ts's evaluateAuthorizationRequest is.
 * Mirrors that function's binding checks exactly (defense in depth: this
 * module is the one CREATING the onChainPolicyId link via linkOnChainPolicy
 * elsewhere, but re-verifying here means a corrupted/mismatched record can
 * never result in a signable message for the wrong policy).
 */
export interface PreSignCheckParams {
  session: ProtectionMonitoringSession;
  onChainPolicy: OnChainPolicySummary | null;
  signerConfigured: boolean;
  configuredSignerAddress?: Address;
  onChainTrustedSigner: Address | null;
}

export type PreSignCheckResult = { ok: true; policyId: bigint } | { ok: false; reason: string };

export function checkReadyToSign(params: PreSignCheckParams): PreSignCheckResult {
  const { session, onChainPolicy, signerConfigured, configuredSignerAddress, onChainTrustedSigner } = params;

  if (session.status !== "SETTLED" || !session.settlement) {
    return { ok: false, reason: "Session has not reached a settlement decision yet." };
  }
  if (session.settlementAuthorization) {
    return { ok: false, reason: "An authorization was already generated for this session." };
  }
  if (!session.onChainPolicyId) {
    return { ok: false, reason: "Session is not linked to an on-chain policy — nothing to authorize." };
  }
  if (!signerConfigured) {
    return { ok: false, reason: "SETTLEMENT_SIGNER_PRIVATE_KEY is not configured — cannot sign a settlement authorization yet." };
  }
  if (!onChainPolicy) {
    return { ok: false, reason: "Could not read the on-chain policy — the contract may be unreachable or misconfigured." };
  }
  // Someone (the owner's own wallet, via the claim UI, most likely) already
  // resolved this policy — nothing left to authorize. Not an error: this is
  // the expected end state once settlement has actually been submitted.
  if (onChainPolicy.status !== 1 /* ACTIVE */) {
    return { ok: false, reason: `On-chain policy status is ${onChainPolicy.status}, not ACTIVE — already resolved or never active.` };
  }
  const expectedHash = hashProtectionSessionId(session.sessionId);
  if (onChainPolicy.protectionSessionId !== expectedHash) {
    return { ok: false, reason: "On-chain policy's protectionSessionId does not match this session — refusing to sign." };
  }
  // Verify the configured signer key actually matches what THIS deployed
  // contract trusts — a signature from any other key would be worthless
  // (ECDSA.recover() on-chain would never match trustedSigner()), so this is
  // caught here, explicitly, rather than discovered only when a
  // resolveSettlement transaction reverts with "invalid signature."
  if (!onChainTrustedSigner) {
    return { ok: false, reason: "Could not read the contract's trustedSigner() — RPC unreachable or contract misconfigured." };
  }
  if (!configuredSignerAddress || configuredSignerAddress.toLowerCase() !== onChainTrustedSigner.toLowerCase()) {
    return {
      ok: false,
      reason: `SETTLEMENT_SIGNER_PRIVATE_KEY's address (${configuredSignerAddress ?? "unknown"}) does not match the contract's trustedSigner() (${onChainTrustedSigner}) — refusing to sign an authorization the contract would never accept.`,
    };
  }

  return { ok: true, policyId: BigInt(session.onChainPolicyId) };
}

/** Pure message+persisted-record assembly, given an already-decided `message` and signature — split out so a test can check the exact shape without actually signing. */
export function buildAttachment(
  session: ProtectionMonitoringSession,
  domain: Eip712Domain,
  message: SettlementAuthorizationMessage,
  signature: `0x${string}`
): NonNullable<ProtectionMonitoringSession["settlementAuthorization"]> {
  return {
    domain,
    authorization: {
      policyId: message.policyId.toString(),
      eligible: message.eligible,
      finalReferencePrice: message.finalReferencePrice.toString(),
      settlementTimestamp: message.settlementTimestamp.toString(),
      authorizationExpiry: message.authorizationExpiry.toString(),
      nonce: message.nonce.toString(),
    },
    signature,
    settlementOutcome: session.settlement!.outcome,
    generatedAt: Date.now(),
  };
}

export interface IssueAuthorizationResult {
  session: ProtectionMonitoringSession;
  /** True only if a NEW authorization was generated and signed this call. */
  issued: boolean;
  /** Always present when `issued` is false — explains exactly why, for logging/diagnostics. Never set when `issued` is true. */
  reason?: string;
}

export interface IssueAuthorizationParams {
  session: ProtectionMonitoringSession;
  contractAddress: Address;
  chainId: number;
}

/**
 * IDEMPOTENT: if `session.settlementAuthorization` is already set,
 * `checkReadyToSign` returns `ok: false` immediately and nothing is
 * re-signed — never issues a second, differently-nonced authorization for
 * the same decision (which would be harmless on-chain — the contract's own
 * ACTIVE-status guard means only the first one ever submitted can succeed
 * — but is unnecessary signer load and unnecessary nonce churn).
 *
 * FAILS CLOSED, EXPLICITLY: every reason this can't proceed right now is
 * returned as a clear `reason` string, never silently swallowed — callers
 * (protectionScheduler.ts) log it so a missing SETTLEMENT_SIGNER_PRIVATE_KEY
 * shows up as an actionable scheduler log line, not a session that
 * mysteriously never progresses.
 */
export async function issueSettlementAuthorizationIfReady(
  params: IssueAuthorizationParams
): Promise<IssueAuthorizationResult> {
  const { session, contractAddress, chainId } = params;

  const signerConfigured = isSettlementSignerConfigured();
  const [onChainPolicy, onChainTrustedSigner] = await Promise.all([
    session.onChainPolicyId ? getOnChainPolicy(contractAddress, BigInt(session.onChainPolicyId)) : Promise.resolve(null),
    getOnChainTrustedSigner(contractAddress),
  ]);
  const configuredSignerAddress = signerConfigured ? getSettlementSignerAddress() : undefined;

  const check = checkReadyToSign({ session, onChainPolicy, signerConfigured, configuredSignerAddress, onChainTrustedSigner });
  if (!check.ok) {
    // When the specific reason is "not configured," surface the more
    // precise diagnostic (missing vs. present-but-malformed) if one is
    // available — still never includes the key's own value.
    const detailed = !signerConfigured ? getSettlementSignerConfigError() : null;
    return { session, issued: false, reason: detailed ?? check.reason };
  }

  const domain: Eip712Domain = { name: "WeekendGuardSettlement", version: "1", chainId, verifyingContract: contractAddress };
  // A fresh nonce, generated once and then persisted immutably alongside the
  // signature (see protectionSessionStore.ts's sticky COALESCE for this
  // column) — never regenerated on a later call.
  const nonce = BigInt(Date.now());
  const message = buildSettlementAuthorizationMessage({ decision: session.settlement!, policyId: check.policyId, nonce });
  const signature = await signSettlementAuthorization(domain, message);

  const updated = attachSettlementAuthorization(session, buildAttachment(session, domain, message, signature));
  return { session: updated, issued: true };
}
