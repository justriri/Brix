import { test } from "node:test";
import assert from "node:assert/strict";

import { runDueProtectionCheckpoints } from "./protectionScheduler.ts";
import { getSession, saveSession } from "./protectionSessionStore.ts";
import {
  evaluateProtectionSettlement,
  recordTrustCheckpoint,
  startProtectionSession,
} from "./protectionMonitoringSession.ts";
import { buildDefaultWeekendSchedule } from "./monitoringSchedule.ts";
import type { TrustCheckpointLabel, TrustSnapshot } from "./weekendTrustMonitor.ts";
import type { AssessmentLike, FetchAssessmentsFn } from "./trustSnapshot.ts";
import type { CheckResult, SafetyGateResult, SafetyGateStatus, Wrapper } from "@/lib/types";

/**
 * Scheduler tests (build brief Task 15). Runs against the same in-memory
 * SQLite database as protectionSessionStore.test.mts (.env.test ->
 * WEEKENDGUARD_DB_PATH=:memory:) — this is what lets "restart"-style tests
 * genuinely exercise listSessions()/saveSession() rather than any
 * in-process session list, since the scheduler itself keeps none.
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

/** A fetcher that always returns the same fixed status for whatever wrapper is asked about — ignores the ticker, used where only one session is in play. */
function fixedFetcher(status: SafetyGateStatus, referencePrice?: number): FetchAssessmentsFn {
  return async (ticker: string) => {
    const wrapper: Wrapper = "bstocks";
    const result: AssessmentLike = { stock: { wrapper }, safetyGateResult: gateResult(status, wrapper, referencePrice) };
    void ticker;
    return { assessments: [result], warnings: [] };
  };
}

const FRIDAY = 1_000_000;

function startSession(id: string, fridayStatus: SafetyGateStatus = "PASS", referencePrice = 355, underlying = "TSLA") {
  const session = startProtectionSession({
    sessionId: id,
    underlying,
    wrapper: "bstocks",
    expiresAt: FRIDAY + 10 * 24 * 60 * 60 * 1000,
    thresholdPercent: 5,
    fridaySnapshot: snap("friday", fridayStatus, FRIDAY, "bstocks", referencePrice),
  });
  saveSession(session);
  return session;
}

// NOTE ON ISOLATION: every test in this file shares ONE in-memory SQLite
// database for the whole file's process (see protectionSessionStore.test.mts
// for why: ":memory:" is scoped to the DB connection, not to each `test()`).
// Earlier tests' sessions stay ACTIVE and are legitimately still part of
// what "all active sessions in the store" means to a later test's scheduler
// call — that's realistic (a real deployment has many concurrent sessions
// too), so assertions below always look up a specific session's OWN result
// (`summary.results.find/byId`) rather than the run's aggregate counts,
// which reflect every active session in the shared DB, not just one test's.

test("basic scheduling: Saturday due -> the scheduler runs it", async () => {
  const id = uniqueId("basic");
  startSession(id);
  const schedule = buildDefaultWeekendSchedule(FRIDAY);

  const summary = await runDueProtectionCheckpoints({ now: schedule[0].dueAt, fetchAssessments: fixedFetcher("PASS") });

  assert.equal(summary.results.find((r) => r.sessionId === id)?.outcome, "processed");
  const persisted = getSession(id);
  assert.equal(persisted?.checkpoints.length, 1);
  assert.equal(persisted?.checkpoints[0].checkpoint, "saturday");
});

test("not due: Saturday not yet due -> nothing runs", async () => {
  const id = uniqueId("notdue");
  startSession(id);
  const schedule = buildDefaultWeekendSchedule(FRIDAY);

  const summary = await runDueProtectionCheckpoints({
    now: schedule[0].dueAt - 1,
    fetchAssessments: fixedFetcher("PASS"),
  });

  assert.equal(summary.results.find((r) => r.sessionId === id)?.outcome, "skipped");
  assert.equal(getSession(id)?.checkpoints.length, 0);
});

