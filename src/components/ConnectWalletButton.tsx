"use client";

import type { WalletState } from "@/lib/useWallet";

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ConnectWalletButton({ wallet }: { wallet: WalletState }) {
  if (wallet.address) {
    if (wallet.wrongChain) {
      return (
        <button
          type="button"
          onClick={wallet.connect}
          title="Switch to BNB Smart Chain"
          className="rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
        >
          Wrong network — switch
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={wallet.disconnect}
        className="rounded-full border border-border-subtle bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-surface-2"
        title="Disconnect"
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle" />
        {shortenAddress(wallet.address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={wallet.connect}
      disabled={wallet.isConnecting}
      className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-50"
    >
      {wallet.isConnecting
        ? "Connecting…"
        : wallet.hasProvider
          ? "Connect wallet"
          : "Install a BSC wallet"}
    </button>
  );
}
