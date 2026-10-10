import type { Wrapper } from "@/lib/types";
// Relative import WITH an explicit .ts extension (enabled project-wide via
// tsconfig's `allowImportingTsExtensions`, which requires `noEmit` — already
// true here) rather than the usual "@/" alias: this file has a genuine
// VALUE-level (not just type) dependency on weekendTrustMonitor.ts's real
// functions, and this form is resolvable natively both by Next's bundler
// AND by Node's `--experimental-strip-types` test runner, which cannot
// resolve the "@/" path-mapping alias on its own. Kept local to this import
// specifically because it's needed; other files keep using "@/" normally.
import {
  canProtectionStart,
  computeThresholdCrossed,
  decideSettlement,
  evaluateTrustContinuity,
  type SettlementDecision,
  type TrustContinuityResult,
  type TrustSnapshot,
} from "./weekendTrustMonitor.ts";

/**
 * Protection Monitoring Session — the stateful lifecycle wrapper around the
 * EXISTING, pure weekendTrustMonitor.ts. This file adds NO new trust or
 * settlement rules of its own; every decision below is a direct call into
 * an already-existing, already-tested function:
 *   - starting:   canProtectionStart()      (unchanged)
 *   - continuity: evaluateTrustContinuity() (unchanged) — re-run fresh over
 *                 the growing checkpoint history every time a new one is
 *                 recorded, which is what makes "a later PASS never erases
 *                 an earlier break" work correctly with zero new logic:
 *                 evaluateTrustContinuity() already has that property.
 *   - threshold:  computeThresholdCrossed() (unchanged)
 *   - settlement: decideSettlement()        (unchanged)
 *
 * The session's only real job is remembering a growing list of
 * TrustSnapshot objects over multiple separate calls (start now, checkpoint
 * later, checkpoint later, settle later) instead of requiring them all
 * upfront the way runWeekendTrustMonitor() does in one shot. It does not
 * call Binance, Pyth, DexScreener, or anything else — see
 * lib/protection/trustSnapshot.ts for how a real TrustSnapshot is obtained,
 * and lib/protection/protectionSessionStore.ts (a SEPARATE file) for the
 * in-memory prototype persistence layer. Everything in THIS file is pure:
 * every function returns a new session object and never mutates its input.
 */

export type ProtectionMonitoringStatus = "NOT_STARTED" | "ACTIVE" | "SETTLED";

export interface ProtectionMonitoringSession {
  sessionId: string;
  underlying: string;
  wrapper: Wrapper;
  /** Protection start timestamp — the Friday snapshot's own timestamp, not a separately-chosen clock reading. */
  startedAt: number;
  expiresAt: number;
  thresholdPercent: number;
  fridaySnapshot: TrustSnapshot;
  /** Every snapshot recorded AFTER Friday (saturday/sunday/monday/...), in the order recorded. */
  checkpoints: TrustSnapshot[];
  /**
   * The EXISTING TrustContinuityResult type, recomputed fresh from
   * `checkpoints` every time one is added — this single reused field
   * answers every one of the brief's requested questions directly:
   * "trust ever broken" = trustContinuity.status === "TRUST_BROKEN";
   * "first trust-break" = trustContinuity.brokenAt (+ look up that
   * checkpoint's own timestamp in `checkpoints` if a numeric timestamp is
   * needed); "trust-break reasons" = trustContinuity.brokenReasons.
   */
  trustContinuity: TrustContinuityResult;
  status: ProtectionMonitoringStatus;
  /** Set once evaluateProtectionSettlement() successfully runs; undefined until then. */
  settlement?: SettlementDecision;
  /**
   * The on-chain WeekendGuardSettlement policy id this session is linked to
   * (a decimal string, since Solidity's uint256 can exceed JS's safe
   * integer range) — set only after the user purchases on-chain protection
   * for this session. Purely additive/traceability: nothing in the trust
   * continuity or settlement-decision logic above reads or depends on this
   * field. The off-chain session remains the source of truth for WHETHER
   * settlement is eligible; this field only remembers WHICH on-chain policy
   * that decision should be relayed to.
   */
  onChainPolicyId?: string;
  /**
   * A ready-to-submit settlement authorization, generated and signed
   * server-side (settlementAuthorizationIssuer.ts) once this session reaches
   * SETTLED and is linked to a still-ACTIVE on-chain policy. Purely
   * additive/traceability, same as `onChainPolicyId`: nothing in the trust
   * continuity or settlement-decision logic reads or depends on this field.
   * Stored as strings (bigint-safe) so it serializes cleanly to SQLite/JSON
   * — mirrors settlementContractClient.ts's own SerializedSettlementAuthorization
   * shape exactly, so the browser can hand it straight to resolveSettlementOnChain()
   * with no reshaping.
   */
  settlementAuthorization?: {
    domain: { name: "WeekendGuardSettlement"; version: "1"; chainId: number; verifyingContract: `0x${string}` };
    authorization: {
      policyId: string;
      eligible: boolean;
      finalReferencePrice: string;
      settlementTimestamp: string;
      authorizationExpiry: string;
      nonce: string;
    };
    signature: `0x${string}`;
    settlementOutcome: string;
    generatedAt: number;
  };
}

/**
 * Attaches a generated settlement authorization — a pure, no-op-unless-
 * called field attach, same style as `linkOnChainPolicy`. Callers
 * (settlementAuthorizationIssuer.ts) are responsible for only calling this
 * once per session (idempotency is enforced there, not here, by checking
 * `session.settlementAuthorization` is still undefined first) — this
 * function itself makes no eligibility/idempotency decision, it only
 * attaches already-decided data.
 */