test("already processed: Saturday already persisted -> the scheduler skips it, does not duplicate", async () => {
  const id = uniqueId("alreadydone");
  startSession(id);
  const schedule = buildDefaultWeekendSchedule(FRIDAY);

  await runDueProtectionCheckpoints({ now: schedule[0].dueAt, fetchAssessments: fixedFetcher("PASS") });
  const summary = await runDueProtectionCheckpoints({ now: schedule[0].dueAt, fetchAssessments: fixedFetcher("PASS") });

  assert.equal(summary.results.find((r) => r.sessionId === id)?.outcome, "skipped");
  assert.equal(getSession(id)?.checkpoints.length, 1, "still exactly one checkpoint, not two");
});

test("missed checkpoints: Monday due now, Saturday and Sunday were never captured -> both recorded as missed via existing logic", async () => {
  const id = uniqueId("missed");
  startSession(id);
  const schedule = buildDefaultWeekendSchedule(FRIDAY);

  const summary = await runDueProtectionCheckpoints({ now: schedule[2].dueAt, fetchAssessments: fixedFetcher("PASS", 330) });

  assert.equal(summary.results.find((r) => r.sessionId === id)?.outcome, "processed");
  const persisted = getSession(id);
  assert.equal(persisted?.checkpoints.length, 3);
  assert.deepEqual(
    persisted?.checkpoints.map((c) => c.safetyGateResult.status),
    ["FAIL", "FAIL", "PASS"],
    "saturday and sunday missed (synthetic FAIL), monday real and PASS"
  );
  assert.equal(persisted?.trustContinuity.status, "TRUST_BROKEN");
  assert.equal(persisted?.trustContinuity.brokenAt, "saturday");
  assert.equal(persisted?.status, "SETTLED");
  assert.equal(persisted?.settlement?.outcome, "SETTLEMENT_BLOCKED", "trust broken blocks settlement even though Monday itself passed");
});

test("restart: a session persisted independently is discovered by a fresh scheduler call with no prior in-memory state", async () => {
  const id = uniqueId("restart");
  // Simulates "the process restarted": this session was never touched by
  // any scheduler call in this test — only saveSession() was ever called
  // for it, exactly as if a previous (now-dead) process had done that and
  // exited. The scheduler itself keeps no session list between calls (see
  // protectionScheduler.ts), so there is nothing to "warm up" here.
  startSession(id);
  const schedule = buildDefaultWeekendSchedule(FRIDAY);

  const summary = await runDueProtectionCheckpoints({ now: schedule[0].dueAt, fetchAssessments: fixedFetcher("PASS") });

  const result = summary.results.find((r) => r.sessionId === id);
  assert.ok(result, "the independently-persisted session must be discovered");
  assert.equal(result.outcome, "processed");
  assert.equal(getSession(id)?.checkpoints[0]?.checkpoint, "saturday");
});

test("duplicate trigger: running the scheduler twice in a row for the same due checkpoint produces one checkpoint, not two", async () => {
  const id = uniqueId("duptrigger");
  startSession(id);
  const schedule = buildDefaultWeekendSchedule(FRIDAY);

  const [first, second] = await Promise.all([
    runDueProtectionCheckpoints({ now: schedule[0].dueAt, fetchAssessments: fixedFetcher("PASS") }),
    runDueProtectionCheckpoints({ now: schedule[0].dueAt, fetchAssessments: fixedFetcher("PASS") }),
  ]);

  void first;
  void second;
  const persisted = getSession(id);
  assert.equal(persisted?.checkpoints.length, 1, "two near-simultaneous triggers must still leave exactly one checkpoint");
  assert.equal(persisted?.checkpoints.filter((c) => c.checkpoint === "saturday").length, 1);
});

