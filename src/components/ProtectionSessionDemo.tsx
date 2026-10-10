"use client";

import { useState } from "react";
import {
  evaluateProtectionSettlement,
  recordTrustCheckpoint,
  startProtectionSession,
  type ProtectionMonitoringSession,
} from "@/lib/protection/protectionMonitoringSession";
import { isCheckpointTrusted, type TrustCheckpointLabel, type TrustSnapshot } from "@/lib/protection/weekendTrustMonitor";
import type { CheckResult, SafetyGateResult, SafetyGateStatus } from "@/lib/types";
import { DevBadge } from "@/components/DevBadge";

/**
 * Weekend Protection — Monitoring Session demo. Runs the REAL, unmodified
 * startProtectionSession() / recordTrustCheckpoint() / evaluateProtectionSettlement()
 * directly, client-side, against three named example scenarios — the same
 * "pure function, no API call needed" pattern already used by
 * WeekendTrustScenarioDemo.tsx. This is NOT live monitoring: there is no
 * background job collecting real Saturday/Sunday checkpoints. The
 * lifecycle machinery (start -> checkpoint -> checkpoint -> settle,
 * remembering the first trust failure) is real; the data feeding it here
 * is hand-picked, exactly like its sibling simulation component.
 *
 * The server-side equivalent of this exact lifecycle, usable with REAL
 * live snapshots via getRealTrustSnapshot(), is
 * POST /api/dev/protection-session — this component only demonstrates the
 * logic, it doesn't call that route.
 */

function check(passed: boolean | null): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "example data" };
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
    reasons:
      status === "PASS"
        ? ["All checks passed."]
        : [
            status === "FAIL"
              ? "Reference data became unreliable during the protection window."
              : "Wrapper agreement broke down during the protection window.",
          ],
    timestamp: 0,
  };
}

function snap(checkpoint: TrustCheckpointLabel, status: SafetyGateStatus, timestamp: number, referencePrice?: number): TrustSnapshot {
  return { checkpoint, timestamp, safetyGateResult: gateResult(status, referencePrice) };
}

interface SessionScenarioStep {
  checkpoint: TrustCheckpointLabel;
  status: SafetyGateStatus;
  referencePrice?: number;
}

interface SessionScenario {
  id: string;
  label: string;
  steps: SessionScenarioStep[];
}

const SESSION_SCENARIOS: SessionScenario[] = [
  {
    id: "healthy",
    label: "Healthy weekend → SETTLEMENT_ELIGIBLE",
    steps: [
      { checkpoint: "friday", status: "PASS", referencePrice: 355 },
      { checkpoint: "saturday", status: "PASS" },
      { checkpoint: "sunday", status: "PASS" },
      { checkpoint: "monday", status: "PASS", referencePrice: 330 },
    ],
  },
  {
    id: "broken",
    label: "Trust breaks Sunday, recovers Monday → SETTLEMENT_BLOCKED",
    steps: [
      { checkpoint: "friday", status: "PASS", referencePrice: 355 },
      { checkpoint: "saturday", status: "PASS" },
      { checkpoint: "sunday", status: "FAIL" },
      { checkpoint: "monday", status: "PASS", referencePrice: 330 },
    ],
  },
  {
    id: "nopayout",
    label: "Healthy weekend, threshold not crossed → NO_PAYOUT",
    steps: [
      { checkpoint: "friday", status: "PASS", referencePrice: 355 },
      { checkpoint: "saturday", status: "PASS" },
      { checkpoint: "sunday", status: "PASS" },
      { checkpoint: "monday", status: "PASS", referencePrice: 352 },
    ],
  },
];

/**
 * Builds the session up through `stepCount` of the scenario's post-Friday
 * checkpoints (0 = Friday only). Settlement is only evaluated once every
 * checkpoint has been recorded — matching the real runner, which only calls
 * evaluateProtectionSettlement() on the final (isFinal) schedule entry. This
 * lets the UI show a genuinely PARTIAL monitoring status (Task 9) instead of
 * always jumping straight to the fully-settled end state.
 */
function buildSession(scenario: SessionScenario, stepCount: number): ProtectionMonitoringSession {
  const [friday, ...rest] = scenario.steps;
  let session = startProtectionSession({
    sessionId: scenario.id,
    underlying: "TSLA",
    wrapper: "bstocks",
    expiresAt: 0,
    thresholdPercent: 5,
    fridaySnapshot: snap(friday.checkpoint, friday.status, 1, friday.referencePrice),
  });

  const appliedSteps = rest.slice(0, stepCount);
  appliedSteps.forEach((step, i) => {
    session = recordTrustCheckpoint(session, snap(step.checkpoint, step.status, i + 2, step.referencePrice));
  });

  if (stepCount >= rest.length) {
    session = evaluateProtectionSettlement(session);
  }

  return session;
}

