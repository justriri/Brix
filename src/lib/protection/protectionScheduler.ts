// Relative imports WITH explicit .ts extensions for same-folder, VALUE-level
// dependencies — the same `allowImportingTsExtensions` pattern used
// throughout lib/protection/* (see protectionMonitoringRunner.ts for the
// original rationale): this file calls real functions, not just types, and
// must stay resolvable by both Next's bundler and Node's test runner.
import { listSessions, saveSession } from "./protectionSessionStore.ts";
import { runProtectionMonitoring, type MonitoringAction } from "./protectionMonitoringRunner.ts";
import { buildDefaultWeekendSchedule, buildScheduleForExpiry } from "./monitoringSchedule.ts";
import { issueSettlementAuthorizationIfReady } from "./settlementAuthorizationIssuer.ts";
import type { FetchAssessmentsFn } from "./trustSnapshot.ts";
import type { ProtectionMonitoringSession } from "./protectionMonitoringSession.ts";
import type { Address } from "viem";

/**
 * Protection Scheduler — the ONE new piece of this task. Everything it does
 * is "which ACTIVE sessions (plural), loaded from the persistent store, need
 * the existing runner invoked against them right now" — it adds no trust,
 * price, or Safety Gate logic of its own, and does not re-implement
 * per-checkpoint "is this due / already recorded / missed" logic, because
 * runProtectionMonitoring() (protectionMonitoringRunner.ts, unmodified)
 * already does exactly that, checkpoint-by-checkpoint, for one session.
 * This module is only the fan-out across MULTIPLE persisted sessions:
 *
 *   Scheduler            -- NEW, this file
 *     -> listSessions()  -- EXISTING store read (the DB is now the only
 *                           source of truth for which sessions exist; no
 *                           second in-memory session list is kept here)
 *     -> runProtectionMonitoring() per ACTIVE session -- EXISTING, unmodified
 *          -> getRealTrustSnapshot()        -- EXISTING, unmodified
 *          -> recordTrustCheckpoint()       -- EXISTING, unmodified
 *          -> evaluateTrustContinuity()     -- EXISTING, unmodified (called
 *                                              inside recordTrustCheckpoint)
 *          -> evaluateProtectionSettlement() -- EXISTING, unmodified
 *     -> saveSession()   -- EXISTING store write
 *
 * RESTART SAFETY: this function holds no session list in memory between
 * calls — every invocation re-reads `listSessions()` from SQLite fresh.
 * That is what makes "server crashed between Saturday and Sunday, a new
 * process starts and the scheduler discovers the Sunday checkpoint is due
 * from the persisted session alone" (build brief's own worked example)
 * work with zero special-cased recovery code: it's just what calling this
 * function does, every time, regardless of what happened before.
 *
 * MISSED CHECKPOINTS: handled entirely by the existing runner/
 * missedCheckpoint.ts — this file does not know that concept exists.
 *
 * TIME: the ONLY time concept here is `now`, an injectable ms-epoch
 * (defaults to `Date.now()`, which is timezone-independent — like every
 * other timestamp in this codebase, nothing is interpreted in the server's
 * local timezone). The scheduler does not compute what's "due" itself —
 * see monitoringSchedule.ts (unmodified) via the runner.
 *
 * CONCURRENCY: two overlapping calls to this function (e.g. two external
 * cron triggers close together, or one slow request overlapping the next)
 * can both read the same session, both compute the same checkpoint, and
 * both call saveSession() — this is exactly the race protectionSessionStore.ts
 * already defends against with a real SQL UNIQUE constraint (see its own
 * doc comment). No additional locking is introduced here, per the build
 * brief's explicit instruction not to add Redis/queues/distributed locks
 * unless genuinely required — the existing single-file-SQLite protection is
 * reused, not duplicated.
 *
 * FAILURE ISOLATION: one session's fetchAssessments() throwing (e.g. a
 * live Binance/Pyth outage for that one ticker) is caught per-session and
 * recorded as a scheduler-level failure — it does not stop the loop from
 * reaching the remaining sessions. A session's fetch instead gracefully
 * returning "no matching assessment" surfaces as the runner's own, EXISTING
 * `SNAPSHOT_UNAVAILABLE` action (no new trust interpretation invented) and
 * is bucketed under `failed` in the summary below for the same reason:
 * either way, that session's due checkpoint was NOT captured this run and
 * should be retried on the next trigger.
 */

export interface SchedulerSessionOutcome {
  sessionId: string;
  /** "processed": at least one checkpoint/settlement was actually recorded this run. "skipped": nothing was due, or everything due was already recorded. "failed": a due checkpoint could not be captured this run (snapshot unavailable, or fetchAssessments threw) — safe to retry on the next trigger. */
  outcome: "processed" | "skipped" | "failed";
  actions: MonitoringAction[];
  error?: string;
}

export interface SchedulerRunSummary {
  processed: number;
  skipped: number;
  failed: number;
  results: SchedulerSessionOutcome[];
}

