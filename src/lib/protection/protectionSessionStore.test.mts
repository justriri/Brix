import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getSession, saveSession } from "./protectionSessionStore.ts";
import {
  attachSettlementAuthorization,
  evaluateProtectionSettlement,
  linkOnChainPolicy,
  recordTrustCheckpoint,
  startProtectionSession,
} from "./protectionMonitoringSession.ts";
import { runProtectionMonitoring } from "./protectionMonitoringRunner.ts";
import { buildDefaultWeekendSchedule } from "./monitoringSchedule.ts";
import type { TrustCheckpointLabel, TrustSnapshot } from "./weekendTrustMonitor.ts";
import type { AssessmentLike, FetchAssessmentsFn } from "./trustSnapshot.ts";
import type { CheckResult, SafetyGateResult, SafetyGateStatus, Wrapper } from "@/lib/types";

/**
 * Persistence tests for the SQLite-backed Protection Monitoring Session
 * store (build brief Task 7/8). Runs against an in-memory SQLite database
 * (see .env.test -> WEEKENDGUARD_DB_PATH=:memory:), so these tests never
 * touch a real file and leave nothing behind — but exercise the EXACT same
 * SQL (schema, UNIQUE constraints, upsert logic) that the real
 * file-backed store uses, since db.ts's only difference for ":memory:" is
 * the location string passed to DatabaseSync.
 *
 * Fixture helpers below intentionally mirror the pattern already used by
 * ProtectionSessionDemo.tsx / the /api/dev/protection-* routes: a minimal
 * hand-built SafetyGateResult, not a real Safety Gate run.
 */

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "test data" };
}

function gateResult(status: SafetyGateStatus, wrapper: Wrapper, referencePrice?: number): SafetyGateResult {
  const hardPass = status !== "FAIL";
  return {
    status,
    underlying: "TSLA",
    wrapper,
    checks: {
      liquidity: check(hardPass),
      priceFreshness: check(hardPass),
      referenceDeviation: check(hardPass),
      marketStatus: check(hardPass),
      crossWrapperConsistency: check(status === "PASS" ? true : status === "WARNING" ? false : true),
    },
    primaryReference:
      referencePrice !== undefined
        ? { name: "Pyth Equity.US.TSLA/USD", price: referencePrice, publishTimeSec: 1700000000 }
        : undefined,
    reasons: status === "PASS" ? ["All checks passed."] : [`Simulated status: ${status}.`],
    timestamp: 0,
  };
}

