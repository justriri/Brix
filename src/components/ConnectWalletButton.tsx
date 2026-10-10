"use client";

import type { WalletState } from "@/lib/useWallet";

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Wallet-selection UI (build brief Task 2): a browser extension is just
 * one of two ways to connect, not the only one. When no injected provider
 * is detected, this no longer dead-ends on an "Install a BSC wallet"
 * message — it offers WalletConnect's own QR/deep-link modal instead,
 * which is how a mobile browser (no `window.ethereum` at all, by design)
 * actually connects. Desktop users with an extension keep the exact same
 * one-click "Connect wallet" behavior as before; a second, smaller
 * "Use mobile wallet" option is shown alongside it for anyone who'd
 * rather scan a QR code / use a different device.
 */
export function ConnectWalletButton({ wallet }: { wallet: WalletState }) {
  if (wallet.address) {
    if (wallet.wrongChain) {
      return (
        <button
          type="button"
          onClick={wallet.connectionType === "walletconnect" ? wallet.connectMobile : wallet.connect}
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

  const primaryAction = wallet.hasProvider ? wallet.connect : wallet.connectMobile;
  const primaryLabel = wallet.isConnecting
    ? "Connecting…"
    : wallet.hasProvider
      ? "Connect wallet"
      : wallet.walletConnectAvailable
        ? "Connect wallet"
        : "Install a BSC wallet";
  const primaryDisabled = wallet.isConnecting || (!wallet.hasProvider && !wallet.walletConnectAvailable);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={primaryAction}
        disabled={primaryDisabled}
        title={!wallet.hasProvider && !wallet.walletConnectAvailable ? "No wallet extension found and mobile wallet connection isn't configured for this deployment." : undefined}
        className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-50"
      >
        {primaryLabel}
      </button>
      {wallet.hasProvider && wallet.walletConnectAvailable ? (
        <button
          type="button"
          onClick={wallet.connectMobile}
          disabled={wallet.isConnecting}
          title="Scan a QR code with a mobile wallet app"
          className="rounded-full border border-border-subtle bg-surface px-3 py-2 text-xs font-medium text-foreground-muted transition-colors hover:border-brand/40 hover:bg-surface-2 disabled:opacity-50"
        >
          Use mobile wallet
        </button>
      ) : null}
    </div>
  );
}
