import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * SQLite connection for Protection Monitoring Session persistence.
 *
 * STORAGE CHOICE (build brief Task 2): the repo has no existing database
 * dependency, no deployment config (no vercel.json/Dockerfile — this is a
 * hackathon project run via `npm run dev`/`npm start` as a single
 * long-lived Node.js process; both API routes that touch sessions already
 * declare `export const runtime = "nodejs"`, never edge). Given that, a
 * single-file SQLite database via Node's BUILT-IN `node:sqlite` module
 * (stable since Node 22.5+, no new npm dependency at all) is the smallest
 * solution that genuinely survives a process restart:
 *   - no native build step (unlike better-sqlite3 — avoids node-gyp/MSVC
 *     issues on a judge's machine),
 *   - no external service to run/configure (unlike Postgres/Redis),
 *   - no ORM needed for ~2 tables.
 *
 * HONEST LIMITATION: a single SQLite file only works for a SINGLE SERVER
 * PROCESS/INSTANCE with a persistent local filesystem. It would NOT survive
 * or behave correctly on a horizontally-scaled multi-instance deployment,
 * or on a platform with an ephemeral/read-only filesystem (e.g. typical
 * serverless functions) — there is no evidence this project targets either
 * of those, and the brief says not to introduce infrastructure the project
 * doesn't already need. If WeekendGuard is later deployed behind multiple
 * instances or serverless functions, this file is the one place that would
 * need to change (to a real network database) — see the final report's
 * "remaining limitation" section.
 */

function resolveDbPath(): string {
  const configured = process.env.WEEKENDGUARD_DB_PATH;
  if (configured) return configured;
  return resolve(process.cwd(), "data", "weekendguard.sqlite");
}

const dbPath = resolveDbPath();
if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

export const db = new DatabaseSync(dbPath);

// Without this, two processes/connections touching the same file at the
// same moment get an IMMEDIATE "database is locked" error instead of
// waiting — observed for real during this task: Next's production build
// spins up multiple worker PROCESSES that each statically import every API
// route (including this module) to collect its config, so several separate
// DatabaseSync connections can race to CREATE TABLE against the same file
// within milliseconds of each other. A busy timeout makes SQLite retry
// internally for up to 5s before giving up, which is what every other
// SQLite wrapper (e.g. better-sqlite3) defaults to doing — node:sqlite does
// not default to this, so it's set explicitly.
db.exec("PRAGMA busy_timeout = 5000;");

// WAL journal mode lets concurrent requests read while one is writing,
// which matters once this is a real file instead of an in-memory Map.
// (On a ":memory:" database, as used by the test suite, SQLite reports
// journal_mode back as "memory" and ignores the request — harmless.)
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

/**
 * Deterministic, idempotent schema initialization — runs on every process
 * start via plain `CREATE TABLE IF NOT EXISTS`. No separate migration step
 * or CLI command is required to run the app (build brief Task 6).
 *
 * Two tables, mirroring the existing ProtectionMonitoringSession shape
 * (protectionMonitoringSession.ts) as closely as possible rather than
 * inventing a different model:
 *  - protection_sessions: one row per session — the fields that are fixed
 *    at session creation, plus the latest derived status/trustContinuity/
 *    settlement (JSON, since these are nested objects already fully
 *    defined and tested in weekendTrustMonitor.ts — no need to normalize
 *    their internals into more tables).
 *  - protection_checkpoints: one row per (session, checkpoint label).
 *    PRIMARY KEY (sessionId, checkpoint) is the real, DB-enforced
 *    duplicate-prevention + append-only guarantee (build brief Task 4) —
 *    see protectionSessionStore.ts's `INSERT ... ON CONFLICT DO NOTHING`.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS protection_sessions (
    sessionId TEXT PRIMARY KEY,
    underlying TEXT NOT NULL,
    wrapper TEXT NOT NULL,
    startedAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    thresholdPercent REAL NOT NULL,
    fridaySnapshot TEXT NOT NULL,
    status TEXT NOT NULL,
    trustContinuity TEXT NOT NULL,
    settlement TEXT
  )
`);

// Deterministic, idempotent MIGRATION (build brief Task 6 — "add migration/
// initialization safely"): `CREATE TABLE IF NOT EXISTS` above does nothing
// for a database file created before `onChainPolicyId` existed, so the
// column is added explicitly. SQLite has no `ADD COLUMN IF NOT EXISTS`, so
// idempotency is via try/catch rather than a pre-check — a pre-check
// (`PRAGMA table_info` then conditionally ALTER) is itself racy when
// multiple processes start concurrently against the same file (observed
// for real during this task: Next's production build evaluates this module
// from several worker processes at once, and two of them can both see the
// column missing before either commits its ALTER, so the second one's ALTER
// then fails with "duplicate column name"). try/catch is immune to that
// race: whichever process's ALTER commits first wins, and every other
// process's redundant attempt is simply swallowed here.
try {
  db.exec(`ALTER TABLE protection_sessions ADD COLUMN onChainPolicyId TEXT`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes("duplicate column name")) throw err;
}

// Same idempotent-migration pattern as onChainPolicyId above, for the
// settlement-automation task: the generated, signed authorization a session
// is ready to submit on-chain, once computed.
try {
  db.exec(`ALTER TABLE protection_sessions ADD COLUMN settlementAuthorization TEXT`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes("duplicate column name")) throw err;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS protection_checkpoints (
    sessionId TEXT NOT NULL REFERENCES protection_sessions(sessionId),
    checkpoint TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    recordedAt INTEGER NOT NULL,
    PRIMARY KEY (sessionId, checkpoint)
  )
`);
