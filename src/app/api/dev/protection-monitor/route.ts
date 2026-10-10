import { NextResponse } from "next/server";
import { devOnlyGuardResponse } from "@/lib/devOnlyGuard";
import { startProtectionSession } from "@/lib/protection/protectionMonitoringSession";
import { runProtectionMonitoring, type MonitoringAction } from "@/lib/protection/protectionMonitoringRunner";
import { buildDefaultWeekendSchedule, type MonitoringSchedule } from "@/lib/protection/monitoringSchedule";
import { getSession, saveSession } from "@/lib/protection/protectionSessionStore";
import { getRealTrustSnapshot, type AssessmentLike, type FetchAssessmentsFn } from "@/lib/protection/trustSnapshot";
import { assessTickerViaBinanceRwa } from "@/lib/agent/binanceRwaRiskMonitor";
import type { TrustCheckpointLabel } from "@/lib/protection/weekendTrustMonitor";
import type { CheckResult, SafetyGateResult, SafetyGateStatus, Wrapper } from "@/lib/types";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/dev/protection-monitor
 *
 * DEV/DEMO ONLY (build brief Task 7): simulates the automatic monitoring
 * scheduler without waiting for a real weekend. Every actual decision is
 * made by the EXISTING, unmodified protectionMonitoringRunner.ts /
 * protectionMonitoringSession.ts / weekendTrustMonitor.ts — this route only
 * does HTTP plumbing, schedule construction, and per-checkpoint data
 * sourcing (real vs. mocked).
 *
 * This route is NOT a scheduler itself — it has no timer, no cron, no
 * background process. Each call is one explicit, caller-driven simulation
 * step or run.
 *
 * Body shapes:
 *   { op: "start", sessionId, wrapper, expiresAt, thresholdPercent, underlying?,
 *     fridaySnapshot?: TrustSnapshot, useRealFridaySnapshot?: { ticker } }
 *
 *   { op: "run-checkpoint", sessionId, now, checkpointOverride?: { status, referencePrice } }
 *     -- runs exactly one monitoring step at the given simulated `now`,
 *     against the session's own default weekend schedule (built from its
 *     startedAt). `checkpointOverride`, if given, mocks the NEXT due
 *     checkpoint's data instead of fetching real Binance/Pyth data.
 *
 *   { op: "run-all", sessionId, mockedCheckpoints?: Record<"saturday"|"sunday"|"monday", { status, referencePrice }> }
 *     -- simulates Friday→Saturday→Sunday→Monday end to end for an
 *     already-started session, processing the schedule ONE entry at a
 *     time at its own due time (so nothing is spuriously flagged as
 *     "missed" just because the whole simulation ran in a few
 *     milliseconds of wall-clock time) — any checkpoint present in
 *     `mockedCheckpoints` uses that fixed, labelled test data; any
 *     checkpoint absent from it uses the real, live Binance RWA + Pyth
 *     data via the EXISTING, unmodified getRealTrustSnapshot().
 */

interface MockableCheckpoint {
  status: SafetyGateStatus;
  referencePrice?: number;
}

interface RequestBody {
  op: "start" | "run-checkpoint" | "run-all";
  sessionId: string;
  underlying?: string;
  wrapper?: Wrapper;
  expiresAt?: number;
  thresholdPercent?: number;
  useRealFridaySnapshot?: { ticker: string };
  checkpointOverride?: MockableCheckpoint;
  mockedCheckpoints?: Partial<Record<TrustCheckpointLabel, MockableCheckpoint>>;
  now?: number;
}

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "simulated data" };
}

