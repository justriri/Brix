import type { TrustSnapshot, WeekendTrustMonitorResult } from "@/lib/protection/weekendTrustMonitor";
import { SafetyBadge } from "@/components/SafetyBadge";

const CHECKPOINT_LABELS: Record<string, string> = {
  friday: "Friday — Trust established",
  saturday: "Saturday — Trust checked",
  sunday: "Sunday — Trust checked",
  monday: "Monday — Settlement check",
};

function StepCard({ snapshot }: { snapshot: TrustSnapshot }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-subtle p-3">
      <p className="text-xs font-medium text-muted-2">{CHECKPOINT_LABELS[snapshot.checkpoint] ?? snapshot.checkpoint}</p>
      <div className="mt-1">
        <SafetyBadge status={snapshot.safetyGateResult.status} />
      </div>
    </div>
  );
}

const OUTCOME_STYLE: Record<string, string> = {
  SETTLEMENT_ELIGIBLE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  NO_PAYOUT: "border-border-subtle bg-surface-3 text-muted",
  SETTLEMENT_BLOCKED: "border-amber-500/30 bg-amber-500/10 text-amber-400",
};

/**
 * Renders a WeekendTrustMonitorResult as the simple Friday -> Saturday ->
 * Sunday -> Monday timeline the build brief asked for, ending in the final
 * lifecycle/settlement state. Pure presentation — all the actual trust/
 * settlement logic lives in lib/protection/weekendTrustMonitor.ts.
 */
export function WeekendTrustTimeline({ result }: { result: WeekendTrustMonitorResult }) {
  if (result.lifecycleStatus === "PROTECTION_NOT_STARTED") {
    return (
      <div className="mt-3">
        <StepCard snapshot={result.fridaySnapshot} />
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-xs font-medium text-red-400">Final state</p>
          <p className="mt-1 text-sm font-semibold text-red-400">PROTECTION_NOT_STARTED</p>
          <p className="mt-1 text-xs text-red-400/90">
            The Friday Safety Gate did not pass, so weekend protection never began.
          </p>
        </div>
      </div>
    );
  }

  const steps: TrustSnapshot[] = [result.fridaySnapshot, ...result.monitoringSnapshots, result.mondaySnapshot!];
  const settlement = result.settlement!;

  return (
    <div className="mt-3">
      {/* grid, not flex-row: a flex row sized by VIEWPORT width (not this
          card's own width) would squeeze 4 cards into whatever space is
          left once this timeline sits inside a wider two-column Protect
          layout — grid-cols-2 sm:grid-cols-4 scales with the actual
          container instead. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((s, i) => (
          <StepCard key={`${s.checkpoint}-${i}`} snapshot={s} />
        ))}
      </div>
      <div className={`mt-3 rounded-lg border p-3 ${OUTCOME_STYLE[settlement.outcome]}`}>
        <p className="text-xs font-medium opacity-80">Final state</p>
        <p className="mt-1 text-sm font-semibold">{settlement.outcome}</p>
        <p className="mt-1 text-xs opacity-80">{settlement.reason}</p>
      </div>
    </div>
  );
}
