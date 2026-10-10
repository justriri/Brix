import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/health
 *
 * Minimal deployment health check (build brief Task 7). Verifies only that
 * this Node process is up and able to handle a request — nothing more.
 * Deliberately does NOT: touch the SQLite store, call Binance/Pyth, run the
 * Safety Gate, or trigger the scheduler. A platform's health-check probe
 * (or a human curling the URL after deploying) should get an instant,
 * side-effect-free answer, not a dependency check disguised as one.
 */
export async function GET() {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
}
