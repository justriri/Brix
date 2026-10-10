import { test } from "node:test";
import assert from "node:assert/strict";
import { runProtectionMonitoring, type MonitoringAction } from "./protectionMonitoringRunner.ts";
import { startProtectionSession } from "./protectionMonitoringSession.ts";
import { buildDefaultWeekendSchedule, type MonitoringSchedule } from "./monitoringSchedule.ts";
import type { AssessmentLike, FetchAssessmentsFn } from "./trustSnapshot.ts";
import { getSession, saveSession } from "./protectionSessionStore.ts";
import type { CheckResult, SafetyGateResult, SafetyGateStatus } from "@/lib/types";

// Run with: node --experimental-strip-types --test src/lib/protection/*.test.mts

const DAY_MS = 24 * 60 * 60 * 1000;
const FRIDAY = 1_000_000_000_000;

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "fixture" };
}

function gateResult(status: SafetyGateStatus, referencePrice?: number): SafetyGateResult {
  const hardPass = status !== "FAIL";
  return {
    status,
    underlying: "TSLA",
    wrapper: "bstocks",
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
    reasons: status === "PASS" ? ["All checks passed."] : [`Status was ${status}.`],
    timestamp: 0,
  };
}

/** A scripted fetcher: returns a different status/price for each call, in order, regardless of which checkpoint asked for it — mocks the real assessTickerViaBinanceRwa() without any network access. */
function scriptedFetcher(script: Array<{ status: SafetyGateStatus; referencePrice?: number }>): FetchAssessmentsFn {
  let i = 0;
  return async (): Promise<{ assessments: AssessmentLike[]; warnings: string[] }> => {
    const step = script[Math.min(i, script.length - 1)];
    i++;
    return { assessments: [{ stock: { wrapper: "bstocks" }, safetyGateResult: gateResult(step.status, step.referencePrice) }], warnings: [] };
  };
}

function freshActiveSession() {
  return startProtectionSession({
    sessionId: "runner-test",
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: FRIDAY + 3 * DAY_MS,
    thresholdPercent: 5,
    fridaySnapshot: { checkpoint: "friday", timestamp: FRIDAY, safetyGateResult: gateResult("PASS", 355) },
  });
}

function actionsOfType(actions: MonitoringAction[], type: MonitoringAction["type"]) {
  return actions.filter((a) => a.type === type);
}

/**
 * Simulates a scheduler that actually runs ON TIME for each entry — calls
 * runProtectionMonitoring once per schedule entry, with `now` set to that
 * entry's own due time, threading the session through. This is the
 * "nothing was missed" baseline; calling the runner only once, late, at
 * the very end (skipping intermediate due times) is a DIFFERENT, equally
 * real scenario — it correctly produces missed checkpoints, exercised by
 * the dedicated "missed checkpoint" tests below rather than here.
 */
async function runFullScheduleOnTime(
  session: ReturnType<typeof freshActiveSession>,
  schedule: MonitoringSchedule,
  fetchAssessments: FetchAssessmentsFn
) {
  let current = session;
  let lastResult: Awaited<ReturnType<typeof runProtectionMonitoring>> | undefined;
  for (const entry of schedule) {
    lastResult = await runProtectionMonitoring({ session: current, schedule, now: entry.dueAt, fetchAssessments });
    current = lastResult.session;
  }
  return lastResult!;
}

// --- Normal flow ---

test("normal flow: scheduler runs on time for Saturday -> Sunday -> Monday -> settlement", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  const fetcher = scriptedFetcher([
    { status: "PASS" }, // saturday
    { status: "PASS" }, // sunday
    { status: "PASS", referencePrice: 330 }, // monday, ~7% drop
  ]);

  const result = await runFullScheduleOnTime(freshActiveSession(), schedule, fetcher);

  assert.equal(result.session.checkpoints.length, 3);
  assert.equal(result.session.status, "SETTLED");
  assert.equal(result.session.settlement?.outcome, "SETTLEMENT_ELIGIBLE");
});

test("normal flow processes checkpoints incrementally across multiple separate runs, not just one", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  let session = freshActiveSession();

  let result = await runProtectionMonitoring({ session, schedule, now: schedule[0].dueAt, fetchAssessments: scriptedFetcher([{ status: "PASS" }]) });
  session = result.session;
  assert.equal(session.checkpoints.length, 1);
  assert.equal(session.checkpoints[0].checkpoint, "saturday");

  result = await runProtectionMonitoring({ session, schedule, now: schedule[1].dueAt, fetchAssessments: scriptedFetcher([{ status: "PASS" }]) });
  session = result.session;
  assert.equal(session.checkpoints.length, 2);
  assert.equal(session.checkpoints[1].checkpoint, "sunday");
});

test("a checkpoint not yet due stops processing (and records no action for it beyond NOT_YET_DUE)", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  const result = await runProtectionMonitoring({
    session: freshActiveSession(),
    schedule,
    now: FRIDAY, // before Saturday is due
    fetchAssessments: scriptedFetcher([{ status: "PASS" }]),
  });

  assert.equal(result.session.checkpoints.length, 0);
  assert.equal(actionsOfType(result.actions, "NOT_YET_DUE").length, 1);
});

// --- Duplicate execution ---