/** Builds a FetchAssessmentsFn that always returns one fixed, mocked result — used ONLY for simulating named failure/success scenarios, per Task 7. Mirrors the same local-fixture pattern already used by weekendTrustScenarios.ts (a real, non-test app file) for the identical reason. */
function mockedFetcher(wrapper: Wrapper, mock: MockableCheckpoint): FetchAssessmentsFn {
  const hardPass = mock.status !== "FAIL";
  const gateResult: SafetyGateResult = {
    status: mock.status,
    underlying: "TSLA",
    wrapper,
    checks: {
      liquidity: check(hardPass),
      priceFreshness: check(hardPass),
      referenceDeviation: check(hardPass),
      marketStatus: check(hardPass),
      crossWrapperConsistency: check(mock.status === "PASS" ? true : mock.status === "WARNING" ? false : true),
    },
    primaryReference:
      mock.referencePrice !== undefined
        ? { name: "Pyth Equity.US.TSLA/USD", price: mock.referencePrice, publishTimeSec: 1700000000 }
        : undefined,
    reasons: mock.status === "PASS" ? ["All checks passed."] : [`Simulated status: ${mock.status}.`],
    timestamp: 0,
  };
  const assessment: AssessmentLike = { stock: { wrapper }, safetyGateResult: gateResult };
  return async () => ({ assessments: [assessment], warnings: [] });
}

export async function POST(request: Request) {
  const guard = devOnlyGuardResponse();
  if (guard) return guard;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  try {
    if (body.op === "start") {
      if (!body.wrapper || body.expiresAt === undefined || body.thresholdPercent === undefined || !body.useRealFridaySnapshot) {
        return NextResponse.json(
          { error: "wrapper, expiresAt, thresholdPercent, and useRealFridaySnapshot are required to start a session." },
          { status: 400 }
        );
      }

      const { snapshot: fridaySnapshot, warnings } = await getRealTrustSnapshot(
        body.useRealFridaySnapshot.ticker,
        body.wrapper,
        "friday",
        assessTickerViaBinanceRwa
      );
      if (!fridaySnapshot) {
        return NextResponse.json({ error: `Could not get a real Friday snapshot: ${warnings.join(" ")}` }, { status: 502 });
      }

      const session = startProtectionSession({
        sessionId: body.sessionId,
        underlying: body.underlying ?? fridaySnapshot.safetyGateResult.underlying,
        wrapper: body.wrapper,
        expiresAt: body.expiresAt,
        thresholdPercent: body.thresholdPercent,
        fridaySnapshot,
      });
      saveSession(session);
      return NextResponse.json({ session });
    }

    const existing = getSession(body.sessionId);
    if (!existing) {
      // Task 6: fail safely, never recreate a session just because lookup failed.
      return NextResponse.json({ error: `No session found for sessionId "${body.sessionId}". It is not recreated automatically.` }, { status: 404 });
    }

    if (body.op === "run-checkpoint") {
      if (body.now === undefined) {
        return NextResponse.json({ error: "now is required for run-checkpoint." }, { status: 400 });
      }
      const schedule: MonitoringSchedule = buildDefaultWeekendSchedule(existing.startedAt);
      const fetchAssessments = body.checkpointOverride
        ? mockedFetcher(existing.wrapper, body.checkpointOverride)
        : assessTickerViaBinanceRwa;

      const result = await runProtectionMonitoring({ session: existing, schedule, now: body.now, fetchAssessments });
      saveSession(result.session);
      return NextResponse.json({ session: result.session, actions: result.actions });
    }

    if (body.op === "run-all") {
      const schedule: MonitoringSchedule = buildDefaultWeekendSchedule(existing.startedAt);
      let session = existing;
      const allActions: MonitoringAction[] = [];

      // Processed ONE schedule entry at a time, at ITS OWN due time — not
      // all at once at the final timestamp — so this genuinely simulates
      // "the scheduler ran on time for each checkpoint" rather than
      // artificially triggering the missed-checkpoint path (see
      // protectionMonitoringRunner.test.mts for why jumping straight to
      // the end is a meaningfully DIFFERENT scenario, correctly handled,
      // but not what "run-all" is meant to demonstrate by default).
      for (const entry of schedule) {
        const mock = body.mockedCheckpoints?.[entry.checkpoint];
        const fetchAssessments = mock ? mockedFetcher(existing.wrapper, mock) : assessTickerViaBinanceRwa;
        const result = await runProtectionMonitoring({ session, schedule, now: entry.dueAt, fetchAssessments });
        session = result.session;
        allActions.push(...result.actions);
      }

      saveSession(session);
      return NextResponse.json({ session, actions: allActions });
    }

    return NextResponse.json({ error: `Unknown op "${body.op}".` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : toUserMessage(err) }, { status: 502 });
  }
}
