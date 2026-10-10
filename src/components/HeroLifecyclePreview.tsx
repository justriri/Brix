"use client";

import { useEffect, useState } from "react";
import type { CandidateGroup } from "@/lib/invest/intelligence/intelligenceTypes";

/**
 * The hero's product mockup — one example position, animated through the
 * four lifecycle stages on a timer. Real current TSLA price is fetched
 * once (same /api/investment-intelligence this app already calls) so the
 * number itself is never fabricated; the later stages (Protected/
 * Monitoring/Settled) are clearly an illustrative walk-through of what
 * happens next, not a claim that this exact example has gone through
 * settlement — same "never imply fake data is real" discipline as the
 * rest of this app, just applied to a hero visual instead of a data panel.
 */

const STAGES = ["invest", "protect", "monitor", "settle"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_LABEL: Record<Stage, string> = {
  invest: "Invested",
  protect: "Protected",
  monitor: "Monitoring",
  settle: "Settled",
};

export function HeroLifecyclePreview() {
  const [price, setPrice] = useState<number | null>(null);
  const [stageIndex, setStageIndex] = useState(0);
  const stage: Stage = STAGES[stageIndex];

  useEffect(() => {
    let cancelled = false;
    fetch("/api/investment-intelligence")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || d.error) return;
        const tsla = (d.groups as CandidateGroup[])?.find((g) => g.underlying === "TSLA");
        const best = tsla?.wrappers.find((w) => w.operationalStatus === "PASS") ?? tsla?.wrappers[0];
        if (best?.facts.tokenPrice !== undefined) setPrice(best.facts.tokenPrice);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setStageIndex((i) => (i + 1) % STAGES.length), 2800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="relative overflow-hidden rounded-3xl border border-border-subtle bg-surface p-6 shadow-[0_0_80px_-20px_rgba(240,185,11,0.18)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-2">Example position</p>
            <p className="mt-0.5 text-xl font-semibold">TSLA</p>
          </div>
          <span
            key={stage}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              stage === "invest"
                ? "bg-surface-3 text-muted"
                : stage === "settle"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-brand/15 text-brand"
            }`}
          >
            {STAGE_LABEL[stage]}
          </span>
        </div>

        <p className="mt-4 text-4xl font-bold tabular-nums" style={{ fontFamily: "var(--font-display)" }}>
          {price !== null ? `$${price.toFixed(2)}` : "—"}
        </p>
        <p className="mt-1 text-xs text-muted-2">Tokenized stock · bStocks (TSLAB)</p>

        <div className="mt-6 space-y-2.5">
          {STAGES.map((s, i) => {
            const state = i < stageIndex ? "done" : i === stageIndex ? "active" : "pending";
            return (
              <div key={s} className="flex items-center gap-3">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full transition-colors duration-500 ${
                    state === "pending" ? "bg-border-strong" : state === "active" ? "bg-brand" : "bg-emerald-400"
                  }`}
                />
                <span className={`text-sm capitalize transition-colors duration-500 ${state === "pending" ? "text-muted-2" : "text-foreground"}`}>
                  {s}
                </span>
                {state === "active" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />}
              </div>
            );
          })}
        </div>

        {stage === "settle" && (
          <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            Settlement eligible · payout verified on-chain
          </div>
        )}
      </div>
    </div>
  );
}
