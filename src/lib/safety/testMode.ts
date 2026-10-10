/**
 * Explicit, development-only override: when the cross-wrapper consistency
 * check is INCONCLUSIVE (no trustworthy comparison data — not a genuine
 * price DISAGREEMENT, and not any hard-check failure), this lets the
 * Protect flow be exercised anyway, for end-to-end testing, WITHOUT
 * pretending cross-wrapper consistency was actually verified — see
 * protectionOffer.ts, which is the only caller and always labels its
 * decision explicitly when this is why protection was offered.
 *
 * Gated by TWO independent conditions, both required:
 *   1. NODE_ENV must not be "production". Next.js sets this automatically
 *      for `next build` / `next start` regardless of what any .env file
 *      says, so a real production deployment cannot have this flip on
 *      just because an env var was left set by mistake.
 *   2. The override must be explicitly opted into via
 *      WEEKENDGUARD_ALLOW_INCONCLUSIVE_PROTECTION_TEST=true — off by
 *      default, so it never silently changes behavior for anyone (any
 *      other developer, any other environment) who hasn't deliberately
 *      turned it on themselves.
 *
 * Deliberately NOT a NEXT_PUBLIC_ variable: it is read only here, server
 * side (orchestrator.ts runs inside the /api/portfolio route, not in the
 * browser) — never bundled into client JS, never readable or toggleable
 * from the browser console.
 */
export function isInconclusiveProtectionTestModeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.WEEKENDGUARD_ALLOW_INCONCLUSIVE_PROTECTION_TEST === "true";
}