test("duplicate execution: running the same due checkpoint twice records it only once", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  const fetcher = scriptedFetcher([{ status: "PASS" }]);

  let session = freshActiveSession();
  let result = await runProtectionMonitoring({ session, schedule, now: schedule[0].dueAt, fetchAssessments: fetcher });
  session = result.session;
  assert.equal(session.checkpoints.length, 1);

  // Run again with the SAME "now" — simulating the scheduler firing twice.
  result = await runProtectionMonitoring({ session, schedule, now: schedule[0].dueAt, fetchAssessments: fetcher });
  assert.equal(result.session.checkpoints.length, 1, "must still be exactly one checkpoint, not two");
  assert.equal(actionsOfType(result.actions, "ALREADY_RECORDED_SKIPPED").length, 1);
  assert.equal(actionsOfType(result.actions, "RECORDED_CHECKPOINT").length, 0, "no NEW checkpoint should be recorded on the second run");
});

// --- Trust failure ---

test("trust failure: Friday PASS, Saturday PASS, Sunday FAIL, Monday PASS -> SETTLEMENT_BLOCKED", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  const fetcher = scriptedFetcher([{ status: "PASS" }, { status: "FAIL" }, { status: "PASS", referencePrice: 330 }]);

  const result = await runFullScheduleOnTime(freshActiveSession(), schedule, fetcher);

  assert.equal(result.session.trustContinuity.brokenAt, "sunday");
  assert.equal(result.session.settlement?.outcome, "SETTLEMENT_BLOCKED");
});

// --- No payout ---

test("no payout: all checkpoints PASS, threshold not crossed -> NO_PAYOUT", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  const fetcher = scriptedFetcher([{ status: "PASS" }, { status: "PASS" }, { status: "PASS", referencePrice: 352 }]);

  const result = await runFullScheduleOnTime(freshActiveSession(), schedule, fetcher);

  assert.equal(result.session.settlement?.outcome, "NO_PAYOUT");
});

// --- Eligible ---

test("eligible: all checkpoints PASS, threshold crossed, final gate PASS -> SETTLEMENT_ELIGIBLE", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  const fetcher = scriptedFetcher([{ status: "PASS" }, { status: "PASS" }, { status: "PASS", referencePrice: 300 }]);

  const result = await runFullScheduleOnTime(freshActiveSession(), schedule, fetcher);

  assert.equal(result.session.settlement?.outcome, "SETTLEMENT_ELIGIBLE");
});

// --- Missed checkpoint ---

test("missed checkpoint: Saturday's window passes unrecorded before Sunday is processed -> explicitly recorded as a trust-breaking MISSED checkpoint, never silently treated as trusted", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  // "now" jumps straight to Sunday's due time — Saturday's window (which
  // ended when Sunday became due) already passed with nothing recorded.
  const result = await runProtectionMonitoring({
    session: freshActiveSession(),
    schedule,
    now: schedule[1].dueAt,
    fetchAssessments: scriptedFetcher([{ status: "PASS" }]), // only Sunday should actually be fetched
  });

  const saturdaySnap = result.session.checkpoints.find((c) => c.checkpoint === "saturday");
  assert.ok(saturdaySnap, "Saturday must still be explicitly represented, not skipped");
  assert.equal(saturdaySnap!.safetyGateResult.status, "FAIL", "a missed checkpoint must never read as trusted");
  assert.equal(result.session.trustContinuity.status, "TRUST_BROKEN");
  assert.equal(result.session.trustContinuity.brokenAt, "saturday");
  assert.equal(actionsOfType(result.actions, "RECORDED_MISSED_CHECKPOINT").length, 1);
});

test("missed checkpoint result must never silently resolve to a trusted settlement", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  // Jump straight to Monday's due time: BOTH Saturday and Sunday are missed in one run.
  const result = await runProtectionMonitoring({
    session: freshActiveSession(),
    schedule,
    now: schedule[2].dueAt,
    fetchAssessments: scriptedFetcher([{ status: "PASS", referencePrice: 330 }]), // only Monday is actually fetched
  });

  assert.equal(actionsOfType(result.actions, "RECORDED_MISSED_CHECKPOINT").length, 2, "both Saturday and Sunday must be recorded as missed");
  assert.equal(result.session.settlement?.outcome, "SETTLEMENT_BLOCKED", "a missed checkpoint must block settlement even if Monday itself looks fine and the threshold was crossed");
});

// --- Missing session ---

test("missing session: the store never fabricates a session for an unknown sessionId", () => {
  assert.equal(getSession("does-not-exist"), undefined);
});

test("missing session: a caller must not recreate one just because lookup failed (store-level contract, not a runner concern)", () => {
  // The runner itself takes an already-resolved session object and never
  // touches the store — this documents the DIVISION of responsibility: a
  // caller (e.g. the API route) must check getSession() first and fail
  // safely, never pass a synthetic replacement session into the runner.
  const before = getSession("truly-missing-id");
  assert.equal(before, undefined);
  saveSession(freshActiveSession()); // sanity: saving a REAL session still works
  assert.ok(getSession("runner-test"));
  assert.equal(getSession("truly-missing-id"), undefined, "an unrelated save must not conjure this one into existence");
});

// --- Session not ACTIVE (settled / not started) is a safe no-op ---

test("running the monitor against an already-SETTLED session is a safe no-op", async () => {
  const schedule = buildDefaultWeekendSchedule(FRIDAY);
  const fetcher = scriptedFetcher([{ status: "PASS" }, { status: "PASS" }, { status: "PASS", referencePrice: 330 }]);
  const first = await runProtectionMonitoring({ session: freshActiveSession(), schedule, now: schedule[2].dueAt, fetchAssessments: fetcher });
  assert.equal(first.session.status, "SETTLED");

  const second = await runProtectionMonitoring({ session: first.session, schedule, now: schedule[2].dueAt + 1, fetchAssessments: fetcher });
  assert.deepEqual(second.session, first.session, "a settled session must not be mutated by a further run");
  assert.equal(actionsOfType(second.actions, "NO_ACTION").length, 1);
});
