"use client";

import { useState } from "react";
import type { Address } from "viem";
import type { BinanceRwaAssessment } from "@/lib/agent/binanceRwaRiskMonitor";
import type { ProtectionQuote } from "@/lib/types";
import type { WalletState } from "@/lib/useWallet";
import { WarningBanner } from "@/components/ErrorBanner";
import { WeekendTrustScenarioDemo } from "@/components/WeekendTrustScenarioDemo";
import { LiveTrustSnapshot } from "@/components/LiveTrustSnapshot";
import { ProtectionSessionDemo } from "@/components/ProtectionSessionDemo";
import { SettlementDemo } from "@/components/SettlementDemo";
import { PurchaseProtectionButton } from "@/components/PurchaseProtectionButton";
import { FundReserveSection } from "@/components/FundReserveSection";
import { WithdrawReserveSection } from "@/components/WithdrawReserveSection";
import { toUserMessage } from "@/lib/errors";
import { recordActivity, recordProtectionQuoted } from "@/lib/brixActivity";

const THRESHOLD_OPTIONS = [3, 5, 10];

interface BinanceRwaQuoteResponse {
  positionAmount: number;
  positionValueUsd: number;
  eligible: boolean;
  reason: string;
  quote: ProtectionQuote | null;
}

/**
 * Weekend protection quote flow for a Binance-RWA-sourced assessment —
 * Position -> Safety Gate -> Protection Quote -> Activate, per the build
 * brief. Mirrors ProtectionPanel.tsx's existing visual style/structure
 * deliberately (same classes) rather than inventing a new look.
 * Activation is real (PurchaseProtectionButton, settlementContractClient.ts)
 * now that BNB Chain has confirmed this spot-only-compliant mechanism is
 * permitted — see PurchaseProtectionButton.tsx's own doc comment.
 */
