import { privateKeyToAccount } from "viem/accounts";
// Relative import WITH an explicit .ts extension — this file is now
// imported transitively by settlementAuthorizationIssuer.ts, which must
// stay resolvable by Node's test runner directly (see its own .test.mts),
// not just Next's bundler, which is the only thing that understands "@/".
import { WeekendGuardError } from "../errors.ts";
import {
  SETTLEMENT_AUTHORIZATION_TYPES,
  type Eip712Domain,
  type SettlementAuthorizationMessage,
} from "./settlementAuthorizationCore.ts";

/**
 * Thin, server-only signing wrapper around settlementAuthorizationCore.ts's
 * pure message assembly. This is the ONE place the "trusted signer" private
 * key is ever read — never import this file from a client component.
 *
 * SETTLEMENT_SIGNER_PRIVATE_KEY is a TESTNET-ONLY demo key for this task
 * (see SETTLEMENT.md "deployment status" — no mainnet key should ever be
 * placed here). Uses viem's privateKeyToAccount/signTypedData, the same
 * library already used throughout this codebase (chain.ts, useWallet.ts) —
 * no new signing dependency introduced.
 */

/** A raw secp256k1 private key: 0x + exactly 64 hex characters. Deliberately strict — a format this specific has essentially no false negatives for a genuinely correct key, and catching a malformed value HERE (never logging it) is far better than viem throwing a less legible error deep inside signTypedData, or silently misbehaving. */
const PRIVATE_KEY_FORMAT = /^0x[0-9a-fA-F]{64}$/;

/**
 * True only if a value is PRESENT and well-formed. A present-but-malformed
 * value (e.g. a BIP-39 mnemonic phrase pasted in by mistake instead of a
 * raw private key — a real, live-diagnosed case for this exact variable)
 * deliberately returns false here, same as "not configured" — callers
 * already treat false as "cannot sign right now," which is the correct,
 * safe behavior for a malformed value too: never attempt to sign with
 * something that isn't actually a usable key.
 */
export function isSettlementSignerConfigured(): boolean {
  const key = process.env.SETTLEMENT_SIGNER_PRIVATE_KEY;
  return Boolean(key) && PRIVATE_KEY_FORMAT.test(key!);
}

/**
 * Explains WHY signing isn't available right now, distinguishing "nothing
 * set" from "something is set but it's not a valid private key" — without
 * ever including the configured value itself in the message. Returns null
 * when the key is fine. Purely diagnostic; callers (the scheduler, the dev
 * route) log this string, never the key.
 */
export function getSettlementSignerConfigError(): string | null {
  const key = process.env.SETTLEMENT_SIGNER_PRIVATE_KEY;
  if (!key) return "SETTLEMENT_SIGNER_PRIVATE_KEY is not set.";
  if (!PRIVATE_KEY_FORMAT.test(key)) {
    return "SETTLEMENT_SIGNER_PRIVATE_KEY is set but is not a valid private key — expected a 0x-prefixed, 64-character hex string. (Looks like it may be a seed phrase or some other value was pasted in by mistake; the value itself is never logged.)";
  }
  return null;
}

/** The signer's own address — useful for admin setup (setTrustedSigner on the contract must be called with this exact address). */
export function getSettlementSignerAddress(): `0x${string}` {
  const key = requireKey();
  return privateKeyToAccount(key).address;
}

function requireKey(): `0x${string}` {
  const key = process.env.SETTLEMENT_SIGNER_PRIVATE_KEY;
  const configError = getSettlementSignerConfigError();
  if (configError) {
    throw new WeekendGuardError("MISSING_CREDENTIALS", configError);
  }
  return key as `0x${string}`;
}

export async function signSettlementAuthorization(
  domain: Eip712Domain,
  message: SettlementAuthorizationMessage
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(requireKey());
  return account.signTypedData({
    domain,
    types: SETTLEMENT_AUTHORIZATION_TYPES,
    primaryType: "SettlementAuthorization",
    message,
  });
}
