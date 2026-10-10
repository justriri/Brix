import { getAllWrappersForTicker } from "@/lib/providers";
import { runSafetyGate } from "@/lib/safety/safetyGate";
import type { Position, SafetyGateResult } from "@/lib/types";
import type { SupportedTicker } from "@/lib/config/assets";

/**
 * Runs the deterministic Safety Gate for one position, using every other
 * available wrapper of the same underlying as cross-wrapper reference
 * data (never as something the position is moved into — see
 * safety/wrapperConsistency.ts).
 */
export async function assessPosition(position: Position): Promise<SafetyGateResult> {
  const ticker = position.stock.underlying as SupportedTicker;
  const allWrappers = await getAllWrappersForTicker(ticker);
  const otherWrappers = allWrappers.filter((w) => w.wrapper !== position.stock.wrapper);
  return runSafetyGate(position.stock, otherWrappers);
}

/**
 * Re-runs the Safety Gate for a set of positions. Intended to be called on
 * an interval (e.g. every few minutes while a weekend protection window is
 * active) so the dashboard can show "last checked" freshness and detect a
 * position going from PASS to WARNING/FAIL over time. No scheduler is
 * wired up yet in this MVP — the dashboard calls this on-demand.
 */
export async function assessAllPositions(
  positions: Position[]
): Promise<Map<string, SafetyGateResult>> {
  const entries = await Promise.all(
    positions.map(async (p) => [`${p.stock.wrapper}:${p.stock.underlying}`, await assessPosition(p)] as const)
  );
  return new Map(entries);
}
