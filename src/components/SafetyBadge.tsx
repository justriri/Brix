import type { SafetyGateStatus } from "@/lib/types";

const STYLES: Record<SafetyGateStatus, string> = {
  PASS: "bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/30",
  WARNING: "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/30",
  FAIL: "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/30",
  // A hard check couldn't be evaluated at all (no data from any source) —
  // deliberately neutral, not red, since this is a data gap, not a
  // confirmed failure. See lib/types.ts's SafetyGateStatus doc comment.
  UNAVAILABLE: "bg-slate-200 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20",
};

const LABEL: Record<SafetyGateStatus, string> = {
  PASS: "PASS",
  WARNING: "WARNING",
  FAIL: "FAIL",
  UNAVAILABLE: "Unavailable",
};

export function SafetyBadge({ status }: { status: SafetyGateStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STYLES[status]}`}
    >
      Safety: {LABEL[status]}
    </span>
  );
}