export interface RunDueProtectionCheckpointsParams {
  /** Injectable "current time" (ms epoch) — defaults to the real clock. Overriding this is a DEV/TEST convenience only (see the scheduler endpoint's own doc comment) — a real external cron trigger should never pass this. */
  now?: number;
  /** Defaults to the real assessTickerViaBinanceRwa when omitted — callers (tests, the dev endpoint) can inject a fake fetcher instead, same pattern as protectionMonitoringRunner.ts already uses. */
  fetchAssessments: FetchAssessmentsFn;
  /**
   * Settlement contract address + chain id, for the automatic authorization-
   * issuance step after a session settles (settlementAuthorizationIssuer.ts).
   * Optional and omittable in tests that don't exercise that step — when
   * omitted, authorization issuance is skipped entirely for this run (every
   * session still gets its monitoring/settlement evaluation; only the
   * "sign a submittable authorization" step is skipped), never a crash.
   */
  settlementContract?: { address: Address; chainId: number };
}

function classifyActions(actions: MonitoringAction[]): "processed" | "skipped" | "failed" {
  if (actions.some((a) => a.type === "RECORDED_CHECKPOINT" || a.type === "RECORDED_MISSED_CHECKPOINT" || a.type === "EVALUATED_SETTLEMENT")) {
    return "processed";
  }
  if (actions.some((a) => a.type === "SNAPSHOT_UNAVAILABLE")) {
    return "failed";
  }
  return "skipped";
}

/**
 * Runs every currently-due checkpoint for every ACTIVE session found in
 * persistent storage, one session at a time. Safe to call repeatedly
 * (idempotent per checkpoint, via the existing DB uniqueness constraint)
 * and safe to call from multiple overlapping triggers (see CONCURRENCY
 * above). Returns a summary, never throws for an individual session's
 * failure.
 */
export async function runDueProtectionCheckpoints(
  params: RunDueProtectionCheckpointsParams
): Promise<SchedulerRunSummary> {
  const now = params.now ?? Date.now();
  const sessions: ProtectionMonitoringSession[] = listSessions().filter((s) => s.status === "ACTIVE");

  const results: SchedulerSessionOutcome[] = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  const startedAt = Date.now();
  // OBSERVABILITY (build brief Task 8): enough to debug a failed cron run
  // without building a logging platform — counts, session ids, and
  // durations only. Never logs secrets, Authorization headers, or raw
  // provider responses (those never reach this function in the first
  // place: the route only passes a secret through its own auth check,
  // never into here, and fetchAssessments results are summarized via the
  // runner's own MonitoringAction.detail strings, not dumped raw).
  console.log(
    `[protectionScheduler] run started now=${new Date(now).toISOString()} activeSessions=${sessions.length}`
  );

  for (const session of sessions) {
    // Sessions linked to a real on-chain policy derive their schedule from
    // that policy's actual expiry (more correct — see monitoringSchedule.ts's
    // own doc comment on buildScheduleForExpiry); dev/simulated sessions
    // without a link keep the original fixed 3-day cadence unchanged, so
    // every existing test (none of which link a policy at session-start)
    // behaves exactly as before.
    const schedule = session.onChainPolicyId
      ? buildScheduleForExpiry(session.startedAt, session.expiresAt)
      : buildDefaultWeekendSchedule(session.startedAt);
    try {
      const result = await runProtectionMonitoring({
        session,
        schedule,
        now,
        fetchAssessments: params.fetchAssessments,
      });

      let finalSession = result.session;
      // Automatic authorization issuance — only attempted once monitoring
      // just settled this session AND a contract is actually configured for
      // this run. Failure here (missing signer key, RPC down, already
      // resolved on-chain) is logged plainly and left for the next run to
      // retry; it never fails the monitoring result that already succeeded.
      if (finalSession.status === "SETTLED" && params.settlementContract) {
        try {
          const issueResult = await issueSettlementAuthorizationIfReady({
            session: finalSession,
            contractAddress: params.settlementContract.address,
            chainId: params.settlementContract.chainId,
          });
          finalSession = issueResult.session;
          if (issueResult.issued) {
            console.log(`[protectionScheduler] session ${session.sessionId}: settlement authorization issued and ready to submit.`);
          } else if (issueResult.reason) {
            console.log(`[protectionScheduler] session ${session.sessionId}: authorization not issued — ${issueResult.reason}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[protectionScheduler] session ${session.sessionId}: authorization issuance failed — ${message}`);
        }
      }

      saveSession(finalSession);

      const outcome = classifyActions(result.actions);
      if (outcome === "processed") processed++;
      else if (outcome === "failed") failed++;
      else skipped++;

      results.push({ sessionId: session.sessionId, outcome, actions: result.actions });
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[protectionScheduler] session ${session.sessionId} failed: ${message}`);
      results.push({ sessionId: session.sessionId, outcome: "failed", actions: [], error: message });
    }
  }

  console.log(
    `[protectionScheduler] run finished processed=${processed} skipped=${skipped} failed=${failed} durationMs=${Date.now() - startedAt}`
  );

  return { processed, skipped, failed, results };
}
