import { ONDO_TOKENS, type SupportedTicker } from "@/lib/config/assets";
import { buildBscWrapperStock } from "@/lib/providers/wrapperCommon";
import type { TokenizedStock } from "@/lib/types";

/**
 * Ondo Global Markets provider. Ondo does publish an official API
 * (api.gm.ondo.finance) per the research report, but it is API-key gated
 * and no key is configured for this build — so, per the brief's "clean
 * provider interface + labelled fallback" instruction, we use the same
 * live DexScreener PancakeSwap data used for bStocks instead of pretending
 * to call the gated API.
 *
 * Known gap, surfaced via `notes`: Ondo's token price is
 * underlying x SyntheticSharesOracle multiplier, not a fixed 1:1 share
 * peg — a raw DEX price is the traded price, which already embeds that
 * multiplier, so no extra adjustment is needed here, but it does mean
 * Ondo's price is not directly "shares outstanding" comparable across time
 * the way a non-rebasing token would be.
 */
export async function getOndoStock(ticker: SupportedTicker): Promise<TokenizedStock> {
  const entry = ONDO_TOKENS[ticker];
  const stock = await buildBscWrapperStock(ticker, entry, "ondo");
  return {
    ...stock,
    notes: [
      ...(stock.notes ?? []),
      "Ondo's official priced API (api.gm.ondo.finance) requires an API key that is not configured; using live DEX data instead of calling it.",
    ],
  };
}
