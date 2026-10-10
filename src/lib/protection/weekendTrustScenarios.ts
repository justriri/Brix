import type { CheckResult, SafetyGateResult, SafetyGateStatus } from "@/lib/types";
import type { TrustCheckpointLabel, TrustSnapshot } from "@/lib/protection/weekendTrustMonitor";

/**
 * Named example scenarios for the Weekend Trust Monitor UI demo
 * (components/WeekendTrustScenarioDemo.tsx). These are the SAME five
 * scenarios (plus the two extra edge cases) exercised by
 * weekendTrustMonitor.test.mts, reconstructed here as a separate file
 * (not imported by the tests) purely because the test file builds its own
 * fixtures inline per this codebase's established convention — this file
 * exists only so the UI has clearly-labeled, illustrative example data to
 * run the SAME real monitor logic against, since there is no live
 * Saturday/Sunday monitoring loop yet (see module doc in
 * weekendTrustMonitor.ts: "STILL A SIMULATION").
 */

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "example data" };
}

function gateResult(status: SafetyGateStatus, referencePrice?: number): SafetyGateResult {
  const hardPass = status !== "FAIL";
  const crossWrapperPassed = status === "PASS" ? true : status === "WARNING" ? false : true;

  return {
    status,
    underlying: "TSLA",
    wrapper: "bstocks",
    checks: {
      liquidity: check(hardPass),
      priceFreshness: check(hardPass),
      referenceDeviation: check(hardPass),
      marketStatus: check(hardPass),
      crossWrapperConsistency: check(crossWrapperPassed),
    },
    primaryReference:
      referencePrice !== undefined
        ? { name: "Pyth Equity.US.TSLA/USD", price: referencePrice, publishTimeSec: 1700000000 }
        : undefined,
    reasons: status === "PASS" ? ["All checks passed."] : [`Safety Gate status was ${status} (example data).`],
    timestamp: 0,
  };
}

function snapshot(checkpoint: TrustCheckpointLabel, status: SafetyGateStatus, referencePrice?: number): TrustSnapshot {
  return { checkpoint, timestamp: 0, safetyGateResult: gateResult(status, referencePrice) };
}

export interface WeekendTrustScenario {
  id: string;
  label: string;
  description: string;
  thresholdPercent: number;
  fridaySnapshot: TrustSnapshot;
  monitoringSnapshots: TrustSnapshot[];
  mondaySnapshot: TrustSnapshot;
}

export const WEEKEND_TRUST_SCENARIOS: WeekendTrustScenario[] = [
  {
    id: "scenario-1",
    label: "1. Everything passes, threshold crossed",
    description: "Friday/Saturday/Sunday/Monday all pass, and TSLA drops past the threshold by Monday.",
    thresholdPercent: 5,
    fridaySnapshot: snapshot("friday", "PASS", 355),
    monitoringSnapshots: [snapshot("saturday", "PASS"), snapshot("sunday", "PASS")],
    mondaySnapshot: snapshot("monday", "PASS", 330),
  },
  {
    id: "scenario-2",
    label: "2. Pyth goes stale Sunday",
    description: "Trust breaks Sunday (independent reference price too old to trust), even though Monday looks fine on its own.",
    thresholdPercent: 5,
    fridaySnapshot: snapshot("friday", "PASS", 355),
    monitoringSnapshots: [snapshot("saturday", "PASS"), snapshot("sunday", "FAIL")],
    mondaySnapshot: snapshot("monday", "PASS", 330),
  },
  {
    id: "scenario-3",
    label: "3. Wrapper deviation spikes, then recovers",
    description: "bStocks/Ondo disagree too much Saturday, then agree again Sunday — but the break is never forgotten.",
    thresholdPercent: 5,
    fridaySnapshot: snapshot("friday", "PASS", 355),
    monitoringSnapshots: [snapshot("saturday", "WARNING"), snapshot("sunday", "PASS")],
    mondaySnapshot: snapshot("monday", "PASS", 330),
  },
  {
    id: "scenario-4",
    label: "4. Everything passes, threshold not crossed",
    description: "A clean weekend where TSLA simply didn't fall far enough to trigger a payout.",
    thresholdPercent: 5,
    fridaySnapshot: snapshot("friday", "PASS", 355),
    monitoringSnapshots: [snapshot("saturday", "PASS"), snapshot("sunday", "PASS")],
    mondaySnapshot: snapshot("monday", "PASS", 352),
  },
  {
    id: "scenario-5",
    label: "5. Friday Safety Gate fails",
    description: "Protection never starts — the entry gate itself didn't pass.",
    thresholdPercent: 5,
    fridaySnapshot: snapshot("friday", "FAIL"),
    monitoringSnapshots: [snapshot("saturday", "PASS"), snapshot("sunday", "PASS")],
    mondaySnapshot: snapshot("monday", "PASS", 330),
  },
];
