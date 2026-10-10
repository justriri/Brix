import { parseUnits, type Address } from "viem";
import type { TradeType } from "@pancakeswap/sdk";
import type { SmartRouterTrade } from "@pancakeswap/smart-router";
import { compareCandidates } from "../intelligence/compareCandidates.ts";
import type { CandidateEvaluation, CandidateGroup } from "../intelligence/intelligenceTypes.ts";
import { buildPurchaseQuote } from "../spotPurchaseCore.ts";
import { SMART_ROUTER_ADDRESS, DEFAULT_QUOTE_ASSET, describeRoute } from "../spotPurchaseClient.ts";
import { routeIntent } from "./intentRouter.ts";
import type { AssistantGroundedFacts, AssistantIntent, AssistantResponse, PurchasePreparation } from "./assistantTypes.ts";

/**
 * Thin async layer executing an `AssistantIntent` against REAL, live data —
 * the layer that makes "AI must not replace deterministic financial logic"
 * (build brief Phase 2 §8) concrete rather than aspirational. No intent
 * handler below computes a swap output, a minimum received, a balance, a
 * Safety Gate status, or a settlement/protection eligibility — each one
 * either reads already-computed CandidateEvaluation facts (from the
 * EXISTING, unmodified intelligence engine) or calls the EXISTING,
 * unmodified `buildPurchaseQuote()` (spotPurchaseCore.ts) for a quote
 * preview. The deterministic text template produced here is ALWAYS the
 * fallback reply (used as-is when no LLM is configured, or as the grounding
 * `groundedFacts` an LLM may rephrase — see assistantResponder.ts) — so the
 * assistant is fully functional with zero AI credentials configured.
 */

const SLIPPAGE_BPS = 50; // matches BuySpotPanel.tsx's own default — kept as one named constant here rather than re-guessing a different value

/**
 * Injectable I/O dependencies — REQUIRED (no default here), the same
 * pattern trustSnapshot.ts already established: this file must have ZERO
 * value-level `@/` imports from the real provider chain, so it stays
 * resolvable by Node's test runner directly. The REAL implementation
 * (spotPurchaseClient.ts's getSmartRouterTrade) is wired up in
 * assistantResponder.ts — the one real caller — not defaulted inside this
 * testable file.
 */
export interface AssistantDependencies {
  /** A live Smart Router quote/route for this exact trade — see spotPurchaseClient.ts's getSmartRouterTrade (the real implementation, wired in assistantResponder.ts). Required so this assistant's "live quote" claim is actually true, consistent with BuySpotPanel.tsx — same execution infrastructure, same function. */
  getSmartRouterTrade: (params: {
    amountIn: bigint;
    inputToken: { address: Address; decimals: number; symbol: string };
    outputToken: { address: Address; decimals: number; symbol: string };
  }) => Promise<SmartRouterTrade<TradeType> | null>;
}

function pickWrapper(group: CandidateGroup, wrapperHint: string | undefined): CandidateEvaluation | undefined {
  if (wrapperHint) return group.wrappers.find((w) => w.wrapper === wrapperHint);
  return group.wrappers.find((w) => w.operationalStatus === "PASS") ?? group.wrappers[0];
}

