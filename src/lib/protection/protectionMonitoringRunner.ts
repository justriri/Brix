import type { ProtectionMonitoringSession } from "@/lib/protection/protectionMonitoringSession";
// Relative imports WITH explicit .ts extensions for same-folder, VALUE-level
// dependencies — the same `allowImportingTsExtensions` pattern established
// for protectionMonitoringSession.ts, needed here for the identical reason:
// this file calls real functions (not just types) from sibling modules, and
// must stay resolvable by both Next's bundler and Node's test runner.
import { evaluateProtectionSettlement, recordTrustCheckpoint } from "./protectionMonitoringSession.ts";
import { getRealTrustSnapshot, type FetchAssessmentsFn } from "./trustSnapshot.ts";
import { buildMissedCheckpointSnapshot } from "./missedCheckpoint.ts";
import type { MonitoringSchedule } from "./monitoringSchedule.ts";

/**
 * Protection Monitoring Runner — the orchestrator that advances an EXISTING
 * session through its schedule. Per the build brief: "an orchestrator, not
 * another financial decision engine." Every line of actual decision-making
 * below delegates to an already-existing, already-tested function:
 *   - recording a checkpoint:    recordTrustCheckpoint()        (unchanged)
 *   - evaluating settlement:     evaluateProtectionSettlement() (unchanged)
 *   - obtaining real data:       getRealTrustSnapshot()         (unchanged)
 * This file adds NO liquidity, Pyth-deviation, wrapper-deviation, Safety
 * Gate, or trust-continuity logic of its own — see missedCheckpoint.ts for
 * how even the one new concept here (a missed checkpoint) is implemented
 * by reusing the EXISTING "FAIL breaks trust" rule rather than inventing a
 * new one.
 *
 * Does NOT create sessions and does NOT look sessions up from a store —
 * both are the caller's job (see src/app/api/dev/protection-monitor/route.ts).
 * This keeps the runner a pure function over an already-fetched session,
 * directly satisfying Task 6: "the monitoring runner [should] fail safely
 * if a session is missing" and "do not create a new session automatically"
 * — there is no code path here that could do either, by construction.
 */

export type MonitoringActionType =
  | "RECORDED_CHECKPOINT"
  | "RECORDED_MISSED_CHECKPOINT"
  | "ALREADY_RECORDED_SKIPPED"
  | "NOT_YET_DUE"
  | "EVALUATED_SETTLEMENT"
  | "NO_ACTION"
  | "SNAPSHOT_UNAVAILABLE";

export interface MonitoringAction {
  type: MonitoringActionType;
  checkpoint?: string;
  detail: string;
}

export interface RunProtectionMonitoringParams {
  session: ProtectionMonitoringSession;
  /** Ordered saturday/sunday/monday entries — see monitoringSchedule.ts. Must be chronologically ordered by `dueAt`. */
  schedule: MonitoringSchedule;
  /** Injectable "current time" (ms epoch) — simulation-friendly, never reads the real clock itself. */
  now: number;
  /** Reused, unmodified from trustSnapshot.ts — pass the real assessTickerViaBinanceRwa for live monitoring, or a mocked fetcher for simulating failure scenarios. */
  fetchAssessments: FetchAssessmentsFn;
}

export interface MonitoringRunResult {
  session: ProtectionMonitoringSession;
  /** What this specific invocation actually did, in order — for transparency/testability, not a persisted audit log. */
  actions: MonitoringAction[];
}

/**
 * Advances `session` through as much of `schedule` as is currently due,
 * starting from `now`. Safe to call repeatedly with the same or advancing
 * `now` (idempotent per checkpoint — see duplicate-prevention below).
 *
 * Processing rule per schedule entry, in chronological order:
 *   1. Already recorded for this checkpoint label? -> skip (duplicate
 *      prevention: the existing TrustCheckpointLabel on each TrustSnapshot
 *      already in `session.checkpoints` is the identifier used — no new
 *      id system needed, since one session has at most one checkpoint per
 *      label in this model).
 *   2. Not yet due (`now < dueAt`)? -> stop entirely; the schedule is
 *      chronological, so nothing later can be due either.
 *   3. Due, AND the NEXT scheduled entry's time has ALSO already passed?
 *      -> this entry was MISSED (its window closed before it was ever
 *      captured) -> record the explicit synthetic missed-checkpoint
 *      snapshot (missedCheckpoint.ts) and continue to the next entry in
 *      the SAME run, so multiple missed checkpoints can cascade through
 *      in one invocation.
 *   4. Otherwise, due and not missed -> fetch a real snapshot via
 *      getRealTrustSnapshot() and record it. If none could be obtained,
 *      stop here (try again on a later run) rather than guessing.
 *   5. If the recorded entry is the final one, evaluate settlement.
 */
