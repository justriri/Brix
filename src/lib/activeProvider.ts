"use client";

import type { Eip1193Provider } from "./useWallet";

/**
 * Resolves whichever EIP-1193 provider is ACTUALLY connected right now —
 * the browser's injected extension (desktop) or an active WalletConnect
 * session (mobile/QR) — so transaction-signing call sites
 * (spotPurchaseClient.ts, settlementContractClient.ts) don't need to know
 * which one is in use, and don't have to hardcode `window.ethereum`.
 *
 * This is a plain module, not part of useWallet.ts's React state, because
 * those signing call sites are ordinary functions, not hooks — they can't
 * call useWallet() themselves. useWallet.ts calls setActiveProvider()
 * whenever its own connection state changes (connect/disconnect, either
 * path), so this module always mirrors the hook's current connection.
 */

let walletConnectProvider: Eip1193Provider | undefined;

export function setActiveWalletConnectProvider(provider: Eip1193Provider | undefined): void {
  walletConnectProvider = provider;
}

/**
 * Prefers an active WalletConnect session over the injected provider: once
 * a user has explicitly connected via WalletConnect, signing must go
 * through THAT session (the wallet app that approved it), not whatever
 * `window.ethereum` happens to be in that same browser tab.
 */
export function getActiveProvider(): Eip1193Provider | undefined {
  if (walletConnectProvider) return walletConnectProvider;
  if (typeof window !== "undefined" && window.ethereum) return window.ethereum;
  return undefined;
}
