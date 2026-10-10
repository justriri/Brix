import { getDexScreenerSummary } from "@/lib/providers/dexscreener";
import { getReferenceForTicker } from "@/lib/providers/reference";
import { getErc20Decimals } from "@/lib/chain";
import { getUsEquityMarketStatus } from "@/lib/marketCalendar";
import { BSC_MAINNET_CHAIN_ID, type BscTokenEntry, type SupportedTicker } from "@/lib/config/assets";
import type { Health, MarketStatus, TokenizedStock, Wrapper } from "@/lib/types";
import { isWeekendGuardError } from "@/lib/errors";

/**
 * Shared assembly logic for any BSC-native wrapper (bStocks, Ondo) whose
 * price/liquidity comes from DexScreener and whose independent reference
 * comes from Pyth. Keeps bstocks.ts/ondo.ts to just their registry lookup.
 */
export async function buildBscWrapperStock(
  ticker: SupportedTicker,
  entry: BscTokenEntry,
  wrapper: Wrapper
): Promise<TokenizedStock> {
  const notes: string[] = [];
  let health: Health = "healthy";

  let price: number | undefined;
  let liquidityUsd: number | undefined;
  let volume24hUsd: number | undefined;
  let source = "dexscreener:pancakeswap";

  try {
    const summary = await getDexScreenerSummary(entry.tokenAddress);
    if (!summary) {
      health = "failed";
      notes.push(`No live DEX pair found for ${entry.symbol} on BSC — wrapper appears untradable right now.`);
    } else {
      price = summary.priceUsd;
      liquidityUsd = summary.liquidityUsd;
      volume24hUsd = summary.volume24hUsd;
      source = `dexscreener:${summary.dexId}`;
      if (!summary.tradedInLastHour) {
        notes.push("No swaps recorded in the trailing hour for this pool — treat wrapper liveness as unconfirmed.");
      }
    }
  } catch (err) {
    health = "failed";
    notes.push(
      isWeekendGuardError(err) ? err.message : "Unexpected error fetching DexScreener data."
    );
  }

  let decimals: number | undefined;
  try {
    decimals = await getErc20Decimals(entry.tokenAddress);
  } catch {
    notes.push("Could not read token decimals from chain; balances involving this token may be inaccurate.");
  }

  const reference = await getReferenceForTicker(ticker, {
    wrapper,
    tokenContractAddress: entry.tokenAddress,
    binanceChainId: String(BSC_MAINNET_CHAIN_ID),
  });
  const referenceSource = reference.primary ?? reference.fallback ?? reference.issuerReference;
  if (!referenceSource) {
    notes.push(reference.unavailableReason ?? "No independent reference price available.");
    if (health === "healthy") health = "warning";
  }

  const marketStatusCalc = getUsEquityMarketStatus();
  const marketStatus: MarketStatus = marketStatusCalc.isOpen ? "open" : "closed";

  const priceAgeSeconds = referenceSource
    ? Math.max(0, Math.floor(Date.now() / 1000) - referenceSource.publishTimeSec)
    : undefined;

  return {
    underlying: ticker,
    name: entry.name,
    wrapper,
    chain: "bsc",
    tokenAddress: entry.tokenAddress,
    decimals,
    price,
    referencePrice: referenceSource?.price,
    referenceSource,
    priceAgeSeconds,
    liquidityUsd,
    volume24hUsd,
    marketStatus,
    source,
    health,
    notes: notes.length ? notes : undefined,
  };
}
