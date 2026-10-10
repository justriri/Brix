import dns from "node:dns";
// Relative, with explicit .ts extension — same convention as
// issuerReference.ts/settlementContractReader.ts, so this module stays
// directly importable by Node's test runner (pyth.test.mts), not just
// Next's bundler (which resolves the @/ alias on its own).
import { WeekendGuardError } from "../errors.ts";
import type { ReferenceSource } from "../types.ts";

/**
 * Pyth Network Hermes client.
 *
 * Two endpoints are used, with genuinely different auth requirements —
 * verified live during this build session (2026-09-29), not assumed:
 *
 * 1. Feed metadata/search — `GET hermes.pyth.network/v2/price_feeds?query=...`
 *    Confirmed working with NO API key. Used only to resolve feed ids
 *    (already done once, see lib/config/assets.ts — PYTH_FEEDS).
 *
 * 2. Latest price — `GET https://pyth.dourolabs.app/hermes/v2/updates/price/latest?ids[]=...`
 *    Confirmed to require `Authorization: Bearer <PYTH_API_KEY>` as of the
 *    Aug 26 2026 "Pyth Core" upgrade (unauthenticated requests return
 *    HTTP 401, reproduced live during this build against a well-known
 *    BTC/USD feed, not just the equity feeds). Source:
 *    https://docs.pyth.network/price-feeds/core/fetch-price-updates
 *
 * If PYTH_API_KEY is not set, getPythLatestPrice throws a typed
 * MISSING_CREDENTIALS error rather than returning fabricated data — the
 * caller (providers/*.ts) is responsible for surfacing that as a clearly
 * labelled "unavailable" state, per the "do not pretend mock data is real"
 * rule.
 *
 * DNS fix (same class of issue as providers/binanceRwa.ts, live-reproduced
 * during this investigation): under a long-running Node process on this
 * network, calls to pyth.dourolabs.app intermittently failed with "The
 * request took too long to respond" even though a freshly-spawned process
 * hitting the exact same URL with the exact same key succeeded
 * immediately — the same dual-stack getaddrinfo race binanceRwa.ts already
 * documented and fixed for web3.binance.com. Applying the identical,
 * harmless, process-wide ipv4-first preference here closes the same gap
 * for this host.
 */
dns.setDefaultResultOrder("ipv4first");

const HERMES_LATEST_PRICE_URL = "https://pyth.dourolabs.app/hermes/v2/updates/price/latest";

interface HermesParsedPrice {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
  ema_price: { price: string; conf: string; expo: number; publish_time: number };
}

interface HermesLatestPriceResponse {
  parsed: HermesParsedPrice[];
}

function toDecimal(raw: string, expo: number): number {
  return Number(raw) * Math.pow(10, expo);
}

/**
 * Fetches the latest price for one Pyth feed id. `label` is used only to
 * build a human-readable ReferenceSource.name (e.g. "Pyth Equity.US.TSLA/USD").
 */
export async function getPythLatestPrice(
  feedId: string,
  label: string,
  opts?: { isAlwaysOn?: boolean }
): Promise<ReferenceSource> {
  const apiKey = process.env.PYTH_API_KEY;
  if (!apiKey) {
    throw new WeekendGuardError(
      "MISSING_CREDENTIALS",
      "PYTH_API_KEY is not configured; cannot fetch live Pyth prices",
      { feedId }
    );
  }

  let res: Response;
  try {
    res = await fetch(`${HERMES_LATEST_PRICE_URL}?ids%5B%5D=${feedId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    throw new WeekendGuardError("API_UNAVAILABLE", "Pyth Hermes request failed", { err, feedId });
  }

  if (res.status === 401 || res.status === 403) {
    throw new WeekendGuardError("MISSING_CREDENTIALS", "Pyth Hermes rejected the configured API key", {
      feedId,
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new WeekendGuardError("RATE_LIMITED", "Pyth Hermes rate limit hit", { feedId });
  }
  if (!res.ok) {
    throw new WeekendGuardError("API_UNAVAILABLE", `Pyth Hermes returned HTTP ${res.status}`, {
      feedId,
    });
  }

  let data: HermesLatestPriceResponse;
  try {
    data = (await res.json()) as HermesLatestPriceResponse;
  } catch (err) {
    // A malformed/truncated response body (observed, elsewhere in this
    // codebase, to happen under upstream proxy issues) must surface as the
    // same typed "API unavailable" case as every other Hermes failure mode
    // above — not escape as a raw, untyped SyntaxError. An untyped error
    // here previously bypassed reference.ts's isWeekendGuardError() check
    // and got rethrown uncaught, which could crash the ENTIRE market
    // overview (every ticker, not just this one feed) rather than just
    // this one reference lookup.
    throw new WeekendGuardError("API_UNAVAILABLE", "Pyth Hermes returned an unparseable response", { feedId, err });
  }
  const parsed = data.parsed?.[0];
  if (!parsed) {
    throw new WeekendGuardError("MISSING_REFERENCE_PRICE", "Pyth Hermes returned no price for feed", {
      feedId,
    });
  }

  return {
    name: `Pyth ${label}`,
    price: toDecimal(parsed.price.price, parsed.price.expo),
    publishTimeSec: parsed.price.publish_time,
    confidence: toDecimal(parsed.price.conf, parsed.price.expo),
    isAlwaysOn: opts?.isAlwaysOn ?? false,
  };
}

/** True when a Pyth API key is configured, so callers can decide whether to attempt a live call at all. */
export function isPythConfigured(): boolean {
  return Boolean(process.env.PYTH_API_KEY);
}