test("multiple sessions: the scheduler processes each session according to its own due state", async () => {
  const dueId = uniqueId("multi-due");
  const notDueId = uniqueId("multi-notdue");
  const settledId = uniqueId("multi-settled");

  startSession(dueId);

  const notDueSession = startSession(notDueId);
  const withSaturday = recordTrustCheckpoint(notDueSession, snap("saturday", "PASS", FRIDAY + 1));
  saveSession(withSaturday);

  let settledSession = startSession(settledId);
  settledSession = recordTrustCheckpoint(settledSession, snap("saturday", "PASS", FRIDAY + 1));
  settledSession = recordTrustCheckpoint(settledSession, snap("sunday", "PASS", FRIDAY + 2));
  settledSession = recordTrustCheckpoint(settledSession, snap("monday", "PASS", FRIDAY + 3, "bstocks", 330));
  settledSession = evaluateProtectionSettlement(settledSession);
  saveSession(settledSession);

  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  // Saturday is due for `dueId`; `notDueId` already has Saturday recorded
  // and Sunday is not yet due at this `now`; `settledId` is SETTLED and
  // must not even appear in the results.
  const summary = await runDueProtectionCheckpoints({ now: schedule[0].dueAt, fetchAssessments: fixedFetcher("PASS") });

  const byId = Object.fromEntries(summary.results.map((r) => [r.sessionId, r]));
  assert.equal(byId[dueId].outcome, "processed");
  assert.equal(byId[notDueId].outcome, "skipped");
  assert.equal(byId[settledId], undefined, "a SETTLED session is not part of the scheduler's work at all");
});

test("snapshot failure: one session's fetch throws, another due session is still processed in the SAME run", async () => {
  const failingId = uniqueId("fails");
  const healthyId = uniqueId("healthy");
  startSession(failingId, "PASS", 355, "FAILCO"); // distinct underlying so the fetcher below can fail just this one
  startSession(healthyId, "PASS", 355, "TSLA");

  const fetchAssessments: FetchAssessmentsFn = async (ticker: string) => {
    if (ticker === "FAILCO") {
      throw new Error("simulated upstream outage");
    }
    const wrapper: Wrapper = "bstocks";
    const result: AssessmentLike = { stock: { wrapper }, safetyGateResult: gateResult("PASS", wrapper) };
    return { assessments: [result], warnings: [] };
  };

  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  const summary = await runDueProtectionCheckpoints({ now: schedule[0].dueAt, fetchAssessments });

  const byId = Object.fromEntries(summary.results.map((r) => [r.sessionId, r]));
  assert.equal(byId[failingId].outcome, "failed");
  assert.equal(byId[failingId].error, "simulated upstream outage");
  assert.equal(byId[healthyId].outcome, "processed", "the healthy session must still be processed in the same scheduler run");
  assert.equal(getSession(healthyId)?.checkpoints.length, 1);
  assert.equal(getSession(failingId)?.checkpoints.length, 0, "the failing session must not have a fabricated checkpoint");
});

test("settlement outcomes through the scheduler: SETTLEMENT_ELIGIBLE, NO_PAYOUT, SETTLEMENT_BLOCKED all still work", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);

  const eligibleId = uniqueId("sched-eligible");
  startSession(eligibleId, "PASS", 355);
  for (const entry of schedule) {
    const referencePrice = entry.checkpoint === "monday" ? 330 : undefined;
    await runDueProtectionCheckpoints({ now: entry.dueAt, fetchAssessments: fixedFetcher("PASS", referencePrice) });
  }
  assert.equal(getSession(eligibleId)?.settlement?.outcome, "SETTLEMENT_ELIGIBLE");

  const noPayoutId = uniqueId("sched-nopayout");
  startSession(noPayoutId, "PASS", 355);
  for (const entry of schedule) {
    const referencePrice = entry.checkpoint === "monday" ? 352 : undefined;
    await runDueProtectionCheckpoints({ now: entry.dueAt, fetchAssessments: fixedFetcher("PASS", referencePrice) });
  }
  assert.equal(getSession(noPayoutId)?.settlement?.outcome, "NO_PAYOUT");

  const blockedId = uniqueId("sched-blocked");
  startSession(blockedId, "PASS", 355);
  await runDueProtectionCheckpoints({ now: schedule[0].dueAt, fetchAssessments: fixedFetcher("FAIL") });
  await runDueProtectionCheckpoints({ now: schedule[1].dueAt, fetchAssessments: fixedFetcher("PASS") });
  await runDueProtectionCheckpoints({ now: schedule[2].dueAt, fetchAssessments: fixedFetcher("PASS", 330) });
  assert.equal(getSession(blockedId)?.settlement?.outcome, "SETTLEMENT_BLOCKED");
});
