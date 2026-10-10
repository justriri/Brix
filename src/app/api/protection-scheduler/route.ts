import { NextResponse } from "next/server";
import { runDueProtectionCheckpoints } from "@/lib/protection/protectionScheduler";
import { assessTickerViaBinanceRwa } from "@/lib/agent/binanceRwaRiskMonitor";
import type { FetchAssessmentsFn, AssessmentLike } from "@/lib/protection/trustSnapshot";
import type { CheckResult, SafetyGateResult, SafetyGateStatus, Wrapper } from "@/lib/types";

export const runtime = "nodejs";

/**
 * GET/POST /api/protection-scheduler
 *
 * The ONE route in this app NOT prefixed with /dev/ — every other session
 * route (/api/dev/protection-session, /api/dev/protection-monitor) is a
 * manual, caller-driven simulation tool, kept exactly as-is (build brief
 * Task 14: "do not delete the existing manual monitoring functionality").
 * THIS route is different: it is the one piece of WeekendGuard meant to be
 * wired to a REAL external trigger (an HTTP-based cron service, a
 * platform's scheduled-function feature, etc.) once one is configured for
 * this deployment — see protectionScheduler.ts's own doc comment, and the
 * "actual runtime" determination below.
 *
 * ACTUAL RUNTIME DETERMINATION (build brief Task 2): this repo has no
 * deployment config of any kind (no vercel.json, no Dockerfile, no CI
 * cron). Both this route and its siblings declare `runtime = "nodejs"`,
 * and the Protection Monitoring Session store (db.ts) is a single SQLite
 * file assuming one long-lived process with persistent local disk. That
 * means the actual runtime today is (A) "long-lived Node process run via
 * `npm run dev`/`npm start`" — NOT serverless, NOT edge. There is currently
 * NO native cron facility available to this project. A `setInterval()`
 * loop inside the Next.js process would only run while that one process
 * stays up, which is not a reliable production guarantee (the process can
 * restart, and nothing here keeps a timer alive across that) — so rather
 * than pretend that's a production scheduler, this route instead exposes
 * an HTTP endpoint an EXTERNAL trigger (a real cron service, or a
 * platform's native cron once one is chosen for deployment) can call on a
 * schedule:
 *
 *   external cron -> HTTP GET/POST this route -> protectionScheduler.ts
 *     -> runProtectionMonitoring() (unmodified) for every due session
 *
 * This route itself contains no trust/price/Safety Gate logic — it is pure
 * HTTP plumbing around the real work in protectionScheduler.ts, same
 * division of responsibility as every other route in this app.
 *
 * SAFE TO CALL REPEATEDLY: every checkpoint is protected by the existing
 * SQL uniqueness constraint (protectionSessionStore.ts) — calling this
 * endpoint twice for the same due checkpoint records it once, not twice.
 *
 * AUTH (build brief Task 6 — deployment-safe, environment-aware): if
 * `SCHEDULER_TRIGGER_SECRET` is set, a request must supply it either as
 * `Authorization: Bearer <secret>` or a `?secret=` query param (many simple
 * external cron/HTTP-ping services cannot set custom headers, hence both);
 * missing/wrong -> 401. If the env var is UNSET: in development
 * (NODE_ENV !== "production") the endpoint stays open, for local/demo
 * convenience; in production (NODE_ENV === "production", i.e. a real
 * `next start`) it FAILS CLOSED with 503 rather than leave a public,
 * unauthenticated endpoint that can repeatedly trigger live Binance/Pyth
 * calls and mutate session state. Never hardcoded; never echoed back; never
 * logged. See DEPLOYMENT.md for the full decision table.
 *
 * DEV/TEST-ONLY CONVENIENCES (both optional, both absent in a normal real
 * cron call): `now` overrides the clock the scheduler uses (so a
 * checkpoint can be made "due" without waiting for real days to pass —
 * exactly the pattern /api/dev/protection-monitor already uses), and
 * `mockCheckpoint` substitutes a fixed Safety Gate result instead of
 * calling the real, live assessTickerViaBinanceRwa for every due
 * checkpoint this run processes. Neither should ever be sent by a real
 * cron trigger — a real trigger sends an empty body (or none at all).
 */

interface MockableCheckpoint {
  status: SafetyGateStatus;
  referencePrice?: number;
}

