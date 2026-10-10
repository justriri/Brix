import { getSmartRouterTrade } from "@/lib/invest/spotPurchaseClient";
import type { CandidateGroup } from "@/lib/invest/intelligence/intelligenceTypes.ts";
import { runAssistantAction, type AssistantDependencies } from "./assistantActions.ts";
import { isLlmConfigured, rephraseWithLlm } from "./llmClient.ts";
import type { AssistantResponse } from "./assistantTypes.ts";

/**
 * The one real-wiring layer: assembles the REAL AssistantDependencies
 * (spotPurchaseClient.ts's getSmartRouterTrade — the SAME function
 * BuySpotPanel.tsx uses, so the assistant's "live quote" reply is backed by
 * PancakeSwap's real Smart Router route, never a price-feed estimate or a
 * hand-picked pool) and calls the testable, dependency-free
 * assistantActions.ts. Not unit-tested directly for the same reason
 * binanceRwaQuote.ts (the real async orchestrator sibling pattern elsewhere
 * in this codebase) isn't — it's pure wiring, the actual decision logic it
 * calls already has full coverage.
 */
const REAL_DEPENDENCIES: AssistantDependencies = {
  getSmartRouterTrade,
};

/**
 * Top-level entry point: deterministic action first (always correct, always
 * works), optional LLM rephrasing second (cosmetic only — see llmClient.ts).
 * `groundedFacts` is identical regardless of which path produced `reply`;
 * only the wording can differ.
 */
export async function respondToAssistantMessage(message: string, groups: CandidateGroup[], dataFetchedAt: number): Promise<AssistantResponse> {
  const { reply: deterministicReply, groundedFacts } = await runAssistantAction(message, groups, dataFetchedAt, REAL_DEPENDENCIES);

  if (!isLlmConfigured()) {
    return { reply: deterministicReply, groundedFacts, usedLanguageModel: false };
  }

  const rephrased = await rephraseWithLlm(message, deterministicReply, groundedFacts);
  if (rephrased === null) {
    return { reply: deterministicReply, groundedFacts, usedLanguageModel: false };
  }
  return { reply: rephrased, groundedFacts, usedLanguageModel: true };
}
