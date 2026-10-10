import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getActiveProvider, setActiveWalletConnectProvider } from "./activeProvider.ts";
import type { Eip1193Provider } from "./useWallet.ts";

/**
 * Covers the exact resolution activeProvider.ts performs for every
 * transaction-signing call site (spotPurchaseClient.ts,
 * settlementContractClient.ts) now that signing no longer hardcodes
 * window.ethereum (build brief Task 2):
 *  - no injected provider, no WalletConnect session -> undefined (the
 *    "no wallet extension installed" case reported on mobile, now
 *    produced by this resolver rather than crashing the signing call);
 *  - an injected provider only (the existing desktop-extension path) ->
 *    that provider, unchanged;
 *  - an active WalletConnect session (the mobile/QR path) takes
 *    precedence over whatever window.ethereum happens to be in that same
 *    tab.
 *
 * This is deliberately NOT a test of an actual WalletConnect relay
 * connection (that needs a real projectId, network access, and a wallet
 * app approving a session) or of a real browser extension — it is an
 * automated unit test of the resolver's own precedence logic only.
 */

function fakeProvider(id: string): Eip1193Provider {
  return {
    request: async () => id,
    on: () => {},
    removeListener: () => {},
  };
}

afterEach(() => {
  setActiveWalletConnectProvider(undefined);
  delete (globalThis as { window?: unknown }).window;
});

describe("getActiveProvider", () => {
  test("no injected provider and no WalletConnect session -> undefined (the no-wallet-found case)", () => {
    assert.equal(getActiveProvider(), undefined);
  });

  test("an injected provider (window.ethereum) with no WalletConnect session -> the injected provider (desktop path, unchanged)", () => {
    const injected = fakeProvider("injected");
    (globalThis as { window?: unknown }).window = { ethereum: injected };
    assert.equal(getActiveProvider(), injected);
  });

  test("an active WalletConnect session takes precedence over an injected provider in the same tab", () => {
    const injected = fakeProvider("injected");
    const walletConnect = fakeProvider("walletconnect");
    (globalThis as { window?: unknown }).window = { ethereum: injected };
    setActiveWalletConnectProvider(walletConnect);
    assert.equal(getActiveProvider(), walletConnect);
  });

  test("clearing the WalletConnect session falls back to the injected provider", () => {
    const injected = fakeProvider("injected");
    const walletConnect = fakeProvider("walletconnect");
    (globalThis as { window?: unknown }).window = { ethereum: injected };
    setActiveWalletConnectProvider(walletConnect);
    setActiveWalletConnectProvider(undefined);
    assert.equal(getActiveProvider(), injected);
  });
});
