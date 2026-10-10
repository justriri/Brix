"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSettlementContractAddress, getSettlementUsdtAddress } from "@/lib/protection/settlementContractClient";
import { BrixLogo } from "@/components/BrixLogo";
import { HeroLifecyclePreview } from "@/components/HeroLifecyclePreview";
import { LifecycleNarrative } from "@/components/LifecycleNarrative";
import { ScrollReveal } from "@/components/ScrollReveal";
import type { CandidateGroup } from "@/lib/invest/intelligence/intelligenceTypes";

/**
 * The LANDING PAGE — sells and explains BRIX as an investment LIFECYCLE
 * product (Invest -> Protect -> Monitor -> Settle), not a tokenized-stock
 * marketplace. Deliberately separate from the application (src/app/app/
 * page.tsx), which is where Discover -> Analyze -> Buy -> Verify ->
 * Protect -> Monitor -> Settle actually happens. This page explains;
 * the application acts. No market dashboard lives here — only a
 * read-only, real-data preview that hands off into /app.
 *
 * Redesigned as a connected narrative (hero -> lifecycle story ->
 * differentiation -> markets -> CTA) rather than stacked, unrelated
 * cards — same product facts and data sources as before, new structure
 * and visual language.
 */

function MarketsPreview() {
  const [groups, setGroups] = useState<CandidateGroup[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/investment-intelligence")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && !d.error) setGroups(d.groups);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {(groups ?? [null, null, null]).map((group, i) => {
        if (!group) {
          return <div key={i} className="h-44 animate-pulse rounded-2xl border border-border-subtle bg-surface" />;
        }
        const best = group.wrappers.find((w) => w.operationalStatus === "PASS") ?? group.wrappers[0];
        return (
          <Link
            key={group.underlying}
            href="/app#markets"
            className="group rounded-2xl border border-border-subtle bg-surface p-5 transition-all duration-300 hover:-translate-y-1 hover:border-border-strong hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)]"
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold">{group.underlying}</p>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  best.operationalStatus === "PASS"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : best.operationalStatus === "WARNING"
                      ? "bg-amber-500/10 text-amber-400"
                      : best.operationalStatus === "UNAVAILABLE"
                        ? "bg-surface-3 text-muted"
                        : "bg-red-500/10 text-red-400"
                }`}
              >
                {best.operationalStatus === "UNAVAILABLE" ? "Price unavailable" : best.operationalStatus}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-2">
              {best.wrapper} · {best.tokenSymbol}
            </p>
            <p className="mt-4 text-3xl font-bold tabular-nums" style={{ fontFamily: "var(--font-display)" }}>
              {best.facts.tokenPrice !== undefined ? `$${best.facts.tokenPrice.toFixed(2)}` : "—"}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-y-0.5 text-xs text-muted-2">
              <dt>Liquidity</dt>
              <dd className="text-right text-muted">
                {best.facts.liquidityUsd !== undefined ? `$${Math.round(best.facts.liquidityUsd).toLocaleString()}` : "—"}
              </dd>
              <dt>Market</dt>
              <dd className="text-right capitalize text-muted">{best.facts.marketStatus ?? "—"}</dd>
            </dl>
            <p className="mt-4 flex items-center gap-1 text-xs font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">
              Analyze <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </p>
          </Link>
        );
      })}
    </div>
  );
}

export default function LandingPage() {
  const settlementEnabled = Boolean(getSettlementContractAddress() && getSettlementUsdtAddress());

  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border-subtle bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <BrixLogo size="md" />
          <nav className="hidden items-center gap-8 text-sm text-muted sm:flex">
            <a href="#lifecycle" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#markets-preview" className="transition-colors hover:text-foreground">Markets</a>
          </nav>
          <Link href="/app" className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90">
            Start investing
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6">
        {/* HERO */}
        <section className="relative grid grid-cols-1 items-center gap-12 py-20 sm:py-28 lg:grid-cols-2">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] brix-glow" aria-hidden />

          <div className="flex flex-col items-start gap-6">
            <span className="rounded-full border border-border-subtle bg-surface px-3 py-1 text-xs font-medium text-muted">
              Built for BNB Chain
            </span>
            <h1 className="max-w-lg text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl" style={{ fontFamily: "var(--font-display)" }}>
              Invest in tokenized stocks.
              <br />
              <span className="text-brand">BRIX protects what happens next.</span>
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted">
              Own tokenized equities on BNB Chain, protect your position for a defined period, continuously
              verify its conditions, and resolve the outcome when the protection period ends.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/app" className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition-transform duration-200 hover:scale-[1.03] hover:bg-brand/90">
                Start investing
              </Link>
              <a href="#lifecycle" className="rounded-full border border-border-subtle px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface">
                How BRIX works
              </a>
            </div>
          </div>

          <HeroLifecyclePreview />
        </section>

        {/* THE CORE PROBLEM */}
        <ScrollReveal className="mx-auto max-w-2xl py-16 text-center sm:py-20">
          <h2 className="text-2xl font-bold sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
            Buying the asset is only the beginning.
          </h2>
          <p className="mt-4 text-muted">
            Tokenized stocks make on-chain ownership possible. But owning the asset doesn&apos;t, by itself, give
            you a structured way to protect a position through a defined period, continuously verify the
            conditions around that protection, and resolve the outcome afterward. BRIX connects those pieces
            into one lifecycle.
          </p>
        </ScrollReveal>

        {/* LIFECYCLE NARRATIVE — the core of the page */}
        <section id="lifecycle" className="scroll-mt-20 py-16 sm:py-24">
          <ScrollReveal className="mb-16 text-center sm:mb-20">
            <h2 className="text-3xl font-bold sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
              One connected journey.
            </h2>
            <p className="mt-3 text-muted">Not four separate features — one position, moving through four real stages.</p>
          </ScrollReveal>
          <LifecycleNarrative />

          <ScrollReveal className="mx-auto mt-20 max-w-md rounded-2xl border border-border-subtle bg-surface-2 p-4 text-center">
            <p className="text-xs font-semibold text-muted">Settlement engine</p>
            <p className="mt-1 text-sm">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${settlementEnabled ? "bg-emerald-500/10 text-emerald-400" : "bg-brand/10 text-brand"}`}>
                {settlementEnabled ? "Enabled on this environment" : "Implemented · Not enabled on this environment"}
              </span>
            </p>
          </ScrollReveal>
        </section>

        {/* DIFFERENTIATION */}
        <ScrollReveal className="mx-auto max-w-3xl py-16 sm:py-20">
          <h2 className="text-center text-2xl font-bold sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
            More than a tokenized stock purchase.
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border-subtle bg-surface p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-2">Traditional flow</p>
              <div className="mt-4 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-border-strong" />
                <span className="h-px flex-1 bg-border-subtle" />
                <span className="h-2 w-2 rounded-full bg-border-strong" />
              </div>
              <p className="mt-3 flex justify-between text-sm font-medium text-muted">
                <span>Buy</span>
                <span>Hold</span>
              </p>
            </div>
            <div className="rounded-2xl border border-brand/30 bg-brand/5 p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-brand">BRIX</p>
              <div className="mt-4 flex items-center gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="flex flex-1 items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-brand" />
                    {i < 3 && <span className="h-px flex-1 bg-brand/40" />}
                  </span>
                ))}
              </div>
              <p className="mt-3 flex justify-between text-sm font-medium">
                <span>Invest</span>
                <span>Protect</span>
                <span>Monitor</span>
                <span>Settle</span>
              </p>
            </div>
          </div>
        </ScrollReveal>

        {/* BNB CHAIN / SUPPORTED MARKETS */}
        <ScrollReveal className="py-16 sm:py-20">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-[1fr_1.2fr] sm:items-center">
            <div>
              <span className="rounded-full border border-border-subtle bg-surface px-3 py-1 text-xs font-medium text-muted">
                Why BNB Smart Chain
              </span>
              <h2 className="mt-4 text-2xl font-bold sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
                Built on the chain the positions already live on.
              </h2>
              <p className="mt-3 max-w-md text-sm text-muted">
                BRIX doesn&apos;t bridge your position anywhere. The tokenized-stock purchase, the position
                verification, and the settlement contract all run on BNB Smart Chain — the same chain your
                tokenized stock tokens already exist on. Settlement is a real, deployed contract on BNB Smart
                Chain mainnet (chain ID 56): EIP-712 signed authorizations, pull-payment USDT claims, on-chain
                reserve accounting.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Chain", value: "BNB Smart Chain" },
                { label: "Settlement asset", value: "USDT" },
                { label: "Settlement", value: "On-chain contract" },
                { label: "Wrappers", value: "bStocks · Ondo" },
                { label: "Purchase route", value: "PancakeSwap V2" },
                { label: "Authorization", value: "EIP-712 signed" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-border-subtle bg-surface p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-2">{item.label}</p>
                  <p className="mt-1 text-sm font-semibold">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </ScrollReveal>

        {/* MARKETS PREVIEW */}
        <ScrollReveal id="markets-preview" className="scroll-mt-20 py-16 sm:py-20">
          <h2 className="text-2xl font-bold sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
            Explore tokenized stocks
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Choose the asset you want to invest in, then let BRIX take you through the rest of the lifecycle.
          </p>
          <div className="mt-8">
            <MarketsPreview />
          </div>
        </ScrollReveal>

        {/* FINAL CTA */}
        <ScrollReveal className="py-16 sm:py-20">
          <div className="relative overflow-hidden rounded-3xl border border-border-subtle bg-surface p-12 text-center">
            <div className="pointer-events-none absolute inset-0 -z-10 brix-glow" aria-hidden />
            <h2 className="text-2xl font-bold sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
              Ready to build a protected position?
            </h2>
            <Link href="/app#markets" className="mt-6 inline-block rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition-transform duration-200 hover:scale-[1.03] hover:bg-brand/90">
              Explore markets →
            </Link>
          </div>
        </ScrollReveal>
      </main>

      <footer className="mt-auto border-t border-border-subtle">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-2">
          BRIX is a BNB Chain tokenized-stock investment platform that connects on-chain stock ownership with
          fixed-term protection, continuous monitoring, and settlement. Built for BNB Hack: Tokenized Stocks
          Edition.
        </div>
      </footer>
    </div>
  );
}
