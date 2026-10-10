import type { CheckResult, TokenizedStock } from "@/lib/types";
import { SAFETY_THRESHOLDS } from "./thresholds.ts";

/**
 * HARD check: does this wrapper's pool carry enough total value locked
 * (TVL) to treat it as a real, non-trivial market, given the threshold?
 *
 * IMPORTANT — what this check actually measures (per the liquidity
 * investigation): `stock.liquidityUsd` is POOL TVL (both sides of a DEX
 * pool combined, confirmed by reconstructing DexScreener's `liquidity.usd`
 * arithmetically from live reserve data), NOT executable depth, NOT
 * available size within any price-impact limit, and NOT a guarantee that
 * the full amount is tradeable at the current price — especially for a
 * concentrated-liquidity (V3-style) pool, where TVL can be concentrated
 * far from the current price. The label/messages below say "Pool TVL"
 * deliberately, never "liquidity available" or "executable size", so the
 * UI never overclaims what was actually measured.
 *
 * Also doubles as the "wrapper health" signal: if we positively tried and
 * failed to get a reading (health === "failed", e.g. no DEX pair found),
 * that is a genuine FAIL, not an unknown — an unreachable/untradable
 * wrapper is not a safe one, per the pressure-test memo's "absence of
 * evidence is not evidence of liveness" principle.
 *
 * This is distinct from a source that simply never supplies a TVL figure
 * at all (e.g. Binance's RWA Data API — confirmed schema has no
 * liquidity/depth field; see providers/binanceRwaStock.ts for how a
 * separate, trusted-quote-filtered DexScreener lookup now fills this gap
 * for Binance-sourced stocks specifically). That case is UNKNOWN
 * (passed: null), not FAIL — we have no basis to say the TVL is good or
 * bad, only that this particular data source/attempt doesn't tell us.
 */
export function checkLiquidity(stock: TokenizedStock): CheckResult {
  if (stock.health === "failed") {
    return {
      id: "liquidity",
      label: "Pool TVL (trusted quote)",
      passed: false,
      severity: "hard",
      threshold: SAFETY_THRESHOLDS.MIN_LIQUIDITY_USD,
      message:
        "This wrapper's data source reported a failure (e.g. no live DEX pair) — treating pool TVL as failed, not merely unknown.",
    };
  }

  if (stock.liquidityUsd === undefined) {
    return {
      id: "liquidity",
      label: "Pool TVL (trusted quote)",
      passed: null,
      severity: "hard",
      threshold: SAFETY_THRESHOLDS.MIN_LIQUIDITY_USD,
      message: "No qualifying pool TVL figure is available from this data source — UNKNOWN, not assumed sufficient.",
    };
  }

  const passed = stock.liquidityUsd >= SAFETY_THRESHOLDS.MIN_LIQUIDITY_USD;
  const tvl = `$${Math.round(stock.liquidityUsd).toLocaleString()}`;
  const threshold = `$${SAFETY_THRESHOLDS.MIN_LIQUIDITY_USD.toLocaleString()}`;
  return {
    id: "liquidity",
    label: "Pool TVL (trusted quote)",
    passed,
    severity: "hard",
    value: Math.round(stock.liquidityUsd),
    threshold: SAFETY_THRESHOLDS.MIN_LIQUIDITY_USD,
    message: passed
      ? `Deepest qualifying BSC pool has ${tvl} total TVL against a trusted quote asset, above the ${threshold} threshold.`
      : `Deepest qualifying BSC pool has only ${tvl} total TVL against a trusted quote asset, below the ${threshold} threshold.`,
  };
}
