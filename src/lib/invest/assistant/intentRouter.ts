import type { CandidateGroup } from "@/lib/invest/intelligence/intelligenceTypes";
import type { AssistantIntent } from "./assistantTypes";

/**
 * Pure, deterministic intent classification — zero ML, zero LLM call, zero
 * network access. Grounded directly in the LIVE `groups` the caller already
 * fetched (not a hardcoded ticker/symbol list): a ticker or wrapper symbol
 * is only ever recognized if it's genuinely present in the current
 * intelligence data, so this never "recognizes" an asset that isn't
 * actually available right now.
 *
 * This is deliberately a plain regex/keyword matcher, not a second LLM
 * call, for two reasons: (1) build brief §17 — "do not add a large agent
 * framework" / keep it lightweight, and (2) the specific intents that MUST
 * never be computed by an LLM (quote-preview, purchase preparation) need a
 * reliable, testable extraction path that doesn't depend on model behavior
 * or an API key being configured at all — this router works identically
 * whether or not an LLM is available downstream.
 */

function findTickerMention(text: string, groups: CandidateGroup[]): string | undefined {
  const lower = text.toLowerCase();
  return groups.map((g) => g.underlying).find((ticker) => lower.includes(ticker.toLowerCase()));
}

/** Matches a wrapper either by name ("bstocks", "ondo") or by the live token symbol (e.g. "TSLAB", "TSLAon") — whichever the user actually typed. */
function findWrapperMention(text: string, group: CandidateGroup | undefined): string | undefined {
  if (!group) return undefined;
  const lower = text.toLowerCase();
  for (const w of group.wrappers) {
    if (lower.includes(w.wrapper.toLowerCase())) return w.wrapper;
    if (w.tokenSymbol && lower.includes(w.tokenSymbol.toLowerCase())) return w.wrapper;
  }
  return undefined;
}

function findDollarAmount(text: string): number | undefined {
  const match = text.match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:usd|usdt|usdc|dollars?)\b/i);
  if (!match) return undefined;
  const amount = Number(match[1] ?? match[2]);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

export function routeIntent(message: string, groups: CandidateGroup[]): AssistantIntent {
  const lower = message.toLowerCase();
  const ticker = findTickerMention(message, groups);
  const group = groups.find((g) => g.underlying === ticker);
  const wrapper = findWrapperMention(message, group);
  const amountUsd = findDollarAmount(message);

  if (/\b(what|which)\b.*\b(available|stocks|tokeni[sz]ed)\b/.test(lower) || /\blist\b.*\bavailable\b/.test(lower)) {
    return { type: "list-available" };
  }

  if (amountUsd !== undefined && (ticker || wrapper)) {
    if (!ticker) return { type: "unresolved", reason: "A dollar amount was mentioned, but no recognized ticker or wrapper symbol was found in the message." };
    return { type: "quote-preview", ticker, wrapper, amountUsd };
  }

  if (/\bcompare\b/.test(lower)) {
    if (!ticker) return { type: "unresolved", reason: "A comparison was requested, but no recognized ticker was found in the message." };
    return { type: "compare-wrappers", ticker };
  }

  if (/\b(why|fail|blocked|available to buy|safe to buy|check before buying|status)\b/.test(lower)) {
    if (!ticker) return { type: "unresolved", reason: "A status question was asked, but no recognized ticker was found in the message." };
    return { type: "explain-status", ticker, wrapper };
  }

  return { type: "general", question: message };
}
