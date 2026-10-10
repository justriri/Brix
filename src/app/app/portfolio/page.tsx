"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWalletContext } from "@/lib/WalletContext";
import { PositionCard } from "@/components/PositionCard";
import { ProtectionPanel } from "@/components/ProtectionPanel";
import { SellSpotPanel } from "@/components/SellSpotPanel";
import { PolicyClaimSection } from "@/components/PolicyClaimSection";
import { ActivityFeed } from "@/components/ActivityFeed";
import { ErrorBanner, WarningBanner } from "@/components/ErrorBanner";
import { toUserMessage } from "@/lib/errors";
import type { PositionAssessment } from "@/lib/agent/orchestrator";

/**
 * Portfolio — holdings, total value, and per-position Sell/Weekend
 * Protection management (including Fund/Withdraw Reserve, nested inside
 * ProtectionPanel). Moved out of src/app/app/page.tsx (which is now
 * Markets-only) per the "separate Markets and Portfolio" requirement.
 * Every fetch/validation/transaction path below is the SAME code that used
 * to live in page.tsx — only the surrounding page and the key convention
 * used to match a selected position changed (see the `key` comment below).
 */
function PortfolioContent() {
  const wallet = useWalletContext();
  const searchParams = useSearchParams();
  const [assessments, setAssessments] = useState<PositionAssessment[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Arriving from Markets' "View Position" link (?position=underlying:wrapper)
  // pre-selects that exact position once assessments have loaded.
  useEffect(() => {
    const requested = searchParams.get("position");
    // Syncing to an external source (the URL) read on mount/navigation —
    // same precedent as useWallet.ts's window.ethereum detection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (requested) setSelectedKey(requested);
  }, [searchParams]);

  useEffect(() => {
    if (!wallet.address) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAssessments(null);
      setSelectedKey(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/portfolio?address=${wallet.address}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setAssessments(data.assessments);
        setWarnings(data.warnings ?? []);
      })
      .catch((err) => !cancelled && setError(toUserMessage(err)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [wallet.address]);

  async function refreshPortfolio() {
    if (!wallet.address) return;
    try {
      const res = await fetch(`/api/portfolio?address=${wallet.address}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setAssessments(data.assessments);
      setWarnings(data.warnings ?? []);
    } catch (err) {
      setError(toUserMessage(err));
    }
  }

  // Standardized on `${underlying}:${wrapper}` — the same key order already
  // used by PositionCard's own localStorage key, InvestmentIntelligencePanel,
  // and brixActivity.ts's isProtectionQuoted()/recordProtectionQuoted(). The
  // previous version of this page used the reverse order (`${wrapper}:
  // ${underlying}`); fixed here since this is also what Markets' new "View
  // Position" link now passes as ?position=.
  const selected = assessments?.find(
    (a) => `${a.position.stock.underlying}:${a.position.stock.wrapper}` === selectedKey
  );

  const totalValue = assessments?.reduce((sum, a) => sum + (a.position.usdValue ?? 0), 0);

  return (
    <section id="portfolio" className="scroll-mt-20">
      <div className="mb-6">
        <h2 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Portfolio
        </h2>
        <p className="mt-1 text-sm text-muted">
          Tokenized-stock tokens you already hold — including ones acquired outside BRIX — with where each one
          sits in the Invest → Protect → Monitor → Settle lifecycle.
        </p>
        {assessments && assessments.length > 0 && totalValue !== undefined && (
          <p className="mt-2 text-sm text-muted">
            Total estimated value: <span className="font-semibold tabular-nums text-foreground">${totalValue.toFixed(2)}</span>
          </p>
        )}
      </div>

      {!wallet.address && (
        <p className="rounded-xl border border-dashed border-border-subtle bg-surface p-8 text-center text-sm text-muted">
          Connect a BSC wallet to detect your bStocks / Ondo tokenized-stock positions.
        </p>
      )}

      {wallet.address && loading && <p className="text-sm text-muted">Scanning positions on BSC…</p>}
      {wallet.address && error && <ErrorBanner message={error} />}

      {warnings.map((w, i) => (
        <div key={i} className="mb-2">
          <WarningBanner message={w} />
        </div>
      ))}

      {wallet.address && !loading && assessments && assessments.length === 0 && (
        <p className="rounded-xl border border-dashed border-border-subtle bg-surface p-8 text-center text-sm text-muted">
          No supported tokenized-stock positions (TSLA/AAPL/NVDA via bStocks or Ondo) were found in this wallet.
          Buy one in Markets to see it here.
        </p>
      )}

      {assessments && assessments.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assessments.map((a) => {
            const key = `${a.position.stock.underlying}:${a.position.stock.wrapper}`;
            return (
              <PositionCard
                key={key}
                assessment={a}
                selected={selectedKey === key}
                onSelect={() => setSelectedKey(key)}
              />
            );
          })}
        </div>
      )}

      {selected && wallet.address && (
        <div id="selected-position" className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SellSpotPanel wallet={wallet} stock={selected.position.stock} onSellComplete={refreshPortfolio} />
          <ProtectionPanel address={wallet.address} assessment={selected} wallet={wallet} />
        </div>
      )}

      <PolicyClaimSection wallet={wallet} />

      <div className="mt-12">
        <h2 className="mb-1 text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Activity
        </h2>
        <p className="mb-6 text-sm text-muted">Your approvals, purchases, protection quotes, and settlement transactions.</p>
        <ActivityFeed />
      </div>
    </section>
  );
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading portfolio…</p>}>
      <PortfolioContent />
    </Suspense>
  );
}
