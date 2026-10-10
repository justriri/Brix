import type { CandidateEvaluation, CandidateGroup, WrapperComparison } from "@/lib/invest/intelligence/intelligenceTypes";
import type { PurchaseQuote } from "@/lib/invest/spotPurchaseCore";

/**
 * AI Investment Assistant — DECISION SUPPORT, NOT AN AUTONOMOUS TRADING
 * AGENT (build brief Phase 2 §7, hard requirement). Every type below
 * reflects that boundary directly in its shape:
 *   - `AssistantIntent` has no "execute"/"sign"/"submit" variant at all —
 *     structurally, there is no intent this router can produce that an
 *     action handler could interpret as "move funds."
 *   - `PurchasePreparation` carries a real, already-computed `PurchaseQuote`
 *     (from the EXISTING, unmodified spotPurchaseCore.ts) plus the ticker/
 *     wrapper/amount to hand to the EXISTING BuySpotPanel — never a
 *     transaction hash, never a signature, never wallet state.
 */

export type AssistantIntent =
  | { type: "list-available" }
  | { type: "compare-wrappers"; ticker: string }
  | { type: "explain-status"; ticker: string; wrapper?: string }
  | { type: "quote-preview"; ticker: string; wrapper?: string; amountUsd: number }
  | { type: "general"; question: string }
  | { type: "unresolved"; reason: string };

export interface PurchasePreparation {
  ticker: string;
  wrapper: string;
  amountUsd: number;
  /** A real, already-computed quote (spotPurchaseCore.ts, unmodified) — the assistant never computes this itself, only requests it and reports the result. */
  quote: PurchaseQuote | null;
  /** Set when a quote could not be obtained (e.g. no trusted pool) — the assistant must say so, never invent a quote. */
  unavailableReason?: string;
}

export interface AssistantGroundedFacts {
  /** The exact CandidateEvaluation/CandidateGroup objects the reply was grounded in — included in the response so the reply is always auditable against real, current data, never trust-me prose. */
  groups?: CandidateGroup[];
  evaluation?: CandidateEvaluation;
  comparison?: WrapperComparison;
  purchasePreparation?: PurchasePreparation;
  /** Ms epoch when the underlying intelligence data was fetched — surfaced so a reply can never present stale data as current without saying so (build brief §12). */
  dataFetchedAt: number;
}

export interface AssistantResponse {
  reply: string;
  groundedFacts: AssistantGroundedFacts;
  /** True if an LLM rephrased the deterministic facts into `reply`; false if the deterministic template was used as-is (e.g. no API key configured). Both paths ground `reply` in the same `groundedFacts` — never a difference in underlying numbers, only in phrasing. */
  usedLanguageModel: boolean;
}
