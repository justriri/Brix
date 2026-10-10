"use client";

import { useEffect, useState } from "react";
import type { TokenizedStock } from "@/lib/types";
import { SAFETY_THRESHOLDS } from "@/lib/safety/thresholds";
import { toUserMessage } from "@/lib/errors";
import { ErrorBanner } from "@/components/ErrorBanner";

const HEALTH_DOT: Record<string, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  failed: "bg-red-500",
  unknown: "bg-zinc-500",
};

type LiquidityTier = "healthy" | "low" | "unavailable";

/**
 * Only ONE liquidity threshold exists in this codebase
 * (SAFETY_THRESHOLDS.MIN_LIQUIDITY_USD, the same number the real Safety
 * Gate liquidity check uses) — reused here rather than inventing a second,
 * arbitrary cutoff just to manufacture a "moderate" middle tier. "Low"
 * covers everything below it that was actually measured; "unavailable"
 * covers rows where no TVL figure came back from any source at all (never
 * treated as healthy just because the data is missing).
 */
function liquidityTier(liquidityUsd: number | undefined): LiquidityTier {
  if (liquidityUsd === undefined) return "unavailable";
  return liquidityUsd >= SAFETY_THRESHOLDS.MIN_LIQUIDITY_USD ? "healthy" : "low";
}

const TIER_LABEL: Record<LiquidityTier, string> = {
  healthy: "Healthy liquidity",
  low: "Low liquidity",
  unavailable: "Liquidity unavailable",
};

const TIER_DOT: Record<LiquidityTier, string> = {
  healthy: "bg-emerald-500",
  low: "bg-amber-500",
  unavailable: "bg-zinc-500",
};

/**
 * Live cross-wrapper market table — visible before any wallet is connected,
 * so a demo/judge can immediately see real bStocks/Ondo BSC data (and the
 * xStocks reference-only price) side by side, per underlying.
 */
export function MarketOverview() {
  const [stocks, setStocks] = useState<TokenizedStock[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/market")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setStocks(data.stocks);
      })
      .catch((err) => !cancelled && setError(toUserMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!stocks) {
    return <p className="text-sm text-muted-2">Loading live market data…</p>;
  }

  const byTicker = new Map<string, TokenizedStock[]>();
  for (const s of stocks) {
    byTicker.set(s.underlying, [...(byTicker.get(s.underlying) ?? []), s]);
  }

  // Aggregated from the SAME rows the table below renders — never a
  // separately hardcoded count — so "N markets have healthy liquidity"
  // always matches what's actually in the data right now.
  const tierCounts: Record<LiquidityTier, number> = { healthy: 0, low: 0, unavailable: 0 };
  for (const s of stocks) tierCounts[liquidityTier(s.liquidityUsd)] += 1;

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-subtle bg-surface-2 px-3 py-2 text-xs">
        {(["healthy", "low", "unavailable"] as LiquidityTier[])
          .filter((tier) => tierCounts[tier] > 0)
          .map((tier) => (
            <span key={tier} className="inline-flex items-center gap-1.5 text-muted-2">
              <span className={`h-2 w-2 rounded-full ${TIER_DOT[tier]}`} />
              {tierCounts[tier]} {TIER_LABEL[tier].toLowerCase()}
            </span>
          ))}
      </div>
      <p className="border-b border-border-subtle bg-surface-2 px-3 py-1.5 text-xs text-muted-2">
        &quot;Health&quot; below reflects whether this quick overview could fetch live data for each row — it is NOT
        the full Safety Gate (liquidity, price freshness, independent reference, cross-wrapper, market status). See
        Markets above for the full Safety Gate result per asset.
      </p>
      <table className="min-w-full divide-y divide-border-subtle text-sm">
        <thead className="bg-surface-2">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-2">Underlying</th>
            <th className="px-3 py-2 text-left font-medium text-muted-2">Wrapper</th>
            <th className="px-3 py-2 text-right font-medium text-muted-2">Price</th>
            <th className="px-3 py-2 text-right font-medium text-muted-2">Liquidity</th>
            <th className="px-3 py-2 text-left font-medium text-muted-2">Health</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {[...byTicker.entries()].flatMap(([ticker, wrappers]) =>
            wrappers.map((w) => (
              <tr key={`${ticker}-${w.wrapper}`}>
                <td className="px-3 py-2 font-medium">{ticker}</td>
                <td className="px-3 py-2 capitalize text-muted-2 ">{w.wrapper}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {w.price !== undefined ? `$${w.price.toFixed(2)}` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${TIER_DOT[liquidityTier(w.liquidityUsd)]}`} />
                    {w.liquidityUsd !== undefined ? `$${Math.round(w.liquidityUsd).toLocaleString()}` : "—"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${HEALTH_DOT[w.health]}`} />
                    {w.health}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
