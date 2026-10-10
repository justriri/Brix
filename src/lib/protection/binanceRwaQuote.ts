import type { Address } from "viem";
import { formatUnits } from "viem";
import { getErc20Balance, getErc20Decimals } from "@/lib/chain";
import { getIllustrativeRatePercent } from "@/lib/protection/premiumTiers";
import { getNextMarketOpen } from "@/lib/marketCalendar";
import { buildBinanceRwaProtectionQuoteCore } from "@/lib/protection/binanceRwaQuoteCore";
import type { BinanceRwaAssessment } from "@/lib/agent/binanceRwaRiskMonitor";
import type { ProtectionQuote } from "@/lib/types";
import { isWeekendGuardError } from "@/lib/errors";

/**
 * Async orchestration for the Binance-RWA-sourced weekend protection quote:
 * reads the user's REAL on-chain balance of the already-identified wrapper
 * token (via the existing lib/chain.ts primitives — NOT a modification of
 * or duplicate of lib/agent/positionScanner.ts, which remains untouched),
 * looks up the illustrative premium rate and next-market-open expiry via
 * the existing, unmodified lib/protection/premiumTiers.ts and
 * lib/marketCalendar.ts, and hands everything to the pure, unit-tested
 * buildBinanceRwaProtectionQuoteCore() (binanceRwaQuoteCore.ts) to
 * deterministically assemble the quote.
 *
 * Still a demo/simulation layer: reads a balance (read-only RPC call) and
 * computes numbers — never signs, sends, or requests a transaction, never
 * collects a premium, never calls anything in lib/protection/policy.ts
 * (which remains fully disabled and untouched).
 */

export interface BinanceRwaProtectionQuoteResponse {
  positionAmount: number;
  positionValueUsd: number;
  eligible: boolean;
  reason: string;
  quote: ProtectionQuote | null;
}

export async function getBinanceRwaProtectionQuote(
  assessment: BinanceRwaAssessment,
  walletAddress: Address,
  thresholdPercent: number
): Promise<BinanceRwaProtectionQuoteResponse> {
  const tokenAddress = assessment.stock.tokenAddress as Address | undefined;
  if (!tokenAddress) {
    return {
      positionAmount: 0,
      positionValueUsd: 0,
      eligible: false,
      reason: "No on-chain token address is available for this wrapper.",
      quote: null,
    };
  }

  let positionAmount: number;
  try {
    const [balanceRaw, decimals] = await Promise.all([
      getErc20Balance(tokenAddress, walletAddress),
      getErc20Decimals(tokenAddress),
    ]);
    positionAmount = Number(formatUnits(balanceRaw, decimals));
  } catch (err) {
    return {
      positionAmount: 0,
      positionValueUsd: 0,
      eligible: false,
      reason: isWeekendGuardError(err)
        ? `Could not read your on-chain balance: ${err.message}`
        : "Could not read your on-chain balance.",
      quote: null,
    };
  }

  const positionValueUsd = assessment.stock.price !== undefined ? positionAmount * assessment.stock.price : 0;

  if (!(positionAmount > 0)) {
    return {
      positionAmount,
      positionValueUsd,
      eligible: false,
      reason: `No ${assessment.stock.wrapper} ${assessment.stock.underlying} position was detected in this wallet.`,
      quote: null,
    };
  }

  if (assessment.safetyGateResult.status !== "PASS") {
    return {
      positionAmount,
      positionValueUsd,
      eligible: false,
      reason: `Protection is not offered: Safety Gate status is ${assessment.safetyGateResult.status}, not PASS.`,
      quote: null,
    };
  }

  const premiumRatePercent = getIllustrativeRatePercent(thresholdPercent);
  const expiresAt = getNextMarketOpen().getTime();

  const core = buildBinanceRwaProtectionQuoteCore({
    underlying: assessment.stock.underlying,
    wrapper: assessment.stock.wrapper,
    safetyGateStatus: assessment.safetyGateResult.status,
    positionAmount,
    positionValueUsd,
    thresholdPercent,
    premiumRatePercent,
    expiresAt,
  });

  if (!core) {
    // Should be unreachable given the checks above, but fail closed rather
    // than assert — never fabricate a quote the pure core itself declined.
    return {
      positionAmount,
      positionValueUsd,
      eligible: false,
      reason: "Quote could not be generated for this position.",
      quote: null,
    };
  }

  const quote: ProtectionQuote = {
    underlying: core.underlying,
    wrapper: assessment.stock.wrapper,
    coverageAmount: core.coverageAmount,
    thresholdPercent: core.thresholdPercent,
    premium: core.premium,
    expiresAt: core.expiresAt,
    safetyGateResult: assessment.safetyGateResult,
    isDevelopmentOnly: true,
    positionAmount: core.positionAmount,
    maxPayoutAmount: core.maxPayoutAmount,
    policyStatus: core.policyStatus,
    quotedAt: core.quotedAt,
    coveragePeriodLabel: core.coveragePeriodLabel,
  };

  return { positionAmount, positionValueUsd, eligible: true, reason: "Safety Gate passed.", quote };
}
