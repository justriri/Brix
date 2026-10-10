import type { Address } from "viem";
import { formatUnits } from "viem";
import {
  BSTOCKS_TOKENS,
  ONDO_TOKENS,
  SUPPORTED_TICKERS,
  XSTOCKS_TOKENS_CONFIRMED_BSC,
  type BscTokenEntry,
  type SupportedTicker,
} from "@/lib/config/assets";
import { getErc20Balance, getErc20Decimals } from "@/lib/chain";
import { getBstocksStock } from "@/lib/providers/bstocks";
import { getOndoStock } from "@/lib/providers/ondo";
import { getXstocksStock } from "@/lib/providers/xstocks";
import type { Position, Wrapper } from "@/lib/types";
import { isWeekendGuardError } from "@/lib/errors";

/**
 * Position detection: connect wallet -> read balances -> identify
 * tokenized-stock assets -> map token -> wrapper -> underlying ticker ->
 * return the user's actual positions.
 *
 * Scoped to the verified MVP registry (see lib/config/assets.ts) rather
 * than a large asset universe, per the build brief. xStocks is included
 * ONLY for tickers with a confirmed BSC contract address (currently TSLA
 * only) — see providers/xstocks.ts for why AAPL/NVDA are not assumed to
 * exist on BSC just because the other two wrappers' tickers do.
 */
export interface PositionScanResult {
  positions: Position[];
  warnings: string[];
}

interface ScanJob {
  ticker: SupportedTicker;
  wrapper: Wrapper;
  entry: BscTokenEntry;
}

function buildScanJobs(): ScanJob[] {
  const jobs: ScanJob[] = [];
  for (const ticker of SUPPORTED_TICKERS) {
    jobs.push({ ticker, wrapper: "bstocks", entry: BSTOCKS_TOKENS[ticker] });
    jobs.push({ ticker, wrapper: "ondo", entry: ONDO_TOKENS[ticker] });
    const xstocksEntry = XSTOCKS_TOKENS_CONFIRMED_BSC[ticker];
    if (xstocksEntry) jobs.push({ ticker, wrapper: "xstocks", entry: xstocksEntry });
  }
  return jobs;
}

async function getStockFor(wrapper: Wrapper, ticker: SupportedTicker) {
  if (wrapper === "bstocks") return getBstocksStock(ticker);
  if (wrapper === "ondo") return getOndoStock(ticker);
  return getXstocksStock(ticker);
}

export async function scanPositions(owner: Address): Promise<PositionScanResult> {
  const warnings: string[] = [];
  const positions: Position[] = [];

  await Promise.all(
    buildScanJobs().map(async ({ ticker, wrapper, entry }) => {
      try {
        const [balanceRaw, decimals] = await Promise.all([
          getErc20Balance(entry.tokenAddress, owner),
          getErc20Decimals(entry.tokenAddress),
        ]);

        if (balanceRaw === BigInt(0)) return; // no position in this wrapper/ticker

        const balance = Number(formatUnits(balanceRaw, decimals));
        const stock = await getStockFor(wrapper, ticker);
        const usdValue = stock.price !== undefined ? balance * stock.price : undefined;

        positions.push({
          stock: { ...stock, decimals },
          balance,
          balanceRaw: balanceRaw.toString(),
          usdValue,
        });
      } catch (err) {
        warnings.push(
          isWeekendGuardError(err)
            ? `${entry.symbol}: ${err.message}`
            : `${entry.symbol}: unexpected error while scanning this position.`
        );
      }
    })
  );

  return { positions, warnings };
}