const SCHEDULED_CHECKPOINTS: TrustCheckpointLabel[] = ["saturday", "sunday", "monday"];

function PendingRow({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="text-muted-2">—</span>
      <span className="w-20 shrink-0 text-muted-2">{label}</span>
      <span className="text-muted-2">Not yet checked</span>
    </li>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function TrustHistoryRow({ label, snapshot }: { label: string; snapshot: TrustSnapshot }) {
  const trusted = isCheckpointTrusted(snapshot);
  return (
    <li className="flex items-center gap-2">
      <span className={trusted ? "text-emerald-400" : "text-red-400"}>{trusted ? "✓" : "✕"}</span>
      <span className="w-20 shrink-0 text-muted-2">{label}</span>
      <span>{trusted ? "Trusted" : "Trust broken"}</span>
    </li>
  );
}

const OUTCOME_STYLE: Record<string, string> = {
  SETTLEMENT_ELIGIBLE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  NO_PAYOUT: "border-border-subtle bg-surface-3 text-muted",
  SETTLEMENT_BLOCKED: "border-amber-500/30 bg-amber-500/10 text-amber-400",
};

export function ProtectionSessionDemo() {
  const [scenarioId, setScenarioId] = useState(SESSION_SCENARIOS[0].id);
  const scenario = SESSION_SCENARIOS.find((s) => s.id === scenarioId) ?? SESSION_SCENARIOS[0];
  const totalSteps = scenario.steps.length - 1;
  const [stepCount, setStepCount] = useState(totalSteps);
  const session = buildSession(scenario, stepCount);

  const nextCheckpoint = SCHEDULED_CHECKPOINTS.find(
    (cp) => !session.checkpoints.some((c) => c.checkpoint === cp)
  );

  return (
    <div className="mt-4 rounded-lg border border-border-subtle p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">Weekend Protection — Monitoring Session</p>
        <DevBadge label="Prototype — not an automated background service" />
      </div>

      <p className="text-xs text-muted-2">
        A stateful session that remembers trust across Friday → Saturday → Sunday → Monday. Still a prototype: there
        is no background job collecting these checkpoints automatically — this demo runs the real session logic
        against hand-picked example data, and the checkpoints below only advance when you click &quot;Advance&quot;.
      </p>

      <select
        value={scenarioId}
        onChange={(e) => {
          setScenarioId(e.target.value);
          setStepCount(0);
        }}
        className="mt-3 w-full rounded border border-border-subtle bg-transparent px-2 py-1 text-sm"
      >
        {SESSION_SCENARIOS.map((s) => (
          <option key={s.id} value={s.id} className="bg-surface">
            {s.label}
          </option>
        ))}
      </select>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStepCount((n) => Math.min(n + 1, totalSteps))}
          disabled={stepCount >= totalSteps}
          className="rounded border border-border-subtle px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          {stepCount >= totalSteps ? "All checkpoints recorded" : `Advance to ${capitalize(nextCheckpoint ?? "")}`}
        </button>
        <button
          type="button"
          onClick={() => setStepCount(0)}
          disabled={stepCount === 0}
          className="rounded border border-border-subtle px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          Restart from Friday
        </button>
      </div>

      <p className="mt-3 text-sm">
        Monitoring status: <span className="font-semibold">{session.status}</span> (simulated — not a running
        scheduler)
        <br />
        Next check: <span className="font-semibold">{nextCheckpoint ? capitalize(nextCheckpoint) : "None — monitoring complete"}</span>
      </p>

      <p className="mt-3 text-xs font-medium text-muted-2">Trust history</p>
      <ul className="mt-1 space-y-1 text-sm">
        <TrustHistoryRow label="Friday" snapshot={session.fridaySnapshot} />
        {SCHEDULED_CHECKPOINTS.map((cp) => {
          const recorded = session.checkpoints.find((c) => c.checkpoint === cp);
          return recorded ? (
            <TrustHistoryRow key={cp} label={capitalize(cp)} snapshot={recorded} />
          ) : (
            <PendingRow key={cp} label={capitalize(cp)} />
          );
        })}
      </ul>

      <p className="mt-3 text-sm">
        Trust continuity:{" "}
        <span className={session.trustContinuity.status === "TRUST_INTACT" ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>
          {session.trustContinuity.status === "TRUST_INTACT" ? "VALID" : "BROKEN"}
        </span>
      </p>

      {session.settlement && (
        <div className={`mt-3 rounded-lg border p-3 ${OUTCOME_STYLE[session.settlement.outcome]}`}>
          <p className="text-sm font-semibold">Settlement: {session.settlement.outcome}</p>
          <p className="mt-1 text-xs opacity-80">Reason: {session.settlement.reason}</p>
        </div>
      )}
    </div>
  );
}