interface RequestBody {
  now?: number;
  mockCheckpoint?: MockableCheckpoint;
}

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "simulated data" };
}

/** Same small local-fixture-helper pattern already used by /api/dev/protection-monitor/route.ts — a fixed, mocked result for every due checkpoint, for dev/testing only. Not shared code on purpose, per this codebase's established convention of per-route local fixtures (see weekendTrustScenarios.ts, ProtectionSessionDemo.tsx). */
function mockedFetcher(mock: MockableCheckpoint): FetchAssessmentsFn {
  const hardPass = mock.status !== "FAIL";
  const buildResult = (wrapper: Wrapper): AssessmentLike => {
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
    return { stock: { wrapper }, safetyGateResult: gateResult };
  };
  // Every active session's own wrapper is unknown to this route ahead of
  // time, so the mocked result is returned for whichever wrapper the
  // scheduler asks about (getRealTrustSnapshot matches by wrapper itself).
  return async () => ({
    assessments: (["bstocks", "ondo", "xstocks"] as Wrapper[]).map(buildResult),
    warnings: [],
  });
}

type AuthCheck = "AUTHORIZED" | "UNAUTHORIZED" | "NOT_CONFIGURED_IN_PRODUCTION";

/**
 * Deployment-safety decision (build brief Task 6): a missing
 * SCHEDULER_TRIGGER_SECRET means two very different things depending on
 * environment.
 *  - In development (`next dev`, NODE_ENV !== "production"): stay open, so
 *    a judge/developer running this locally doesn't need to configure a
 *    secret just to try the demo — matches every other dev convenience in
 *    this codebase.
 *  - In production (`next start`, NODE_ENV === "production"): FAIL CLOSED.
 *    An unconfigured secret on a real, publicly reachable deployment would
 *    mean anyone on the internet could repeatedly trigger live Binance/Pyth
 *    calls and mutate every active session's monitoring state. Next.js sets
 *    NODE_ENV automatically for build/start — nothing new to configure.
 */
function checkAuthorization(request: Request): AuthCheck {
  const required = process.env.SCHEDULER_TRIGGER_SECRET;
  if (!required) {
    return process.env.NODE_ENV === "production" ? "NOT_CONFIGURED_IN_PRODUCTION" : "AUTHORIZED";
  }

  const { searchParams } = new URL(request.url);
  const fromQuery = searchParams.get("secret");
  const authHeader = request.headers.get("authorization");
  const fromHeader = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : undefined;

  return fromQuery === required || fromHeader === required ? "AUTHORIZED" : "UNAUTHORIZED";
}

async function handle(request: Request): Promise<Response> {
  const auth = checkAuthorization(request);
  if (auth === "NOT_CONFIGURED_IN_PRODUCTION") {
    console.error(
      "[protection-scheduler] blocked: SCHEDULER_TRIGGER_SECRET is not set in a production environment — refusing to run with an open trigger. Set SCHEDULER_TRIGGER_SECRET to enable this endpoint."
    );
    return NextResponse.json(
      { error: "Scheduler trigger is disabled: SCHEDULER_TRIGGER_SECRET is not configured for this production deployment." },
      { status: 503 }
    );
  }
  if (auth === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: RequestBody = {};
  if (request.method === "POST") {
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
  }

  const { searchParams } = new URL(request.url);
  const nowParam = searchParams.get("now");
  const now = body.now ?? (nowParam ? Number(nowParam) : undefined);

  const fetchAssessments: FetchAssessmentsFn = body.mockCheckpoint
    ? mockedFetcher(body.mockCheckpoint)
    : assessTickerViaBinanceRwa;

  // Settlement-authorization issuance (settlementAuthorizationIssuer.ts) is
  // only attempted when the settlement contract is actually configured for
  // this environment — the same NEXT_PUBLIC_* vars the browser-side client
  // already reads. Omitted entirely (not an error) when unset: every
  // session still gets monitored/evaluated, just without the extra signing
  // step, exactly as if no contract existed yet.
  const contractAddress = process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS;
  const chainId = Number(process.env.NEXT_PUBLIC_SETTLEMENT_CHAIN_ID ?? "97");
  const settlementContract = contractAddress ? { address: contractAddress as `0x${string}`, chainId } : undefined;

  const summary = await runDueProtectionCheckpoints({ now, fetchAssessments, settlementContract });
  return NextResponse.json(summary);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
