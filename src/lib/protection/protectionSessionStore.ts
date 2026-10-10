import { db } from "./db.ts";
// Relative import WITH an explicit .ts extension, same established pattern
// as protectionMonitoringSession.ts/protectionMonitoringRunner.ts — this is
// a genuine VALUE-level dependency (evaluateTrustContinuity is a real
// function call below, not just a type), so it has to stay resolvable by
// both Next's bundler and Node's `--experimental-strip-types` test runner.
import { evaluateTrustContinuity } from "./weekendTrustMonitor.ts";
import type { TrustSnapshot } from "./weekendTrustMonitor.ts";
import type { ProtectionMonitoringSession, ProtectionMonitoringStatus } from "./protectionMonitoringSession.ts";
import type { Wrapper } from "@/lib/types";

/**
 * SQLite-backed persistence for Protection Monitoring Sessions (build brief
 * Task 2/3) — replaces the previous in-memory `Map`, which lost every
 * session on restart. See db.ts for the storage-choice rationale.
 *
 * The exported interface is UNCHANGED from the in-memory version on
 * purpose (build brief Task 3: "preserve the existing session interface"):
 *   saveSession(session): void
 *   getSession(sessionId): ProtectionMonitoringSession | undefined
 *   listSessions(): ProtectionMonitoringSession[]
 * All three are still plain synchronous calls — `node:sqlite`'s
 * `DatabaseSync` API is synchronous, so no caller anywhere in the app
 * (protectionMonitoringRunner.ts, the two /api/dev/* routes) needed to
 * change to `await` these. protectionMonitoringSession.ts and
 * protectionMonitoringRunner.ts are untouched: this file is the only thing
 * that changed to add persistence.
 *
 * WRITE SAFETY (build brief Task 4): `saveSession()` never blindly trusts
 * the caller's in-memory session object for the parts that matter under
 * concurrency:
 *  - Each checkpoint is written with `INSERT ... ON CONFLICT(sessionId,
 *    checkpoint) DO NOTHING` against a PRIMARY KEY(sessionId, checkpoint) —
 *    a real, DB-enforced constraint. If two concurrent callers ("Runner A"
 *    and "Runner B" in the brief's own example) both try to record Sunday,
 *    only the first write to actually commit wins; the second is silently
 *    a no-op for that row, not a duplicate and not a crash. Checkpoint rows
 *    are only ever INSERTed, never UPDATEd/DELETEd, so history is
 *    append-only by construction.
 *  - `trustContinuity` is always RECOMPUTED from the checkpoints actually
 *    persisted in the DB after the insert above (not from the caller's
 *    possibly-stale pre-write view), using the existing, unmodified
 *    `evaluateTrustContinuity()`. That function already guarantees "a later
 *    PASS never erases an earlier break" (see its own tests in
 *    weekendTrustMonitor.test.mts) — reusing it here means a lost-update
 *    race can never leave a session's cached continuity disagreeing with
 *    its own persisted checkpoint history.
 *  - `status`/`settlement` are written with a sticky-terminal-state guard
 *    (`WHERE status != 'SETTLED'`): once a session is SETTLED, no later
 *    write — racing or otherwise — can downgrade it back to ACTIVE or
 *    change its settlement. Since settlement is a pure function of
 *    (trustContinuity, mondaySnapshot, thresholdCrossed) via the existing
 *    `decideSettlement()`, any two callers computing it from the same
 *    (now-authoritative) checkpoint history would arrive at the identical
 *    value anyway — this guard protects against the ORDERING of two
 *    concurrent writes, not a logic disagreement.
 *  - The whole write is one SQLite transaction (BEGIN/COMMIT/ROLLBACK), so
 *    a session is never left half-updated if something throws mid-write.
 */

interface SessionRow {
  sessionId: string;
  underlying: string;
  wrapper: string;
  startedAt: number;
  expiresAt: number;
  thresholdPercent: number;
  fridaySnapshot: string;
  status: string;
  trustContinuity: string;
  settlement: string | null;
  onChainPolicyId: string | null;
  settlementAuthorization: string | null;
}

interface CheckpointRow {
  sessionId: string;
  checkpoint: string;
  snapshot: string;
  recordedAt: number;
}

const insertSessionIfNewStmt = db.prepare(`
  INSERT INTO protection_sessions
    (sessionId, underlying, wrapper, startedAt, expiresAt, thresholdPercent, fridaySnapshot, status, trustContinuity, settlement)
  VALUES
    (@sessionId, @underlying, @wrapper, @startedAt, @expiresAt, @thresholdPercent, @fridaySnapshot, @status, @trustContinuity, @settlement)
  ON CONFLICT(sessionId) DO NOTHING
`);
// Safe as INSERT-OR-IGNORE only because these fields never change after
// session creation anywhere in protectionMonitoringSession.ts
// (recordTrustCheckpoint/evaluateProtectionSettlement both spread `...session`
// and only ever touch checkpoints/trustContinuity/status/settlement) — see
// protectionMonitoringSession.ts for confirmation. If that ever changes,
// this statement would need to become a real upsert for these columns too.

