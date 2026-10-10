import type { CandidateEvaluation, WrapperComparison, WrapperDifference } from "./intelligenceTypes";

/**
 * Pure wrapper comparison — build brief Phase 1 §4: "Do not simply select a
 * winner. Explain the concrete differences." For each check name, if the
 * wrappers disagree (not all the same status), this emits one factual,
 * templated difference line naming exactly which wrapper(s) passed/failed
 * and why (using that check's own existing `message`) — never a ranking,
 * never a "better" verdict.
 */
export function compareCandidates(wrappers: CandidateEvaluation[]): WrapperComparison {
  if (wrappers.length === 0) {
    throw new Error("compareCandidates requires at least one wrapper");
  }

  const underlying = wrappers[0].underlying;
  const checkNames = wrappers[0].checks.map((c) => c.name);
  const differences: WrapperDifference[] = [];

  for (const checkName of checkNames) {
    const perWrapper = wrappers.map((w) => ({
      wrapper: w.wrapper,
      check: w.checks.find((c) => c.name === checkName),
    }));

    const statuses = new Set(perWrapper.map((p) => p.check?.status ?? "UNKNOWN"));
    if (statuses.size <= 1) continue; // every wrapper agrees on this check — nothing to report

    const parts = perWrapper.map((p) => `${p.wrapper} ${p.check?.status ?? "UNKNOWN"} (${p.check?.message ?? "no data"})`);
    differences.push({
      checkName,
      description: `${checkName}: ${parts.join("; ")}`,
    });
  }

  return { underlying, wrappers, differences };
}
