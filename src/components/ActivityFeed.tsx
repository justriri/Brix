"use client";

import { useEffect, useState } from "react";
import { getActivity, type ActivityEntry } from "@/lib/brixActivity";

const TYPE_LABEL: Record<ActivityEntry["type"], string> = {
  approve: "Approval",
  buy: "Purchase",
  sell: "Sell",
  "protection-quote": "Protection quote",
  "settlement-approve": "Settlement",
  "settlement-fund-reserve": "Settlement",
  "settlement-withdraw-reserve": "Settlement",
  "settlement-activate": "Settlement",
  "settlement-authorize": "Settlement",
  "settlement-resolve": "Settlement",
  "settlement-claim": "Settlement",
};

/**
 * Real activity only — every row here was written by recordActivity() at
 * the exact moment an existing component (BuySpotPanel, BinanceRwaProtectionQuote,
 * SettlementDemo) got back a REAL tx hash or REAL quote from an EXISTING
 * endpoint. This is a per-browser convenience log (localStorage), not a
 * new backend — nothing here is fabricated, and an empty list just means
 * no action has been taken yet in this browser.
 */
export function ActivityFeed() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    // Reading localStorage (an external system, not React state) is exactly
    // the external-sync case this lint rule allows for — same precedent as
    // useWallet.ts's window.ethereum detection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries(getActivity());
  }, []);

  if (entries === null) return null;

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border-subtle bg-surface p-8 text-center text-sm text-muted-2">
        No activity yet in this browser. Approvals, purchases, protection quotes, and settlement transactions
        will appear here as you take them in Markets.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-subtle rounded-2xl border border-border-subtle bg-surface">
      {entries.map((e, i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <div>
            <p className="text-foreground">{e.label}</p>
            <p className="text-xs text-muted-2">
              {TYPE_LABEL[e.type]} · {new Date(e.timestamp).toLocaleString()}
            </p>
          </div>
          {e.hash && (
            <code className="shrink-0 rounded bg-surface-2 px-2 py-1 text-xs text-muted">
              {e.hash.slice(0, 6)}…{e.hash.slice(-4)}
            </code>
          )}
        </div>
      ))}
    </div>
  );
}