export async function runProtectionMonitoring(
  params: RunProtectionMonitoringParams
): Promise<MonitoringRunResult> {
  if (params.session.status !== "ACTIVE") {
    return {
      session: params.session,
      actions: [
        {
          type: "NO_ACTION",
          detail: `Session status is ${params.session.status}, not ACTIVE — there is nothing to monitor.`,
        },
      ],
    };
  }

  let session = params.session;
  const actions: MonitoringAction[] = [];

  for (let i = 0; i < params.schedule.length; i++) {
    const entry = params.schedule[i];
    const alreadyRecorded = session.checkpoints.some((c) => c.checkpoint === entry.checkpoint);

    if (alreadyRecorded) {
      actions.push({
        type: "ALREADY_RECORDED_SKIPPED",
        checkpoint: entry.checkpoint,
        detail: `${entry.checkpoint} was already recorded for this session — skipped to prevent a duplicate.`,
      });
      continue;
    }

    if (params.now < entry.dueAt) {
      actions.push({
        type: "NOT_YET_DUE",
        checkpoint: entry.checkpoint,
        detail: `${entry.checkpoint} is not due yet (due at ${new Date(entry.dueAt).toISOString()}).`,
      });
      break;
    }

    const nextEntry = params.schedule[i + 1];
    const wasMissed = nextEntry !== undefined && params.now >= nextEntry.dueAt;

    if (wasMissed) {
      const missedSnapshot = buildMissedCheckpointSnapshot(entry.checkpoint, entry.dueAt, session.underlying);
      session = recordTrustCheckpoint(session, missedSnapshot);
      actions.push({
        type: "RECORDED_MISSED_CHECKPOINT",
        checkpoint: entry.checkpoint,
        detail: `${entry.checkpoint}'s window passed before it was ever captured — recorded as an explicit missed (trust-breaking) checkpoint rather than silently skipped.`,
      });
      if (entry.isFinal) {
        session = evaluateProtectionSettlement(session);
        actions.push({
          type: "EVALUATED_SETTLEMENT",
          checkpoint: entry.checkpoint,
          detail: `Missed final checkpoint still triggers settlement evaluation: ${session.settlement?.outcome ?? "unresolved"}.`,
        });
      }
      continue;
    }

    const { snapshot, warnings } = await getRealTrustSnapshot(
      session.underlying,
      session.wrapper,
      entry.checkpoint,
      params.fetchAssessments,
      params.now
    );

    if (!snapshot) {
      actions.push({
        type: "SNAPSHOT_UNAVAILABLE",
        checkpoint: entry.checkpoint,
        detail: `Could not obtain a trust snapshot for ${entry.checkpoint} right now: ${warnings.join(" ") || "no snapshot returned"}.`,
      });
      break; // don't guess — leave this checkpoint pending and try again on a later run
    }

    session = recordTrustCheckpoint(session, snapshot);
    actions.push({
      type: "RECORDED_CHECKPOINT",
      checkpoint: entry.checkpoint,
      detail: `${entry.checkpoint} checkpoint recorded (Safety Gate: ${snapshot.safetyGateResult.status}).`,
    });

    if (entry.isFinal) {
      session = evaluateProtectionSettlement(session);
      actions.push({
        type: "EVALUATED_SETTLEMENT",
        checkpoint: entry.checkpoint,
        detail: `Final checkpoint recorded — settlement evaluated: ${session.settlement?.outcome ?? "unresolved"}.`,
      });
    }
  }

  if (actions.length === 0) {
    actions.push({ type: "NO_ACTION", detail: "Nothing to do — the schedule is empty." });
  }

  return { session, actions };
}
