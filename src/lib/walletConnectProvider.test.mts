import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { connectWalletConnect, isWalletConnectConfigured } from "./walletConnectProvider.ts";

/**
 * This deployment does not have NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
 * configured (it is a real, non-secret identifier from
 * cloud.reown.com that must be created and set by the project owner —
 * this test suite never fabricates one). These tests cover the
 * "not configured" failure mode only: isWalletConnectConfigured() must
 * report false, and connectWalletConnect() must fail fast with a clear
 * error BEFORE ever attempting a network/relay connection, rather than
 * hanging or throwing an unrelated error deep inside the WalletConnect
 * SDK.
 *
 * A real WalletConnect session (QR scan, wallet-app approval, an actual
 * relay round-trip) is NOT exercised here — that requires a configured
 * project ID, network access, and a real or emulated wallet app, and is
 * explicitly out of scope for an automated unit test. See the PR/report
 * notes for what has and hasn't been verified on an actual device.
 */

describe("isWalletConnectConfigured", () => {
  test("false when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is unset (this deployment's current state)", () => {
    const original = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    try {
      assert.equal(isWalletConnectConfigured(), false);
    } finally {
      if (original !== undefined) process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = original;
    }
  });

  test("true once a project id is configured", () => {
    const original = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = "test-project-id";
    try {
      assert.equal(isWalletConnectConfigured(), true);
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
      else process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = original;
    }
  });
});

describe("connectWalletConnect without a configured project id", () => {
  test("rejects immediately with a clear 'not configured' error, never attempting a network connection", async () => {
    const original = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    try {
      await assert.rejects(connectWalletConnect(), /not configured/);
    } finally {
      if (original !== undefined) process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = original;
    }
  });
});
