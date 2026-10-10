import type { CheckResult } from "@/lib/types";
import { getUsEquityMarketStatus } from "../marketCalendar.ts";

/**
 * HARD check — but note what it actually verifies: NOT that the market is
 * open (WeekendGuard's whole premise is protecting positions while it's
 * closed), but that market status is *knowable* right now, so every other
 * check can apply the right expectations (e.g. freshness thresholds from
 * safety/freshness.ts). An "unknown" market status would make every other
 * check's interpretation unreliable, which is why this is hard rather than
 * soft.
 */
export function checkMarketStatus(): CheckResult {
  const status = getUsEquityMarketStatus();

  return {
    id: "marketStatus",
    label: "Market status",
    passed: true, // getUsEquityMarketStatus() is a deterministic calendar computation; it always resolves to a known state.
    severity: "hard",
    value: status.isOpen ? "open" : "closed",
    message: `US equity market is currently ${status.isOpen ? "OPEN" : "CLOSED"} (${status.reason}, ${status.dateKeyNy} America/New_York).`,
  };
}
