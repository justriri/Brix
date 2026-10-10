"use client";

import { useEffect, useState } from "react";
import type { PositionAssessment } from "@/lib/agent/orchestrator";
import { SafetyBadge } from "@/components/SafetyBadge";
import { SafetyDetails } from "@/components/SafetyDetails";
import { isProtectionQuoted } from "@/lib/brixActivity";

/**
 * Where THIS position currently sits in the BRIX lifecycle — honest,
 * never fabricated. "Verified" is always true here (this card only ever
 * renders for a real on-chain balance the orchestrator just read).
 * "Protection" reflects whether a REAL quote was generated for this exact
 * wrapper+underlying in this browser (brixActivity.ts) — it never claims
 * "Active" unless a real on-chain policy exists, which this Portfolio path
 * has no way to know per-position yet (see SettlementDemo's own, separate,
 * manually-keyed on-chain state). Monitoring/Settlement are explained as
 * "available after" the prior stage rather than invented statuses.
 *
 * Presented as a connected vertical lifecycle, not a flat data table —
 * same underlying three booleans as before (verified / quoted / neither),
 * just visualized as one journey instead of a dl list.
 */
function LifelineStage({ label, state, detail }: { label: string; state: "done" | "active" | "pending"; detail: string }) {
  return (
    <div className="relative flex gap-3 pb-5 last:pb-0">
      <div className="relative z-10 flex flex-col items-center">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            state === "done" ? "bg-emerald-400" : state === "active" ? "bg-brand" : "bg-border-strong"
          }`}
        />
      </div>
      <div className="-mt-0.5 flex-1">
        <p className={`text-sm font-medium ${state === "pending" ? "text-muted-2" : "text-foreground"}`}>{label}</p>
        <p className="text-xs text-muted-2">{detail}</p>
      </div>
    </div>
  );
}

export function PositionCard({
  assessment,
  selected,
  onSelect,
}: {
  assessment: PositionAssessment;
  selected: boolean;
  onSelect: () => void;
}) {
  const { position, safetyGateResult } = assessment;
  const { stock } = position;
  const positionKey = `${stock.underlying}:${stock.wrapper}`;
  const [protectionQuoted, setProtectionQuoted] = useState(false);

  useEffect(() => {
    // Reading localStorage (an external system, not React state) is exactly
    // the external-sync case this lint rule allows for — same precedent as
    // useWallet.ts's window.ethereum detection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProtectionQuoted(isProtectionQuoted(positionKey));
  }, [positionKey]);

  return (
    <div
      className={`rounded-2xl border bg-surface p-5 transition-all duration-300 ${
        selected ? "border-brand ring-1 ring-brand/40" : "border-border-subtle hover:border-border-strong hover:-translate-y-0.5"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
            {stock.underlying}
          </p>
          <p className="truncate text-xs capitalize text-muted-2">{stock.wrapper}</p>
        </div>
        <div className="shrink-0">
          <SafetyBadge status={safetyGateResult.status} />
        </div>
      </div>

      <p className="mt-4 text-3xl font-bold tabular-nums" style={{ fontFamily: "var(--font-display)" }}>
        {position.usdValue !== undefined ? `$${position.usdValue.toFixed(2)}` : "—"}
      </p>
      <p className="mt-0.5 text-xs text-muted-2">
        {position.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} tokens · ${stock.price?.toFixed(2) ?? "—"} ·{" "}
        {stock.priceAgeSeconds !== undefined ? `${Math.round(stock.priceAgeSeconds / 60)}m old` : "—"}
      </p>

      <span
        className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
          protectionQuoted ? "bg-brand/15 text-brand" : "bg-surface-3 text-muted"
        }`}
      >
        {protectionQuoted ? "Protection quoted" : "Not protected yet"}
      </span>

      <div className="mt-4 border-t border-border-subtle pt-4">
        <LifelineStage label="Invested" state="done" detail="Verified on-chain ✓" />
        <LifelineStage
          label="Protected"
          state={protectionQuoted ? "done" : "pending"}
          detail={protectionQuoted ? "Quote generated" : "Not started yet"}
        />
        <LifelineStage
          label="Monitoring"
          state={protectionQuoted ? "active" : "pending"}
          detail={protectionQuoted ? "Available now" : "After protection starts"}
        />
        <LifelineStage
          label="Settled"
          state="pending"
          detail={protectionQuoted ? "Pending period end" : "After monitoring"}
        />
      </div>

      <SafetyDetails result={safetyGateResult} notes={stock.notes} />

      <button
        type="button"
        onClick={onSelect}
        className={`mt-4 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
          selected ? "bg-brand/20 text-brand" : "bg-brand text-brand-foreground hover:bg-brand/90"
        }`}
      >
        {selected ? "Selected for protection" : "Set up weekend protection"}
      </button>
    </div>
  );
}