export function BinanceRwaProtectionQuote({
  address,
  assessment,
  wallet,
}: {
  address: string;
  assessment: BinanceRwaAssessment;
  wallet: WalletState;
}) {
  const [thresholdPercent, setThresholdPercent] = useState(5);
  const [result, setResult] = useState<BinanceRwaQuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gatePassed = assessment.safetyGateResult.status === "PASS";

  async function fetchQuote() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/binance-rwa-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          wrapper: assessment.stock.wrapper,
          thresholdPercent,
          underlying: assessment.stock.underlying,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not get a quote.");
        return;
      }
      setResult(data);
      if (data.quote) {
        // Key format MUST match PositionCard.tsx and InvestmentIntelligencePanel.tsx's
        // own `${underlying}:${wrapper}` convention — this is how isProtectionQuoted()
        // finds the right flag across components.
        const key = `${assessment.stock.underlying}:${assessment.stock.wrapper}`;
        recordProtectionQuoted(key);
        recordActivity({
          type: "protection-quote",
          label: `Protection quote generated for ${assessment.stock.underlying} (${assessment.stock.wrapper})`,
          hash: null,
        });
      }
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-border-subtle bg-surface-2 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground">
          Protect — {assessment.stock.underlying} ({assessment.stock.wrapper})
        </p>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${gatePassed ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/30" : "bg-surface-3 text-muted"}`}>
          {gatePassed ? "Quote available" : "Not offered"}
        </span>
      </div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-2">
        State: {result?.quote ? "QUOTE GENERATED — not an active policy" : "NO QUOTE YET"}
      </p>

      <div className="mb-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FundReserveSection wallet={wallet} />
        <WithdrawReserveSection wallet={wallet} />
      </div>

      {!gatePassed && (
        <p className="text-xs text-muted-2">
          Not offered for this position right now — Safety Gate status is {assessment.safetyGateResult.status}, not
          PASS.
        </p>
      )}

      {gatePassed && (
        <>
          <div className="max-w-xs text-sm">
            <p className="text-muted-2">Weekend downside threshold</p>
            <select
              value={thresholdPercent}
              onChange={(e) => setThresholdPercent(Number(e.target.value))}
              className="mt-0.5 w-full rounded-lg border border-border-subtle bg-transparent px-2 py-1 text-foreground"
            >
              {THRESHOLD_OPTIONS.map((t) => (
                <option key={t} value={t} className="bg-surface">
                  {t}%
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={fetchQuote}
            disabled={loading}
            className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-50"
          >
            {loading ? "Getting quote…" : "Get development quote"}
          </button>
        </>
      )}

      {error && (
        <div className="mt-3">
          <WarningBanner message={error} />
        </div>
      )}

      {result && !result.eligible && (
        <div className="mt-3">
          <WarningBanner message={result.reason} />
        </div>
      )}

      {result?.quote && (
        <div className="mt-4 rounded-xl border border-border-subtle bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium text-foreground">Development quote</p>
            <span className="rounded-full bg-surface-3 px-2.5 py-0.5 text-xs font-semibold text-muted">Illustrative</span>
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-sm text-foreground/90">
            <dt className="text-muted-2">Position amount</dt>
            <dd className="text-right tabular-nums">
              {result.positionAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
              {assessment.stock.underlying}
            </dd>
            <dt className="text-muted-2">Position value</dt>
            <dd className="text-right tabular-nums">${result.positionValueUsd.toFixed(2)}</dd>
            <dt className="text-muted-2">Coverage period</dt>
            <dd className="text-right">{result.quote.coveragePeriodLabel ?? "—"}</dd>
            <dt className="text-muted-2">Downside threshold</dt>
            <dd className="text-right tabular-nums">{result.quote.thresholdPercent}%</dd>
            <dt className="text-muted-2">Premium</dt>
            <dd className="text-right tabular-nums text-brand">${result.quote.premium.toFixed(2)}</dd>
            <dt className="text-muted-2">Maximum payout</dt>
            <dd className="text-right tabular-nums text-brand">${(result.quote.maxPayoutAmount ?? 0).toFixed(2)}</dd>
            <dt className="text-muted-2">Policy status</dt>
            <dd className="text-right uppercase">{result.quote.policyStatus ?? "—"}</dd>
            <dt className="text-muted-2">Quoted at</dt>
            <dd className="text-right">
              {result.quote.quotedAt ? new Date(result.quote.quotedAt).toLocaleString() : "—"}
            </dd>
            <dt className="text-muted-2">Quote expires</dt>
            <dd className="text-right">{new Date(result.quote.expiresAt).toLocaleString()}</dd>
          </dl>

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-2 hover:text-muted">Technical details</summary>
            <p className="mt-2 text-xs text-muted-2">
              Maximum payout assumes full, binary coverage of the position&apos;s current value — a placeholder
              assumption, not real underwriting. Your {assessment.stock.underlying} position itself is never moved,
              transferred, or held by this quote; the Safety Gate only determines whether this position is eligible
              for the proposed policy. Activating below collects a real premium and opens a real on-chain policy
              against the deployed WeekendGuardSettlement contract — BNB Chain has confirmed this fixed-term,
              pre-funded, non-leveraged mechanism satisfies the hackathon&apos;s &quot;spot only&quot; rule.
            </p>
          </details>

          <PurchaseProtectionButton
            wallet={wallet}
            quote={result.quote}
            tokenizedStockContract={assessment.stock.tokenAddress as Address | undefined}
            wrapper={assessment.stock.wrapper}
            onPurchased={() => {}}
          />

          {/* Dev/demo surfaces only — never part of the real BRIX product a
              user is expected to see. Real activation is the
              PurchaseProtectionButton above; real resolve/claim now lives
              in PolicyClaimSection.tsx on /app/portfolio. Kept rendering in
              development so these remain exercisable for manual testing. */}
          {process.env.NODE_ENV !== "production" && (
            <div className="mt-4 space-y-4">
              <LiveTrustSnapshot ticker={assessment.stock.underlying} wrapper={assessment.stock.wrapper} />
              <WeekendTrustScenarioDemo />
              <ProtectionSessionDemo />
              <SettlementDemo />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
