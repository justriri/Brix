"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connectWalletConnect, disconnectWalletConnect, isWalletConnectConfigured } from "./walletConnectProvider";
import { setActiveWalletConnectProvider } from "./activeProvider";

/**
 * BSC wallet connection. Two connection paths, added incrementally:
 *
 * 1. The browser's injected EIP-1193 provider (MetaMask, Binance Wallet
 *    extension, Trust Wallet, Rabby, etc.) — the ORIGINAL, desktop-first
 *    path. Handles the one BSC-specific piece every injected wallet
 *    needs: prompting a chain switch/add to BNB Smart Chain (0x38) if the
 *    wallet is on a different network.
 *
 * 2. WalletConnect v2 (connectMobile()) — ADDED for mobile, where a normal
 *    browser tab has no injected provider at all (confirmed root cause of
 *    "no wallet extension installed" reported on mobile: `window.ethereum`
 *    genuinely does not exist there, it isn't a detection bug). This path
 *    is entirely separate from and does not alter path 1 — desktop users
 *    with an extension keep using it exactly as before.
 *
 * Every transaction-signing call elsewhere in this app
 * (spotPurchaseClient.ts, settlementContractClient.ts) now resolves
 * whichever provider is actually connected via activeProvider.ts's
 * getActiveProvider(), instead of reading `window.ethereum` directly —
 * this hook calls setActiveWalletConnectProvider() whenever its own
 * connection state changes so that resolution always matches what's
 * connected here. EIP-6963 is still not used to redirect the injected
 * connection itself — only to improve its *detection* below.
 *
 * Hardened against the real-world cases a single one-shot
 * `Boolean(window.ethereum)` check on mount misses:
 *   - a wallet extension that injects `window.ethereum` a few hundred ms
 *     after the page's own scripts run (a documented, common race —
 *     previously meant the button could say "Install a BSC wallet" even
 *     with a real wallet installed, until the user reloaded);
 *   - a wallet already authorized for this site from a previous visit
 *     (silently restored via `eth_accounts`, never `eth_requestAccounts`,
 *     so it never re-prompts);
 *   - the user rejecting the connection prompt vs. an unrelated failure
 *     (distinct, correctly-worded error messages for each);
 *   - the user approving the account connection but declining the BSC
 *     chain-switch prompt specifically — previously this wiped out the
 *     successful connection and showed a misleading "rejected" error;
 *     now the address is kept and a narrower chain warning is shown.
 */

const BSC_CHAIN_ID_HEX = "0x38"; // 56
const PROVIDER_POLL_INTERVAL_MS = 150;
const PROVIDER_POLL_ATTEMPTS = 20; // ~3s of polling for a late-injecting extension

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

function getRequestErrorCode(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "number"
    ? (err as { code: number }).code
    : undefined;
}

export interface WalletState {
  address: string | null;
  chainId: string | null;
  isConnecting: boolean;
  error: string | null;
  hasProvider: boolean;
  wrongChain: boolean;
  /** Which path the current connection came through — null when disconnected. Lets UI/signing code tell a desktop-extension session apart from a WalletConnect (mobile) one. */
  connectionType: "injected" | "walletconnect" | null;
  /** Whether a NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is configured for this deployment — the UI hides the mobile-wallet option entirely when false instead of offering a button that would just fail. */
  walletConnectAvailable: boolean;
  connect: () => Promise<void>;
  /** WalletConnect connection path — opens the QR/deep-link modal. Independent of connect(); does not require or check hasProvider. */
  connectMobile: () => Promise<void>;
  disconnect: () => void;
}