async function buildQuotePreview(
  ticker: string,
  wrapperHint: string | undefined,
  amountUsd: number,
  group: CandidateGroup,
  deps: AssistantDependencies
): Promise<PurchasePreparation> {
  const evaluation = pickWrapper(group, wrapperHint);
  if (!evaluation) {
    return { ticker, wrapper: wrapperHint ?? "unknown", amountUsd, quote: null, unavailableReason: `No wrapper data is currently available for ${ticker}.` };
  }
  if (!evaluation.tokenAddress || evaluation.facts.tokenPrice === undefined) {
    return { ticker, wrapper: evaluation.wrapper, amountUsd, quote: null, unavailableReason: "Token address or current price is unavailable for this wrapper right now." };
  }
  if (evaluation.facts.decimals === undefined) {
    return { ticker, wrapper: evaluation.wrapper, amountUsd, quote: null, unavailableReason: "This token's on-chain decimals are unknown — refusing to compute a quote rather than guess." };
  }

  const amountIn = parseUnits(String(amountUsd), DEFAULT_QUOTE_ASSET.decimals);
  const outputToken = { address: evaluation.tokenAddress as Address, symbol: evaluation.tokenSymbol, decimals: evaluation.facts.decimals };

  let trade: SmartRouterTrade<TradeType> | null;
  try {
    trade = await deps.getSmartRouterTrade({ amountIn, inputToken: DEFAULT_QUOTE_ASSET, outputToken });
  } catch (err) {
    return { ticker, wrapper: evaluation.wrapper, amountUsd, quote: null, unavailableReason: err instanceof Error ? err.message : "Could not read a live route right now." };
  }
  if (!trade) {
    return {
      ticker,
      wrapper: evaluation.wrapper,
      amountUsd,
      quote: null,
      unavailableReason: `No executable route was found from ${DEFAULT_QUOTE_ASSET.symbol} to ${evaluation.tokenSymbol} through PancakeSwap right now — this token may not have enough on-chain liquidity to buy.`,
    };
  }

  try {
    const quote = buildPurchaseQuote({
      quoteAmountInRaw: String(amountUsd),
      inputAsset: DEFAULT_QUOTE_ASSET,
      outputAsset: outputToken,
      quoteAssetPriceUsd: 1,
      stockPriceUsd: evaluation.facts.tokenPrice,
      routerAmountOut: trade.outputAmount.quotient,
      slippageBps: SLIPPAGE_BPS,
      routeDescription: describeRoute(trade),
      routerAddress: SMART_ROUTER_ADDRESS,
    });
    return { ticker, wrapper: evaluation.wrapper, amountUsd, quote };
  } catch (err) {
    return { ticker, wrapper: evaluation.wrapper, amountUsd, quote: null, unavailableReason: err instanceof Error ? err.message : "Could not build a quote for this amount." };
  }
}

function formatCheckList(evaluation: CandidateEvaluation): string {
  return evaluation.checks.map((c) => `${c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✗" : "?"} ${c.name}: ${c.status}`).join("\n");
}

function evaluationSummary(evaluation: CandidateEvaluation): string {
  const price = evaluation.facts.tokenPrice !== undefined ? `$${evaluation.facts.tokenPrice.toFixed(2)}` : "unavailable";
  return [
    `${evaluation.underlying} · ${evaluation.wrapper} (${evaluation.tokenSymbol})`,
    `Operational status: ${evaluation.operationalStatus}`,
    `Token price: ${price}`,
    formatCheckList(evaluation),
    evaluation.failedChecks.length > 0
      ? `Failed/unknown checks:\n${evaluation.failedChecks.map((c) => `- ${c.name}: ${c.message}`).join("\n")}`
      : "All checks currently pass.",
    "This reflects whether BRIX's existing operational checks currently pass — it is not an investment recommendation.",
  ].join("\n");
}

/**
 * Runs one intent against live data and produces the deterministic
 * fallback reply + the grounded facts an optional LLM may rephrase.
 * `dataFetchedAt` is always the timestamp of the `groups` the caller
 * supplied — never re-stamped here — so a stale fetch is always reported
 * as stale, never silently presented as fresh (build brief §12).
 */
