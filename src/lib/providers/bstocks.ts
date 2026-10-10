import { BSTOCKS_TOKENS, type SupportedTicker } from "@/lib/config/assets";
import { buildBscWrapperStock } from "@/lib/providers/wrapperCommon";
import type { TokenizedStock } from "@/lib/types";

/**
 * bStocks provider. No official public API is documented for bStocks (see
 * research report) — price/liquidity comes from live PancakeSwap pool data
 * via DexScreener, which is the same approach bStocks' own users rely on.
 *
 * Known gap, surfaced via `notes` rather than hidden: bStocks tokens rebase
 * on dividend payment, and no pause/freeze mechanism is documented for them
 * anywhere public — see providers/wrapperCommon.ts + safety/wrapperHealth
 * usage for how that absence-of-information is handled (treated as
 * "cannot confirm unpaused", not as "confirmed healthy").
 */
export async function getBstocksStock(ticker: SupportedTicker): Promise<TokenizedStock> {
  const entry = BSTOCKS_TOKENS[ticker];
  const stock = await buildBscWrapperStock(ticker, entry, "bstocks");
  return {
    ...stock,
    notes: [
      ...(stock.notes ?? []),
      "bStocks has no documented pause/freeze mechanism or named oracle (research report) — health here reflects live DEX data only.",
    ],
  };
}
