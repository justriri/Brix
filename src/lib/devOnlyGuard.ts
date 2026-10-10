import { NextResponse } from "next/server";

/**
 * Shared guard for routes explicitly documented as DEV/DEMO/DIAGNOSTIC ONLY
 * — unlike /api/protection-scheduler and /api/dev/settlement-authorization
 * (which stay reachable in production behind a configured secret, since
 * they're needed there), these have no legitimate production caller at
 * all. They were always labelled dev-only in their own doc comments but
 * were never actually unreachable in a real deployment — this closes that
 * gap. Returns a response to send (404) if the route should refuse the
 * request, or null if it's fine to proceed (always true outside
 * production, e.g. `next dev` or the test suite).
 */
export function devOnlyGuardResponse(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production." }, { status: 404 });
  }
  return null;
}
