"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useWallet, type WalletState } from "@/lib/useWallet";

/**
 * A single useWallet() instance shared by every page under src/app/app/ —
 * Markets (/app) and Portfolio (/app/portfolio) are now separate routes,
 * but both need the SAME connection state (not two independent
 * window.ethereum listeners/silent-reconnect attempts racing each other).
 * Provided once in src/app/app/layout.tsx, which persists across
 * client-side navigation between those two routes.
 */
const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function useWalletContext(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWalletContext() must be used within <WalletProvider> (src/app/app/layout.tsx).");
  }
  return ctx;
}
