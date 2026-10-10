import { getPythLatestPrice, isPythConfigured } from "@/lib/providers/pyth";
import { getOndoIssuerReference } from "@/lib/providers/issuerReference";
import { getUsEquityMarketStatus } from "@/lib/marketCalendar";
import { PYTH_FEEDS, type SupportedTicker } from "@/lib/config/assets";
import type { ReferenceSource, Wrapper } from "@/lib/types";
import { isWeekendGuardError } from "@/lib/errors";

export interface ReferenceResult {
  primary?: ReferenceSource;
  fallback?: ReferenceSource;
  /** Tier 3 — an authoritative issuer-side reference (currently Ondo-only via Binance RWA's underlying-market data; see providers/issuerReference.ts), used only once BOTH Pyth tiers above have failed. Kept in its own field (never merged into `primary`/`fallback`) so a caller can tell a Pyth-sourced reference apart from an issuer-sourced one if it needs to. */
  issuerReference?: ReferenceSource;
  /** Present when no tier could produce a reference at all. Never fabricated. */
  unavailableReason?: string;
}

/**
 * Resolves an independent reference price for a ticker, following a
 * three-tier fallback hierarchy:
 *
 *   1. Pyth Equity.US (market-hours-aware) — the primary.
 *   2. Pyth Equity.Index (24/7 synthetic) — the fallback.
 *   3. An authoritative ISSUER reference (Ondo-only today — see
 *      providers/issuerReference.ts) — tried only once BOTH Pyth tiers
 *      have failed, e.g. because the configured PYTH_API_KEY's
 *      entitlements don't cover this ticker's feed (live-confirmed: an
 *      HTTP 403 "Not entitled" response, not a missing/wrong feed id — see
 *      issuerReference.ts's module doc for the full live diagnosis).
 *
 * `issuerContext` is optional and wrapper-specific (Binance's
 * underlying-market endpoint is address-keyed, not ticker-keyed, and is
 * only meaningful for Ondo tokens) — callers that don't have a specific
 * wrapper/token in hand (or whose wrapper isn't Ondo) simply don't pass it,
 * and tier 3 is skipped exactly as if it had failed.
 *
 * Every tier either returns real, validated data or is skipped — nothing
 * here silently invents a number, and a tier being unavailable is never
 * treated as "prices agree" or "prices disagree."
 */
export async function getReferenceForTicker(
  ticker: SupportedTicker,
  issuerContext?: { wrapper: Wrapper; tokenContractAddress?: string; binanceChainId?: string }
): Promise<ReferenceResult> {
  const marketStatus = getUsEquityMarketStatus();

  let primary: ReferenceSource | undefined;
  let fallback: ReferenceSource | undefined;

  if (isPythConfigured()) {
    const feeds = PYTH_FEEDS[ticker];
    try {
      primary = await getPythLatestPrice(feeds.usEquity, `Equity.US.${ticker}/USD`, { isAlwaysOn: false });
    } catch (err) {
      if (!isWeekendGuardError(err)) throw err;
      // fall through to the fallback/issuer tiers
    }

    // Even if the primary feed answered, if the market is closed its price
    // is expected to be frozen at the last close — that's fine as a
    // reference (it IS Friday's close), but we still attempt the fallback
    // so the caller has both data points to reason about, per the
    // SafetyGateResult shape (`primaryReference` / `fallbackReference`).
    try {
      fallback = await getPythLatestPrice(feeds.equityIndex247, `Equity.Index.${ticker}/USD (24/7)`, { isAlwaysOn: true });
    } catch (err) {
      if (!isWeekendGuardError(err)) throw err;
    }
  }

  if (primary || fallback) {
    return { primary, fallback, unavailableReason: primary ? undefined : (marketStatus.isOpen ? "Primary reference unavailable during open market hours; using 24/7 fallback." : undefined) };
  }

  // Tier 3: the issuer reference, tried only once both Pyth tiers failed
  // (including the "not configured"/"not entitled" cases above) — never
  // tried first, per the hierarchy.
  if (issuerContext?.wrapper === "ondo" && issuerContext.tokenContractAddress && issuerContext.binanceChainId) {
    const issuer = await getOndoIssuerReference(issuerContext.tokenContractAddress, issuerContext.binanceChainId);
    if (issuer.reference) {
      return { issuerReference: issuer.reference };
    }
    return { unavailableReason: `Pyth was unavailable, and the Ondo issuer reference fallback also failed: ${issuer.unavailableReason}` };
  }

  return { unavailableReason: "Both primary and fallback Pyth reference feeds were unreachable, and no issuer reference fallback applies to this wrapper." };
}
