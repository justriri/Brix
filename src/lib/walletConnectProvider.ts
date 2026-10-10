"use client";

import { EthereumProvider } from "@walletconnect/ethereum-provider";
import type { Eip1193Provider } from "./useWallet";

/**
 * Mobile-wallet connection path via WalletConnect v2 — ADDED alongside the
 * existing injected-provider flow in useWallet.ts, not replacing it. A
 * normal mobile browser (Chrome/Safari on a phone, visiting the site
 * directly, not inside a wallet app's own in-app browser) has no
 * `window.ethereum` at all — that's the confirmed root cause of "no wallet
 * extension installed" on mobile. WalletConnect's own modal shows a QR
 * code (scanned by any WalletConnect-compatible wallet app) and, on a
 * phone, deep-links straight into installed wallet apps — a real
 * wallet-selection UI, not a dead end.
 *
 * Requires NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID — a PUBLIC, non-secret
 * project identifier from https://cloud.reown.com (formerly
 * WalletConnect Cloud), safe for a NEXT_PUBLIC_ env var by design (it is
 * not a credential — it just identifies which project's relay/quota is
 * being used). This project does not have one configured; it must be
 * created and set in Vercel before this path can work in production. When
 * it's missing, isWalletConnectConfigured() returns false and the UI
 * hides the mobile-wallet option entirely rather than offering a button
 * that would fail.
 */

const BSC_CHAIN_ID = 56;

function getProjectId(): string | null {
  const id = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  return id && id.length > 0 ? id : null;
}

export function isWalletConnectConfigured(): boolean {
  return getProjectId() !== null;
}

type WcProvider = Awaited<ReturnType<typeof EthereumProvider.init>>;

let providerPromise: Promise<WcProvider> | null = null;

async function getProvider(): Promise<WcProvider> {
  if (!providerPromise) {
    const projectId = getProjectId();
    if (!projectId) {
      throw new Error("Mobile wallet connection is not configured for this deployment.");
    }
    providerPromise = EthereumProvider.init({
      projectId,
      chains: [BSC_CHAIN_ID],
      showQrModal: true,
      optionalMethods: [
        "eth_sendTransaction",
        "eth_sign",
        "personal_sign",
        "eth_signTypedData",
        "eth_signTypedData_v4",
        "wallet_switchEthereumChain",
        "wallet_addEthereumChain",
      ],
      optionalEvents: ["chainChanged", "accountsChanged", "disconnect"],
      metadata: {
        name: "BRIX",
        description: "Tokenized stocks and weekend protection on BNB Chain",
        url: typeof window !== "undefined" ? window.location.origin : "https://brix.app",
        icons: [],
      },
    }).catch((err) => {
      // Let the next connect attempt retry from scratch rather than
      // permanently caching a failed init.
      providerPromise = null;
      throw err;
    });
  }
  return providerPromise;
}

export interface WalletConnectSession {
  provider: Eip1193Provider;
  address: string;
  chainIdHex: `0x${string}`;
}

/**
 * Opens WalletConnect's QR/deep-link modal and waits for the user to
 * approve from their wallet app. Rejects (without retrying) if the user
 * dismisses the modal or the wallet rejects the request — callers show
 * this as a plain connection error, same as the injected-provider path.
 */
export async function connectWalletConnect(): Promise<WalletConnectSession> {
  const provider = await getProvider();
  if (!provider.session) {
    await provider.connect();
  }
  const address = provider.accounts[0];
  if (!address) {
    throw new Error("Wallet connected but returned no account.");
  }
  return {
    provider: provider as unknown as Eip1193Provider,
    address,
    chainIdHex: `0x${provider.chainId.toString(16)}`,
  };
}

export async function disconnectWalletConnect(): Promise<void> {
  if (!providerPromise) return;
  const provider = await providerPromise;
  if (provider.session) {
    await provider.disconnect();
  }
}
