"use client";

import { useState } from "react";
import { runWeekendTrustMonitor } from "@/lib/protection/weekendTrustMonitor";
import { WEEKEND_TRUST_SCENARIOS } from "@/lib/protection/weekendTrustScenarios";
import { WeekendTrustTimeline } from "@/components/WeekendTrustTimeline";
import { DevBadge } from "@/components/DevBadge";

/**
 * Weekend Trust Monitor demo — runs the REAL, unmodified
 * runWeekendTrustMonitor() logic against hand-picked example scenarios, not
 * live Saturday/Sunday data (there is no live continuous-monitoring loop
 * yet — see weekendTrustMonitor.ts's module doc). Labelled as a simulation
 * throughout so this is never mistaken for real monitoring.
 */
export function WeekendTrustScenarioDemo() {
  const [scenarioId, setScenarioId] = useState(WEEKEND_TRUST_SCENARIOS[0].id);
  const scenario = WEEKEND_TRUST_SCENARIOS.find((s) => s.id === scenarioId) ?? WEEKEND_TRUST_SCENARIOS[0];

  const result = runWeekendTrustMonitor({
    fridaySnapshot: scenario.fridaySnapshot,
    monitoringSnapshots: scenario.monitoringSnapshots,
    mondaySnapshot: scenario.mondaySnapshot,
    thresholdPercent: scenario.thresholdPercent,
  });

  return (
    <div className="mt-4 rounded-lg border border-border-subtle p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">Weekend Trust Monitor</p>
        <DevBadge label="Simulation — not live monitoring" />
      </div>

      <p className="text-xs text-muted-2">
        Trust → Protection → Trust again → Settlement. This runs the real monitor logic against example weekend
        scenarios — there is no live Saturday/Sunday monitoring loop yet, so these are hand-picked illustrations,
        not a replay of actual data.
      </p>

      <select
        value={scenarioId}
        onChange={(e) => setScenarioId(e.target.value)}
        className="mt-3 w-full rounded border border-border-subtle bg-transparent px-2 py-1 text-sm"
      >
        {WEEKEND_TRUST_SCENARIOS.map((s) => (
          <option key={s.id} value={s.id} className="bg-surface">
            {s.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-muted-2">{scenario.description}</p>

      <WeekendTrustTimeline result={result} />
    </div>
  );
}
