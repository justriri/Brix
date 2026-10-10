"use client";

import { useWalletContext } from "@/lib/WalletContext";
import { MarketOverview } from "@/components/MarketOverview";
import { InvestmentIntelligencePanel } from "@/components/InvestmentIntelligencePanel";

/**
 * Markets — Discover -> Analyze -> Buy. Portfolio, Sell, and Weekend
 * Protection management now live on their own page (src/app/app/portfolio/
 * page.tsx) so this page can stay focused on discovering and buying
 * tokenized stocks, per the "separate Markets and Portfolio" requirement —
 * this is a reorganization of existing pieces, not a rewrite: both
 * InvestmentIntelligencePanel and MarketOverview are unmodified in what
 * data they fetch or how they fetch it.
 */
export default function MarketsPage() {
  const wallet = useWalletContext();

  return (
    <>
      <section id="markets" className="scroll-mt-20">
        <InvestmentIntelligencePanel wallet={wallet} />
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-muted">Quick market glance</h2>
        <p className="mb-3 text-xs text-muted-2">
          A simpler, read-only price/liquidity overview (includes xStocks as a reference-only price — not a
          holdable BSC position). For the full Safety Gate analysis used by Buy/Protect above, use Markets.
        </p>
        <MarketOverview />
      </section>
    </>
  );
}
