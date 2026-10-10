"use client";

import { useState } from "react";
import type { Address } from "viem";
import type { PositionAssessment } from "@/lib/agent/orchestrator";
import type { ProtectionQuote } from "@/lib/types";
import type { WalletState } from "@/lib/useWallet";
import { DevBadge } from "@/components/DevBadge";
import { SafetyBadge } from "@/components/SafetyBadge";
import { WarningBanner } from "@/components/ErrorBanner";
import { PurchaseProtectionButton } from "@/components/PurchaseProtectionButton";
import { FundReserveSection } from "@/components/FundReserveSection";
import { WithdrawReserveSection } from "@/components/WithdrawReserveSection";
import { toUserMessage } from "@/lib/errors";

const THRESHOLD_OPTIONS = [3, 5, 10];

export function ProtectionPanel({
  address,
  assessment,
  wallet,
}: {
  address: string;
  assessment: PositionAssessment;
  wallet: WalletState;
}) {
  const [thresholdPercent, setThresholdPercent] = useState(5);
  const [quote, setQuote] = useState<ProtectionQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { position, canOfferProtection, offerReason } = assessment;

  async function fetchQuote() {
    setLoading(true);
    setError(null);
    setQuote(null);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          wrapper: position.stock.wrapper,
          underlying: position.stock.underlying,
          thresholdPercent,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not get a quote.");
        return;
      }
      setQuote(data.quote);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border-subtle p-5 ">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Weekend Protection — {position.stock.underlying} ({position.stock.wrapper})
        </h2>
        <SafetyBadge status={assessment.safetyGateResult.status} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FundReserveSection wallet={wallet} />
        <WithdrawReserveSection wallet={wallet} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-2">Position</p>
          <p className="font-medium">${(position.usdValue ?? 0).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-muted-2">Weekend downside threshold</p>
          <select
            value={thresholdPercent}
            onChange={(e) => setThresholdPercent(Number(e.target.value))}
            className="mt-0.5 w-full rounded border border-border-subtle bg-transparent px-2 py-1 "
          >
            {THRESHOLD_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}%
              </option>
            ))}
          </select>
        </div>
      </div>

      {!canOfferProtection && (
        <div className="mt-4">
          <WarningBanner message={`Protection is not currently offered for this position: ${offerReason}`} />
        </div>
      )}

      {canOfferProtection && (
        <button
          type="button"
          onClick={fetchQuote}
          disabled={loading}
          className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-50"
        >
          {loading ? "Getting quote…" : "Get development quote"}
        </button>
      )}

      {error && (
        <div className="mt-3">
          <WarningBanner message={error} />
        </div>
      )}

      {quote && (
        <div className="mt-4 rounded-lg border border-border-subtle bg-surface-2 p-4  ">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium">Development quote</p>
            <DevBadge />
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-2">Coverage amount</dt>
            <dd className="text-right tabular-nums">${quote.coverageAmount.toFixed(2)}</dd>
            <dt className="text-muted-2">Downside threshold</dt>
            <dd className="text-right tabular-nums">{quote.thresholdPercent}%</dd>
            <dt className="text-muted-2">Estimated premium</dt>
            <dd className="text-right tabular-nums">${quote.premium.toFixed(2)}</dd>
            <dt className="text-muted-2">Resolves at</dt>
            <dd className="text-right">{new Date(quote.expiresAt).toLocaleString()}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted-2">
            Premium is an illustrative estimate (see lib/protection/premiumTiers.ts), not real underwriting.
            Activating below collects this exact premium for real and opens a real on-chain policy.
          </p>
          <PurchaseProtectionButton
            wallet={wallet}
            quote={quote}
            tokenizedStockContract={position.stock.tokenAddress as Address | undefined}
            wrapper={position.stock.wrapper}
            onPurchased={() => {}}
          />
        </div>
      )}
    </div>
  );
}
