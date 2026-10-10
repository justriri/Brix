import { NextResponse } from "next/server";
import { devOnlyGuardResponse } from "@/lib/devOnlyGuard";
import {
  evaluateProtectionSettlement,
  recordTrustCheckpoint,
  startProtectionSession,
} from "@/lib/protection/protectionMonitoringSession";
import { getSession, saveSession } from "@/lib/protection/protectionSessionStore";
import { getRealTrustSnapshot } from "@/lib/protection/trustSnapshot";
import { assessTickerViaBinanceRwa } from "@/lib/agent/binanceRwaRiskMonitor";
import type { TrustCheckpointLabel, TrustSnapshot } from "@/lib/protection/weekendTrustMonitor";
import type { Wrapper } from "@/lib/types";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/dev/protection-session
 *
 * DEV/DEMO ONLY (build brief Task 6): exercises the full Protection
 * Monitoring Session lifecycle — start -> checkpoint (x N) -> settle —
 * backed by the in-memory prototype store (protectionSessionStore.ts).
 * Every real decision is made by the EXISTING, unmodified
 * protectionMonitoringSession.ts / weekendTrustMonitor.ts; this route only
 * does HTTP plumbing and snapshot sourcing.
 *
 * Each snapshot can be EITHER:
 *  - a raw `snapshot` object supplied directly in the body (for
 *    reproducing the three named scenarios with mocked/simulated data), or
 *  - `useRealSnapshot: { ticker, checkpoint }`, which fetches ONE real,
 *    live snapshot via the existing, unmodified getRealTrustSnapshot().
 *
 * Body shapes:
 *   { op: "start",      sessionId, wrapper, expiresAt, thresholdPercent, underlying?, snapshot?, useRealSnapshot? }
 *   { op: "checkpoint", sessionId, snapshot?, useRealSnapshot? }
 *   { op: "settle",     sessionId }
 *   { op: "get",        sessionId }
 *
 * No funds move, no transaction is ever requested, and there is no
 * scheduler behind this — each call is a single, explicit, caller-driven
 * step.
 */

interface ResolvedRealSnapshotRequest {
  ticker: string;
  checkpoint?: TrustCheckpointLabel;
}

interface RequestBody {
  op: "start" | "checkpoint" | "settle" | "get";
  sessionId: string;
  underlying?: string;
  wrapper?: Wrapper;
  expiresAt?: number;
  thresholdPercent?: number;
  snapshot?: TrustSnapshot;
  useRealSnapshot?: ResolvedRealSnapshotRequest;
}

async function resolveSnapshot(
  body: RequestBody,
  wrapperForRealFetch: Wrapper
): Promise<TrustSnapshot> {
  if (body.snapshot) return body.snapshot;

  if (body.useRealSnapshot) {
    const checkpoint = body.useRealSnapshot.checkpoint ?? "friday";
    const { snapshot, warnings } = await getRealTrustSnapshot(
      body.useRealSnapshot.ticker,
      wrapperForRealFetch,
      checkpoint,
      assessTickerViaBinanceRwa
    );
    if (!snapshot) {
      throw new Error(
        `Could not get a real trust snapshot for ${wrapperForRealFetch} ${body.useRealSnapshot.ticker}: ${warnings.join(" ")}`
      );
    }
    return snapshot;
  }

  throw new Error("Either `snapshot` (mocked/simulated) or `useRealSnapshot` (live data) is required.");
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
      if (!body.wrapper || body.expiresAt === undefined || body.thresholdPercent === undefined) {
        return NextResponse.json(
          { error: "wrapper, expiresAt, and thresholdPercent are required to start a session." },
          { status: 400 }
        );
      }

      const fridaySnapshot = await resolveSnapshot(body, body.wrapper);
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
      return NextResponse.json({ error: `No session found for sessionId "${body.sessionId}".` }, { status: 404 });
    }

    if (body.op === "get") {
      return NextResponse.json({ session: existing });
    }

    if (body.op === "checkpoint") {
      const snapshot = await resolveSnapshot(body, existing.wrapper);
      const updated = recordTrustCheckpoint(existing, snapshot);
      saveSession(updated);
      return NextResponse.json({ session: updated });
    }

    if (body.op === "settle") {
      const updated = evaluateProtectionSettlement(existing);
      saveSession(updated);
      return NextResponse.json({ session: updated });
    }

    return NextResponse.json({ error: `Unknown op "${body.op}".` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : toUserMessage(err) }, { status: 502 });
  }
}

/** GET /api/dev/protection-session?sessionId=... — convenience read of an existing session's current state/history. */
export async function GET(request: Request) {
  const guard = devOnlyGuardResponse();
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId query param is required." }, { status: 400 });
  }
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: `No session found for sessionId "${sessionId}".` }, { status: 404 });
  }
  return NextResponse.json({ session });
}
