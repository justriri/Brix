"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * BSC wallet connection via the browser's injected EIP-1193 provider
 * (MetaMask, Binance Wallet extension, Trust Wallet, Rabby, etc.) — no
 * WalletConnect/RainbowKit dependency. Handles the one BSC-specific piece
 * every injected wallet needs: prompting a chain switch/add to BNB Smart
 * Chain (0x38) if the wallet is on a different network.
 *
 * IMPORTANT: every transaction-signing call elsewhere in this app
 * (spotPurchaseClient.ts, settlementContractClient.ts) reads
 * `window.ethereum` directly, independently of this hook — so this file
 * must keep `window.ethereum` as the one and only provider it ever
 * connects to or signs through. It never substitutes a different
 * EIP-6963-announced provider for the connection itself, since doing so
 * would silently disagree with what the rest of the app signs with.
 * EIP-6963 is used here ONLY to improve *detection* (confirm a wallet
 * exists even in the brief window before `window.ethereum` itself is
 * set) — never to redirect the connection elsewhere.
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

type Eip1193Provider = {
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
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useWallet(): WalletState {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasProvider, setHasProvider] = useState(false);
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

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setError(null);
  }, []);

  const wrongChain = Boolean(address && chainId && chainId !== BSC_CHAIN_ID_HEX);

  return { address, chainId, isConnecting, error, hasProvider, wrongChain, connect, disconnect };
}