export async function runAssistantAction(
  message: string,
  groups: CandidateGroup[],
  dataFetchedAt: number,
  deps: AssistantDependencies
): Promise<{ intent: AssistantIntent; reply: string; groundedFacts: AssistantGroundedFacts }> {
  const intent = routeIntent(message, groups);
  const groundedFacts: AssistantGroundedFacts = { dataFetchedAt };

  switch (intent.type) {
    case "list-available": {
      groundedFacts.groups = groups;
      if (groups.length === 0) {
        return { intent, reply: "No tokenized-stock candidates are currently available from live data.", groundedFacts };
      }
      const lines = groups.map((g) => {
        const wrapperSummaries = g.wrappers.map((w) => `${w.wrapper} (${w.tokenSymbol}): ${w.operationalStatus}`).join(", ");
        return `${g.underlying} — ${wrapperSummaries}`;
      });
      return {
        intent,
        reply: `Currently available tokenized-stock candidates (live data):\n${lines.join("\n")}\n\nThis lists operational status only, not an investment opinion.`,
        groundedFacts,
      };
    }

    case "compare-wrappers": {
      const group = groups.find((g) => g.underlying === intent.ticker);
      if (!group) {
        return { intent, reply: `${intent.ticker} is not currently available in live data.`, groundedFacts };
      }
      const comparison = compareCandidates(group.wrappers);
      groundedFacts.comparison = comparison;
      if (comparison.differences.length === 0) {
        return {
          intent,
          reply: `${intent.ticker} wrappers (${group.wrappers.map((w) => w.wrapper).join(", ")}) currently agree on every operational check.`,
          groundedFacts,
        };
      }
      return {
        intent,
        reply: `${intent.ticker} wrapper differences (live data):\n${comparison.differences.map((d) => `- ${d.description}`).join("\n")}\n\nThis states the concrete operational differences only — it does not pick a "better" wrapper.`,
        groundedFacts,
      };
    }

    case "explain-status": {
      const group = groups.find((g) => g.underlying === intent.ticker);
      if (!group) {
        return { intent, reply: `${intent.ticker} is not currently available in live data.`, groundedFacts };
      }
      const evaluation = pickWrapper(group, intent.wrapper);
      if (!evaluation) {
        return { intent, reply: `No wrapper data is currently available for ${intent.ticker}.`, groundedFacts };
      }
      groundedFacts.evaluation = evaluation;
      return { intent, reply: evaluationSummary(evaluation), groundedFacts };
    }

    case "quote-preview": {
      const group = groups.find((g) => g.underlying === intent.ticker);
      if (!group) {
        return { intent, reply: `${intent.ticker} is not currently available in live data.`, groundedFacts };
      }
      const prep = await buildQuotePreview(intent.ticker, intent.wrapper, intent.amountUsd, group, deps);
      groundedFacts.purchasePreparation = prep;
      if (!prep.quote) {
        return {
          intent,
          reply: `A $${intent.amountUsd} purchase of ${intent.ticker} (${prep.wrapper}) is not currently available: ${prep.unavailableReason}`,
          groundedFacts,
        };
      }
      const q = prep.quote;
      const received = (Number(q.expectedAmountOut) / 10 ** q.outputAsset.decimals).toFixed(6);
      const minReceived = (Number(q.minAmountOut) / 10 ** q.outputAsset.decimals).toFixed(6);
      return {
        intent,
        reply: [
          `Live quote for $${intent.amountUsd} of ${prep.wrapper} ${q.outputAsset.symbol}:`,
          `Pay: ${intent.amountUsd} ${q.inputAsset.symbol}`,
          `Estimated received: ≈ ${received} ${q.outputAsset.symbol}`,
          `Minimum received (${(q.slippageBps / 100).toFixed(2)}% slippage): ${minReceived} ${q.outputAsset.symbol}`,
          `Quote expires: ${new Date(q.expiresAt).toLocaleTimeString()}`,
          "This is a real, live quote from the same pricing path BuySpotPanel uses — opening Buy Spot will fetch a fresh one before you sign anything.",
        ].join("\n"),
        groundedFacts,
      };
    }

    case "unresolved":
      return { intent, reply: `I couldn't quite parse that: ${intent.reason} Try naming a ticker (e.g. TSLA) or a wrapper symbol (e.g. TSLAB).`, groundedFacts };

    case "general":
    default:
      groundedFacts.groups = groups;
      return {
        intent,
        reply:
          "I can tell you what's currently available, compare wrappers for a ticker, explain why something passed or failed BRIX's Safety Gate, or give you a live purchase quote (e.g. \"what would $10 of TSLAB get me?\"). I don't give investment advice or guarantee outcomes.",
        groundedFacts,
      };
  }
}

export type { AssistantResponse };
