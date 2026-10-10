"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletProvider, useWalletContext } from "@/lib/WalletContext";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { BrixLogo } from "@/components/BrixLogo";
import { ErrorBanner } from "@/components/ErrorBanner";

/**
 * Shared shell for every page under /app — header/nav/wallet-connect/footer
 * previously duplicated inside src/app/app/page.tsx are centralized here so
 * splitting Markets (/app) and Portfolio (/app/portfolio) into separate
 * routes doesn't duplicate that markup or (via WalletProvider) the wallet
 * connection itself.
 */
function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link href={href} className={`transition-colors hover:text-foreground ${active ? "font-medium text-foreground" : ""}`}>
      {children}
    </Link>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const wallet = useWalletContext();

  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border-subtle bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/">
            <BrixLogo size="sm" />
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted sm:flex">
            <NavLink href="/app">Markets</NavLink>
            <NavLink href="/app/portfolio">Portfolio</NavLink>
          </nav>
          <div className="flex items-center gap-4">
            <ConnectWalletButton wallet={wallet} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-16 px-6 py-12">
        {wallet.error && <ErrorBanner message={wallet.error} />}
        {children}
      </main>

      <footer className="mt-auto border-t border-border-subtle">
        <div className="mx-auto max-w-7xl px-6 py-6 text-xs text-muted-2">
          BRIX protects an existing spot tokenized-stock position with a fixed-term, pre-funded conditional
          payout — it is not a perpetual, leveraged, or short position.{" "}
          <details className="mt-2 inline-block">
            <summary className="cursor-pointer text-muted hover:text-foreground">Technical &amp; methodology details</summary>
            <p className="mt-2 max-w-2xl text-muted-2">
              Cross-wrapper checks are a safety mechanism, not the product. See <code>reports/</code> for full
              research and strategy notes, <code>SETTLEMENT.md</code> for the on-chain settlement contract&apos;s
              architecture and audit history, and <code>README.md</code> for exactly which data sources are live
              versus reference-only.
            </p>
          </details>
        </div>
      </footer>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <AppShell>{children}</AppShell>
    </WalletProvider>
  );
}