export function attachSettlementAuthorization(
  session: ProtectionMonitoringSession,
  settlementAuthorization: NonNullable<ProtectionMonitoringSession["settlementAuthorization"]>
): ProtectionMonitoringSession {
  return { ...session, settlementAuthorization };
}

export interface StartProtectionSessionParams {
  sessionId: string;
  underlying: string;
  wrapper: Wrapper;
  expiresAt: number;
  thresholdPercent: number;
  fridaySnapshot: TrustSnapshot;
}

/**
 * Starts a session from a real (or scenario-fixture) Friday TrustSnapshot.
 * Reuses canProtectionStart() unchanged — if the initial Safety Gate/trust
 * state didn't pass, the returned session has status "NOT_STARTED" and an
 * empty checkpoint history; it is NOT an error/throw, matching the
 * existing runWeekendTrustMonitor()'s own "PROTECTION_NOT_STARTED" pattern
 * for the same situation.
 */
export function startProtectionSession(params: StartProtectionSessionParams): ProtectionMonitoringSession {
  const status: ProtectionMonitoringStatus = canProtectionStart(params.fridaySnapshot) ? "ACTIVE" : "NOT_STARTED";

  return {
    sessionId: params.sessionId,
    underlying: params.underlying,
    wrapper: params.wrapper,
    startedAt: params.fridaySnapshot.timestamp,
    expiresAt: params.expiresAt,
    thresholdPercent: params.thresholdPercent,
    fridaySnapshot: params.fridaySnapshot,
    checkpoints: [],
    trustContinuity: evaluateTrustContinuity([]), // no checkpoints yet -> TRUST_INTACT, by the existing function's own definition
    status,
  };
}

/**
 * Records which on-chain WeekendGuardSettlement policy this session is
 * linked to — a pure, no-op-unless-called field attach, same "returns a
 * new session object, never mutates" style as every other function here.
 * Callable at any session status (purchase can reasonably happen right
 * after Friday's session starts, or be attached slightly after) — this
 * function makes no trust/settlement decision, so there is nothing to gate.
 */
export function linkOnChainPolicy(session: ProtectionMonitoringSession, onChainPolicyId: string): ProtectionMonitoringSession {
  return { ...session, onChainPolicyId };
}

/**
 * Appends one TrustSnapshot to the session's history and recomputes
 * continuity over the WHOLE accumulated history via the existing
 * evaluateTrustContinuity() — this is what guarantees a later healthy
 * checkpoint can never erase an earlier failure, since that function
 * already folds left-to-right and keeps the FIRST break (see its own
 * tests in weekendTrustMonitor.test.mts).
 *
 * A no-op (returns the session unchanged) if the session isn't ACTIVE —
 * recording a checkpoint on a session that never started, or one that's
 * already settled, is a caller-sequencing situation to surface via
 * `.status`, not a thrown error, consistent with this module's pure,
 * never-throws style.
 */
export function recordTrustCheckpoint(
  session: ProtectionMonitoringSession,
  snapshot: TrustSnapshot
): ProtectionMonitoringSession {
  if (session.status !== "ACTIVE") {
    return session;
  }

  const checkpoints = [...session.checkpoints, snapshot];
  const trustContinuity = evaluateTrustContinuity(checkpoints);

  return { ...session, checkpoints, trustContinuity };
}

/**
 * Finds the first-trust-break checkpoint's own real timestamp, if any —
 * a small convenience lookup over `trustContinuity.brokenAt` (a label) so
 * callers who specifically want a numeric "first trust-break timestamp"
 * (per the brief's own wording) don't have to search `checkpoints`
 * themselves.
 */
export function getFirstTrustBreakTimestamp(session: ProtectionMonitoringSession): number | undefined {
  if (!session.trustContinuity.brokenAt) return undefined;
  return session.checkpoints.find((c) => c.checkpoint === session.trustContinuity.brokenAt)?.timestamp;
}

/**
 * Evaluates settlement using the existing decideSettlement() directly —
 * no new settlement rules. Requires a checkpoint explicitly labelled
 * "monday" to be present in the history (the LAST one with that label, in
 * case of re-evaluation); if the session never started, is already
 * settled, or has no Monday checkpoint yet, returns the session UNCHANGED
 * (settlement cannot proceed) rather than fabricating a decision — matching
 * the brief's own "no valid active session -> settlement cannot proceed."
 */
export function evaluateProtectionSettlement(session: ProtectionMonitoringSession): ProtectionMonitoringSession {
  if (session.status !== "ACTIVE") {
    return session;
  }

  const mondaySnapshot = [...session.checkpoints].reverse().find((c) => c.checkpoint === "monday");
  if (!mondaySnapshot) {
    return session;
  }

  const fridayRef = session.fridaySnapshot.safetyGateResult.primaryReference?.price;
  const mondayRef = mondaySnapshot.safetyGateResult.primaryReference?.price;
  // Mirrors runWeekendTrustMonitor()'s own fallback exactly: if either
  // price is missing, `false` here is never load-bearing, because a
  // missing Monday reference price already means Monday's own gate isn't
  // PASS (referenceDeviation requires both prices) — decideSettlement()
  // independently routes that to SETTLEMENT_BLOCKED regardless.
  const thresholdCrossed =
    fridayRef !== undefined && mondayRef !== undefined
      ? computeThresholdCrossed(fridayRef, mondayRef, session.thresholdPercent)
      : false;

  const settlement = decideSettlement({
    trustContinuity: session.trustContinuity,
    mondaySnapshot,
    thresholdCrossed,
  });

  return { ...session, status: "SETTLED", settlement };
}
