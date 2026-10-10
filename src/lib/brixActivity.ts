/**
 * Client-only, localStorage-backed activity log + per-position lifecycle
 * flags. This is NOT a new backend — it is the same "per-viewer browser
 * storage" pattern already used elsewhere in this app, applied to two
 * things the UI needs that the backend has no reason to track centrally:
 *
 * 1. A real transaction history ("Activity" nav section) — every entry is
 *    recorded ONLY when an existing component (BuySpotPanel, SettlementDemo)
 *    gets back a REAL tx hash or a REAL quote from an EXISTING endpoint.
 *    Nothing here fabricates a transaction or amount.
 * 2. Whether THIS browser has, this session, taken a given position
 *    (`wrapper:underlying`) through a "protection quote generated" step —
 *    used only to show an honest Portfolio lifecycle hint ("Quote
 *    generated" vs "Not started"). It never claims a position is under an
 *    ACTIVE real policy unless SettlementDemo's own on-chain flow recorded
 *    that specific outcome.
 *
 * Safe no-ops on the server or when storage is unavailable (private
 * browsing, blocked site data) — wrapped in try/catch, per this app's
 * existing browser-storage conventions.
 */

export type ActivityType =
  | "approve"
  | "buy"
  | "sell"
  | "protection-quote"
  | "settlement-approve"
  | "settlement-fund-reserve"
  | "settlement-withdraw-reserve"
  | "settlement-activate"
  | "settlement-authorize"
  | "settlement-resolve"
  | "settlement-claim";

export interface ActivityEntry {
  type: ActivityType;
  label: string;
  /** Null for non-transaction events (e.g. a protection quote is a read, not a tx). */
  hash: string | null;
  timestamp: number;
}

const ACTIVITY_KEY = "brix:activity";
const PROTECTION_KEY = "brix:protectionQuoted";
const MAX_ENTRIES = 50;

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private browsing, blocked, quota) — this log is
    // a convenience, not a system of record, so we drop the write silently.
  }
}

export function recordActivity(entry: Omit<ActivityEntry, "timestamp">): void {
  if (typeof window === "undefined") return;
  const existing = safeRead<ActivityEntry[]>(ACTIVITY_KEY, []);
  const next = [{ ...entry, timestamp: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
  safeWrite(ACTIVITY_KEY, next);
}

export function getActivity(): ActivityEntry[] {
  if (typeof window === "undefined") return [];
  return safeRead<ActivityEntry[]>(ACTIVITY_KEY, []);
}

export function recordProtectionQuoted(positionKey: string): void {
  if (typeof window === "undefined") return;
  const existing = safeRead<Record<string, number>>(PROTECTION_KEY, {});
  safeWrite(PROTECTION_KEY, { ...existing, [positionKey]: Date.now() });
}

export function isProtectionQuoted(positionKey: string): boolean {
  if (typeof window === "undefined") return false;
  const existing = safeRead<Record<string, number>>(PROTECTION_KEY, {});
  return Boolean(existing[positionKey]);
}