function snap(
  checkpoint: TrustCheckpointLabel,
  status: SafetyGateStatus,
  timestamp: number,
  wrapper: Wrapper = "bstocks",
  referencePrice?: number
): TrustSnapshot {
  return { checkpoint, timestamp, safetyGateResult: gateResult(status, wrapper, referencePrice) };
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

test("create a session, then retrieve it — same session exists", () => {
  const id = uniqueId("create");
  const session = startProtectionSession({
    sessionId: id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999999,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", "PASS", 1000, "bstocks", 355),
  });
  saveSession(session);

  const retrieved = getSession(id);
  assert.ok(retrieved);
  assert.equal(retrieved.sessionId, id);
  assert.equal(retrieved.status, "ACTIVE");
  assert.equal(retrieved.thresholdPercent, 5);
  assert.equal(retrieved.fridaySnapshot.safetyGateResult.primaryReference?.price, 355);
});

test("checkpoint history round-trips through persistence in full", () => {
  const id = uniqueId("checkpoints");
  let session = startProtectionSession({
    sessionId: id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999999,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", "PASS", 1000),
  });
  saveSession(session);

  session = recordTrustCheckpoint(session, snap("saturday", "PASS", 2000));
  saveSession(session);
  session = recordTrustCheckpoint(session, snap("sunday", "PASS", 3000));
  saveSession(session);

  const retrieved = getSession(id);
  assert.ok(retrieved);
  assert.equal(retrieved.checkpoints.length, 2);
  assert.deepEqual(
    retrieved.checkpoints.map((c) => c.checkpoint),
    ["saturday", "sunday"]
  );
});

test("a trust failure persists: Sunday FAIL survives a later Monday PASS, settlement is blocked", () => {
  const id = uniqueId("trust-failure");
  let session = startProtectionSession({
    sessionId: id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999999,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", "PASS", 1000, "bstocks", 355),
  });
  saveSession(session);

  session = recordTrustCheckpoint(session, snap("saturday", "PASS", 2000));
  saveSession(session);
  session = recordTrustCheckpoint(session, snap("sunday", "FAIL", 3000));
  saveSession(session);
  session = recordTrustCheckpoint(session, snap("monday", "PASS", 4000, "bstocks", 330));
  session = evaluateProtectionSettlement(session);
  saveSession(session);

  const retrieved = getSession(id);
  assert.ok(retrieved);
  assert.equal(retrieved.trustContinuity.status, "TRUST_BROKEN");
  assert.equal(retrieved.trustContinuity.brokenAt, "sunday");
  assert.equal(retrieved.status, "SETTLED");
  assert.equal(retrieved.settlement?.outcome, "SETTLEMENT_BLOCKED");
});

test("attempting to record the same checkpoint twice leaves only one row — enforced by the DB, not just app logic", () => {
  const id = uniqueId("duplicate");
  const base = startProtectionSession({
    sessionId: id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999999,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", "PASS", 1000),
  });
  saveSession(base);

  // Simulate two racing writers that both read the session before either
  // had written back, each independently appending their OWN "sunday"
  // checkpoint (different content) — the build brief's own example
  // ("Runner A records Sunday, Runner B records Sunday"). Neither writer
  // saw the other's write, so a naive last-write-wins store would end up
  // with whichever was saved last. The real guarantee under test is the
  // DB's PRIMARY KEY(sessionId, checkpoint) + `ON CONFLICT DO NOTHING`:
  // only the FIRST save's "sunday" row should ever exist afterward.
  const racerA = { ...base, checkpoints: [snap("sunday", "PASS", 5000, "bstocks", 300)] };
  const racerB = { ...base, checkpoints: [snap("sunday", "FAIL", 5000)] };

  saveSession(racerA);
  saveSession(racerB);

  const retrieved = getSession(id);
  assert.ok(retrieved);
  const sundayCheckpoints = retrieved.checkpoints.filter((c) => c.checkpoint === "sunday");
  assert.equal(sundayCheckpoints.length, 1, "exactly one sunday checkpoint must exist, never two");
  assert.equal(
    sundayCheckpoints[0].safetyGateResult.status,
    "PASS",
    "the first writer (racerA) must be the one whose data won"
  );
});

test("settlement outcomes persist correctly: SETTLEMENT_ELIGIBLE", () => {
  const id = uniqueId("eligible");
  let session = startProtectionSession({
    sessionId: id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999999,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", "PASS", 1000, "bstocks", 355),
  });
  session = recordTrustCheckpoint(session, snap("saturday", "PASS", 2000));
  session = recordTrustCheckpoint(session, snap("sunday", "PASS", 3000));
  session = recordTrustCheckpoint(session, snap("monday", "PASS", 4000, "bstocks", 330));
  session = evaluateProtectionSettlement(session);
  saveSession(session);

  assert.equal(getSession(id)?.settlement?.outcome, "SETTLEMENT_ELIGIBLE");
});

test("settlement outcomes persist correctly: NO_PAYOUT", () => {
  const id = uniqueId("nopayout");
  let session = startProtectionSession({
    sessionId: id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999999,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", "PASS", 1000, "bstocks", 355),
  });
  session = recordTrustCheckpoint(session, snap("saturday", "PASS", 2000));
  session = recordTrustCheckpoint(session, snap("sunday", "PASS", 3000));
  session = recordTrustCheckpoint(session, snap("monday", "PASS", 4000, "bstocks", 352));
  session = evaluateProtectionSettlement(session);
  saveSession(session);

  assert.equal(getSession(id)?.settlement?.outcome, "NO_PAYOUT");
});

test("settlement outcomes persist correctly: SETTLEMENT_BLOCKED (broken trust)", () => {
  const id = uniqueId("blocked");
  let session = startProtectionSession({
    sessionId: id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999999,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", "PASS", 1000, "bstocks", 355),
  });
  session = recordTrustCheckpoint(session, snap("saturday", "FAIL", 2000));
  session = recordTrustCheckpoint(session, snap("sunday", "PASS", 3000));
  session = recordTrustCheckpoint(session, snap("monday", "PASS", 4000, "bstocks", 330));
  session = evaluateProtectionSettlement(session);
  saveSession(session);

  assert.equal(getSession(id)?.settlement?.outcome, "SETTLEMENT_BLOCKED");
});

test("a nonexistent session returns undefined — never auto-recreated", () => {
  assert.equal(getSession("this-session-id-was-never-created"), undefined);
});

test("onChainPolicyId survives a save/retrieve round trip, and is not erased by a later save that doesn't set it", () => {
  const id = uniqueId("onchain-link");
  const session = startProtectionSession({
    sessionId: id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999999,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", "PASS", 1000),
  });
  saveSession(session);
  assert.equal(getSession(id)?.onChainPolicyId, undefined);

  saveSession(linkOnChainPolicy(session, "123"));
  assert.equal(getSession(id)?.onChainPolicyId, "123");

  // Simulates a caller that read the session BEFORE the link was attached
  // (e.g. a concurrently-running scheduler tick) computing its own next
  // state from that stale, unlinked in-memory object and saving it back —
  // `session` here deliberately has no onChainPolicyId, unlike `reloaded`
  // would. This must not erase the link already persisted above.
  const withCheckpoint = recordTrustCheckpoint(session, snap("saturday", "PASS", 2000));
  assert.equal(withCheckpoint.onChainPolicyId, undefined, "sanity: this caller's own object really has no link");
  saveSession(withCheckpoint);
  assert.equal(getSession(id)?.onChainPolicyId, "123", "linking a policy must survive a save from a caller that doesn't know about it");
});

test("settlementAuthorization survives a save/retrieve round trip, and is sticky — a later save can never change or erase an already-persisted one", () => {
  const id = uniqueId("auth-persist");
  const session = startProtectionSession({
    sessionId: id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 999999,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", "PASS", 1000),
  });
  saveSession(session);
  assert.equal(getSession(id)?.settlementAuthorization, undefined);

  const auth = {
    domain: { name: "WeekendGuardSettlement" as const, version: "1" as const, chainId: 56, verifyingContract: "0xaaaa000000000000000000000000000000aaaa" as const },
    authorization: {
      policyId: "1",
      eligible: true,
      finalReferencePrice: "37629000000",
      settlementTimestamp: "1700000000",
      authorizationExpiry: "1700003600",
      nonce: "1700000000000",
    },
    signature: "0xdeadbeef" as const,
    settlementOutcome: "SETTLEMENT_ELIGIBLE",
    generatedAt: 1700000000000,
  };
  saveSession(attachSettlementAuthorization(session, auth));
  assert.deepEqual(getSession(id)?.settlementAuthorization, auth);

  // A later save from a caller that never saw the authorization (same
  // staleness scenario as the onChainPolicyId test above) must not erase
  // it, and a save that tries to attach a DIFFERENT authorization must not
  // overwrite the first one either — once signed, it's immutable.
  const differentAuth = { ...auth, signature: "0x99999999" as const };
  saveSession(attachSettlementAuthorization(session, differentAuth));
  assert.deepEqual(getSession(id)?.settlementAuthorization, auth, "the FIRST persisted authorization must win, never silently replaced");
});

test("restart simulation: a session saved by one process is readable by a brand-new process pointed at the same DB file", () => {
  // :memory: (used by every other test in this file) cannot demonstrate
  // this — it has no backing file and vanishes with the connection. This
  // test instead spawns two SEPARATE node processes against a real
  // temp-file database: the second process shares no JS memory at all
  // with the first, so this is a genuine process-restart, not an
  // in-process simulation of one.
  const dir = mkdtempSync(join(tmpdir(), "weekendguard-restart-"));
  const dbPath = join(dir, "restart-test.sqlite");
  const here = dirname(fileURLToPath(import.meta.url));
  const sessionModuleUrl = pathToFileURL(join(here, "protectionMonitoringSession.ts")).href;
  const storeModuleUrl = pathToFileURL(join(here, "protectionSessionStore.ts")).href;

  try {
    const writerScript = `
      const { startProtectionSession } = await import(${JSON.stringify(sessionModuleUrl)});
      const { saveSession } = await import(${JSON.stringify(storeModuleUrl)});
      const snapshot = {
        checkpoint: "friday",
        timestamp: 1000,
        safetyGateResult: {
          status: "PASS", underlying: "TSLA", wrapper: "bstocks",
          checks: {}, reasons: ["ok"], timestamp: 0,
          primaryReference: { name: "Pyth Equity.US.TSLA/USD", price: 355, publishTimeSec: 1700000000 },
        },
      };
      const session = startProtectionSession({
        sessionId: "restart-sim-session", underlying: "TSLA", wrapper: "bstocks",
        expiresAt: 999999, thresholdPercent: 5, fridaySnapshot: snapshot,
      });
      saveSession(session);
    `;
    execFileSync("node", ["--experimental-strip-types", "--input-type=module", "-e", writerScript], {
      env: { ...process.env, WEEKENDGUARD_DB_PATH: dbPath },
    });

    const readerScript = `
      const { getSession } = await import(${JSON.stringify(storeModuleUrl)});
      const session = getSession("restart-sim-session");
      process.stdout.write(JSON.stringify(session ?? null));
    `;
    const output = execFileSync("node", ["--experimental-strip-types", "--input-type=module", "-e", readerScript], {
      env: { ...process.env, WEEKENDGUARD_DB_PATH: dbPath },
      encoding: "utf8",
    });

    const session = JSON.parse(output);
    assert.ok(session, "session must survive being read by a completely separate process");
    assert.equal(session.sessionId, "restart-sim-session");
    assert.equal(session.status, "ACTIVE");
    assert.equal(session.fridaySnapshot.safetyGateResult.primaryReference.price, 355);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function mockedFetcher(wrapper: Wrapper, status: SafetyGateStatus, referencePrice?: number): FetchAssessmentsFn {
  const result: AssessmentLike = { stock: { wrapper }, safetyGateResult: gateResult(status, wrapper, referencePrice) };
  return async () => ({ assessments: [result], warnings: [] });
}

test("Task 8: the existing runner produces the same result when every step is persisted and re-read from the store, like separate API requests", async () => {
  const id = uniqueId("runner-persisted");
  const fridayAt = 1_000_000;

  const session = startProtectionSession({
    sessionId: id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: fridayAt + 10 * 24 * 60 * 60 * 1000,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", "PASS", fridayAt, "bstocks", 355),
  });
  saveSession(session); // "request 1": start

  const schedule = buildDefaultWeekendSchedule(fridayAt);

  for (const entry of schedule) {
    const reloaded = getSession(id); // "request N": a brand-new handler re-reads from the store
    assert.ok(reloaded);
    const fetchAssessments =
      entry.checkpoint === "monday" ? mockedFetcher("bstocks", "PASS", 330) : mockedFetcher("bstocks", "PASS");
    const result = await runProtectionMonitoring({
      session: reloaded,
      schedule,
      now: entry.dueAt,
      fetchAssessments,
    });
    saveSession(result.session); // persisted before the "next request" begins
  }

  const final = getSession(id);
  assert.ok(final);
  assert.equal(final.status, "SETTLED");
  assert.equal(final.checkpoints.length, 3);
  assert.equal(final.trustContinuity.status, "TRUST_INTACT");
  assert.equal(final.settlement?.outcome, "SETTLEMENT_ELIGIBLE");
});
