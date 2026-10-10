import type { TrustCheckpointLabel } from "@/lib/protection/weekendTrustMonitor";

/**
 * Deterministic monitoring schedule configuration — zero logic, just data.
 *
 * Reuses the EXISTING TrustCheckpointLabel ("friday"|"saturday"|"sunday"|
 * "monday") as the schedule's own checkpoint identifier rather than
 * inventing a second, parallel enum (e.g. a separate "SATURDAY_CHECKPOINT"
 * constant) — a session can only ever have one checkpoint per label in
 * this simple weekend model, so the existing label IS already a clean
 * unique identifier within one session's lifecycle (see
 * protectionMonitoringRunner.ts's duplicate-prevention check).
 *
 * Deliberately covers only the POST-START checkpoints (saturday/sunday/
 * monday) — "Friday" is session CREATION (startProtectionSession(), already
 * existing), not a checkpoint the runner records against an existing
 * session. Keeping that distinction clean is what Task 3's "find active
 * protection sessions... record the checkpoint" wording implies: the
 * runner operates on an already-started session, it doesn't start one.
 *
 * Timestamps are configuration, not hardcoded constants scattered through
 * the runner — buildDefaultWeekendSchedule() is one convenience factory
 * for the common case; any MonitoringSchedule (any timestamps, any order)
 * can be constructed and passed directly for simulation/testing.
 */

export interface MonitoringScheduleEntry {
  checkpoint: TrustCheckpointLabel;
  /** Ms epoch this checkpoint becomes due. Configurable per instance — never a hardcoded global constant. */
  dueAt: number;
  /** True only for the checkpoint whose recording should trigger settlement evaluation (normally "monday"). */
  isFinal: boolean;
}

export type MonitoringSchedule = MonitoringScheduleEntry[];

/**
 * Convenience factory for the common case: Saturday/Sunday/Monday spaced
 * `intervalMs` apart starting from `fridayStartAt` (the session's own
 * startedAt, typically) — NOT a hardcoded schedule; every timestamp is
 * derived from the two parameters, both caller-supplied. For
 * simulation/testing, construct a MonitoringSchedule array directly
 * instead (arbitrary timestamps, arbitrary order) rather than using this
 * factory.
 */
export function buildDefaultWeekendSchedule(
  fridayStartAt: number,
  intervalMs: number = 24 * 60 * 60 * 1000
): MonitoringSchedule {
  return [
    { checkpoint: "saturday", dueAt: fridayStartAt + 1 * intervalMs, isFinal: false },
    { checkpoint: "sunday", dueAt: fridayStartAt + 2 * intervalMs, isFinal: false },
    { checkpoint: "monday", dueAt: fridayStartAt + 3 * intervalMs, isFinal: true },
  ];
}

/**
 * Builds a schedule whose FINAL checkpoint lands exactly at a real, already-
 * known expiry (e.g. a real on-chain Policy's own `expiryTime`), rather than
 * assuming a generic "Friday + 3 days." This matters because the contract's
 * `resolveSettlement` only accepts a resolution once `block.timestamp >=
 * policy.expiryTime` (WeekendGuardSettlement.sol) — if the off-chain final
 * evaluation ran on a DIFFERENT schedule than the real expiry, the scheduler
 * could decide "settled" either too early (before the contract would even
 * accept a resolution) or with a stale window. Saturday/Sunday-equivalent
 * intermediate checkpoints are placed evenly between `startedAt` and
 * `expiresAt` (thirds), same two-intermediate-checkpoint shape as the
 * default schedule — only the spacing is derived from real data instead of
 * a fixed 24h assumption, so this still works correctly for a policy whose
 * window isn't exactly three days (e.g. a holiday weekend).
 */
export function buildScheduleForExpiry(startedAt: number, expiresAt: number): MonitoringSchedule {
  const span = expiresAt - startedAt;
  return [
    { checkpoint: "saturday", dueAt: startedAt + span / 3, isFinal: false },
    { checkpoint: "sunday", dueAt: startedAt + (2 * span) / 3, isFinal: false },
    { checkpoint: "monday", dueAt: expiresAt, isFinal: true },
  ];
}