const insertCheckpointStmt = db.prepare(`
  INSERT INTO protection_checkpoints (sessionId, checkpoint, snapshot, recordedAt)
  VALUES (@sessionId, @checkpoint, @snapshot, @recordedAt)
  ON CONFLICT(sessionId, checkpoint) DO NOTHING
`);

const updateDerivedFieldsStmt = db.prepare(`
  UPDATE protection_sessions
  SET
    trustContinuity = @trustContinuity,
    status = CASE WHEN status = 'SETTLED' THEN status ELSE @status END,
    settlement = CASE WHEN status = 'SETTLED' THEN settlement ELSE @settlement END,
    onChainPolicyId = COALESCE(@onChainPolicyId, onChainPolicyId),
    settlementAuthorization = COALESCE(settlementAuthorization, @settlementAuthorization)
  WHERE sessionId = @sessionId
`);

const getSessionRowStmt = db.prepare(`SELECT * FROM protection_sessions WHERE sessionId = ?`);
const listSessionRowsStmt = db.prepare(`SELECT * FROM protection_sessions`);
const getCheckpointRowsStmt = db.prepare(
  `SELECT * FROM protection_checkpoints WHERE sessionId = ? ORDER BY recordedAt ASC`
);

function readCheckpoints(sessionId: string): TrustSnapshot[] {
  const rows = getCheckpointRowsStmt.all(sessionId) as unknown as CheckpointRow[];
  return rows.map((row) => JSON.parse(row.snapshot) as TrustSnapshot);
}

function rowToSession(row: SessionRow, checkpoints: TrustSnapshot[]): ProtectionMonitoringSession {
  return {
    sessionId: row.sessionId,
    underlying: row.underlying,
    wrapper: row.wrapper as Wrapper,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    thresholdPercent: row.thresholdPercent,
    fridaySnapshot: JSON.parse(row.fridaySnapshot) as TrustSnapshot,
    checkpoints,
    trustContinuity: JSON.parse(row.trustContinuity),
    status: row.status as ProtectionMonitoringStatus,
    settlement: row.settlement ? JSON.parse(row.settlement) : undefined,
    onChainPolicyId: row.onChainPolicyId ?? undefined,
    settlementAuthorization: row.settlementAuthorization ? JSON.parse(row.settlementAuthorization) : undefined,
  };
}

export function saveSession(session: ProtectionMonitoringSession): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    insertSessionIfNewStmt.run({
      sessionId: session.sessionId,
      underlying: session.underlying,
      wrapper: session.wrapper,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      thresholdPercent: session.thresholdPercent,
      fridaySnapshot: JSON.stringify(session.fridaySnapshot),
      status: session.status,
      trustContinuity: JSON.stringify(session.trustContinuity),
      settlement: session.settlement ? JSON.stringify(session.settlement) : null,
    });
    // onChainPolicyId is intentionally NOT part of the initial insert above
    // (it starts NULL for every new row, via the column's default) — it is
    // set below, by updateDerivedFieldsStmt's COALESCE, on every save.

    for (const checkpoint of session.checkpoints) {
      insertCheckpointStmt.run({
        sessionId: session.sessionId,
        checkpoint: checkpoint.checkpoint,
        snapshot: JSON.stringify(checkpoint),
        recordedAt: checkpoint.timestamp,
      });
    }

    const mergedCheckpoints = readCheckpoints(session.sessionId);
    const trustContinuity = evaluateTrustContinuity(mergedCheckpoints);

    updateDerivedFieldsStmt.run({
      sessionId: session.sessionId,
      trustContinuity: JSON.stringify(trustContinuity),
      status: session.status,
      settlement: session.settlement ? JSON.stringify(session.settlement) : null,
      onChainPolicyId: session.onChainPolicyId ?? null,
      settlementAuthorization: session.settlementAuthorization ? JSON.stringify(session.settlementAuthorization) : null,
    });

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getSession(sessionId: string): ProtectionMonitoringSession | undefined {
  const row = getSessionRowStmt.get(sessionId) as unknown as SessionRow | undefined;
  if (!row) return undefined;
  return rowToSession(row, readCheckpoints(sessionId));
}

export function listSessions(): ProtectionMonitoringSession[] {
  const rows = listSessionRowsStmt.all() as unknown as SessionRow[];
  return rows.map((row) => rowToSession(row, readCheckpoints(row.sessionId)));
}