export function useWallet(): WalletState {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasProvider, setHasProvider] = useState(false);
  const [connectionType, setConnectionType] = useState<"injected" | "walletconnect" | null>(null);
  const attemptedSilentReconnect = useRef(false);

  // Detect window.ethereum, tolerating a late-injecting wallet extension —
  // a real, observed race condition, not a hypothetical one. Three signals,
  // whichever fires first wins: an immediate check, the EIP-1193
  // `ethereum#initialized` event some providers dispatch, and a short bounded
  // poll as a safety net for providers that fire neither reliably.
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.ethereum) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasProvider(true);
      return;
    }

    let cancelled = false;
    const onInitialized = () => {
      if (!cancelled) setHasProvider(true);
    };
    window.addEventListener("ethereum#initialized", onInitialized, { once: true });

    let attempts = 0;
    const poll = setInterval(() => {
      attempts += 1;
      if (window.ethereum) {
        setHasProvider(true);
        clearInterval(poll);
      } else if (attempts >= PROVIDER_POLL_ATTEMPTS) {
        clearInterval(poll);
      }
    }, PROVIDER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("ethereum#initialized", onInitialized);
      clearInterval(poll);
    };
  }, []);

  // Once a provider is confirmed present, silently check for an
  // already-authorized connection (eth_accounts never prompts, unlike
  // eth_requestAccounts) so a returning user isn't asked to reconnect on
  // every page load.
  useEffect(() => {
    if (!hasProvider || attemptedSilentReconnect.current) return;
    attemptedSilentReconnect.current = true;
    const provider = window.ethereum;
    if (!provider) return;

    Promise.all([
      provider.request({ method: "eth_accounts" }) as Promise<string[]>,
      provider.request({ method: "eth_chainId" }) as Promise<string>,
    ])
      .then(([accounts, currentChainId]) => {
        if (accounts[0]) {
          setAddress(accounts[0]);
          setChainId(currentChainId);
          setConnectionType("injected");
        }
      })
      .catch(() => {
        // A provider that errors on a silent eth_accounts check just means
        // "not currently authorized" — nothing to surface as a user-facing
        // error for a check the user never initiated.
      });
  }, [hasProvider]);

  useEffect(() => {
    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!provider) return;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts[0] ?? null);
    };
    const handleChainChanged = (...args: unknown[]) => {
      setChainId(args[0] as string);
    };

    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);
    return () => {
      provider.removeListener("accountsChanged", handleAccountsChanged);
      provider.removeListener("chainChanged", handleChainChanged);
    };
  }, [hasProvider]);

  const connect = useCallback(async () => {
    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!provider) {
      setError("No BSC-compatible wallet extension was found. Install MetaMask, Binance Wallet, or Rabby, then reload this page.");
      return;
    }

    setIsConnecting(true);
    setError(null);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      // The account connection itself succeeded — record it immediately,
      // before attempting the BSC chain switch below, so a declined
      // chain-switch prompt can never wipe out a successful connection.
      setAddress(accounts[0] ?? null);
      setConnectionType("injected");

      const currentChainId = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(currentChainId);

      if (currentChainId !== BSC_CHAIN_ID_HEX) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BSC_CHAIN_ID_HEX }],
          });
          setChainId(BSC_CHAIN_ID_HEX);
        } catch (switchErr) {
          if (getRequestErrorCode(switchErr) === 4902) {
            // Chain not yet added to this wallet — add it, then switch.
            try {
              await provider.request({
                method: "wallet_addEthereumChain",
                params: [
                  {
                    chainId: BSC_CHAIN_ID_HEX,
                    chainName: "BNB Smart Chain",
                    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
                    rpcUrls: ["https://bsc-dataseed.binance.org"],
                    blockExplorerUrls: ["https://bscscan.com"],
                  },
                ],
              });
              setChainId(BSC_CHAIN_ID_HEX);
            } catch {
              setError("Connected, but couldn't add BNB Smart Chain to your wallet automatically. Please add/switch to it manually (chain ID 56).");
            }
          } else {
            // The account connection is still valid even though the chain
            // switch itself was declined — this is a narrower warning, not
            // a connection failure.
            setError("Connected, but your wallet is still on a different network. Switch to BNB Smart Chain (chain ID 56) to use BRIX.");
          }
        }
      }
    } catch (err) {
      if (getRequestErrorCode(err) === 4001) {
        setError("Connection request was rejected.");
      } else {
        setError("Wallet connection failed. Please try again.");
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // WalletConnect's own events use the same handler-array calling
  // convention as the injected provider's `.on()` above, so the exact
  // same handlers can't be reused directly (different closures over
  // which setState calls apply) but the SHAPE of what's wired up mirrors
  // it deliberately: accountsChanged -> setAddress, chainChanged ->
  // setChainId, plus a disconnect event the injected provider has no
  // equivalent listener for (an injected wallet is never "pushed" into a
  // disconnected state by the extension itself; a WalletConnect session
  // can be, e.g. the user disconnecting from inside their wallet app).
  const attachWalletConnectListeners = useCallback((provider: Eip1193Provider) => {
    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts[0] ?? null);
    };
    const handleChainChanged = (...args: unknown[]) => {
      const raw = args[0] as string | number;
      setChainId(typeof raw === "number" ? `0x${raw.toString(16)}` : raw);
    };
    const handleDisconnect = () => {
      setAddress(null);
      setChainId(null);
      setConnectionType(null);
      setActiveWalletConnectProvider(undefined);
    };
    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);
    provider.on("disconnect", handleDisconnect);
  }, []);

  /**
   * The mobile/WalletConnect connection path (build brief Task 2): opens
   * WalletConnect's own QR/deep-link modal — a real wallet-selection UI,
   * not an error — and waits for the user's wallet app to approve.
   * Entirely separate from connect() above; does not touch hasProvider or
   * the injected-provider flow at all, so it can be offered ALONGSIDE the
   * existing "Connect wallet" button rather than replacing it.
   */
  const connectMobile = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const session = await connectWalletConnect();
      setAddress(session.address);
      setChainId(session.chainIdHex);
      setConnectionType("walletconnect");
      setActiveWalletConnectProvider(session.provider);
      attachWalletConnectListeners(session.provider);

      if (session.chainIdHex !== BSC_CHAIN_ID_HEX) {
        try {
          await session.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BSC_CHAIN_ID_HEX }],
          });
          setChainId(BSC_CHAIN_ID_HEX);
        } catch {
          // Same narrower-warning behavior as the injected path: the
          // connection itself is still valid even if the wallet app
          // doesn't support (or the user declined) the chain-switch
          // request.
          setError("Connected, but your wallet is still on a different network. Switch to BNB Smart Chain (chain ID 56) to use BRIX.");
        }
      }
    } catch (err) {
      if (getRequestErrorCode(err) === 4001) {
        setError("Connection request was rejected.");
      } else if (err instanceof Error && err.message.includes("not configured")) {
        setError("Mobile wallet connection isn't available in this deployment yet.");
      } else {
        setError("Wallet connection failed. Please try again.");
      }
    } finally {
      setIsConnecting(false);
    }
  }, [attachWalletConnectListeners]);

  const disconnect = useCallback(() => {
    if (connectionType === "walletconnect") {
      disconnectWalletConnect().catch(() => {
        // Best-effort: the local state below is cleared regardless, so a
        // relay/network error disconnecting the remote session never
        // leaves the UI stuck showing a connected wallet.
      });
      setActiveWalletConnectProvider(undefined);
    }
    setAddress(null);
    setChainId(null);
    setError(null);
    setConnectionType(null);
  }, [connectionType]);

  const wrongChain = Boolean(address && chainId && chainId !== BSC_CHAIN_ID_HEX);

  return {
    address,
    chainId,
    isConnecting,
    error,
    hasProvider,
    wrongChain,
    connectionType,
    walletConnectAvailable: isWalletConnectConfigured(),
    connect,
    connectMobile,
    disconnect,
  };
}
