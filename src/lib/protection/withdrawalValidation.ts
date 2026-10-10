import { parseUnits, isAddress, type Address } from "viem";

/**
 * Pure, dependency-free validation for WithdrawReserveSection.tsx — every
 * rule the contract itself enforces (owner-only, amount <= availableReserve,
 * amount > 0) is checked HERE first, so the UI can reject an invalid
 * withdrawal with a specific reason before ever prompting a wallet
 * signature, same "validate, then sign" order as PurchaseProtectionButton/
 * SellSpotPanel. The contract's own checks remain the authoritative,
 * final guard (via the existing simulateContract-style pre-flight pattern
 * where used) — this never replaces them, only front-runs the obvious
 * rejections with a clearer message.
 *
 * Zero imports beyond viem (parseUnits/isAddress are pure, no network) —
 * directly unit-testable with Node's test runner.
 */

export interface WithdrawalValidationInput {
  /** Exactly what the user typed, e.g. "0.1" — never a pre-converted float. */
  amountRaw: string;
  /** Exactly what the user typed/left as the recipient field. */
  recipientRaw: string;
  /** The contract's own availableReserve() = totalReserve - totalLockedForActivePolicies, read live. */
  availableReserveRaw: bigint;
  decimals: number;
  /** Whether the connected wallet address matches the contract's owner(). */
  isOwner: boolean;
  /** Whether the connected wallet is on the settlement contract's configured chain. */
  correctChain: boolean;
}

export type WithdrawalValidationResult =
  | { valid: true; amount: bigint; recipient: Address }
  | { valid: false; reason: string };

export function validateWithdrawal(input: WithdrawalValidationInput): WithdrawalValidationResult {
  if (!input.correctChain) {
    return { valid: false, reason: "Your wallet is on the wrong network for this settlement contract." };
  }
  if (!input.isOwner) {
    return { valid: false, reason: "Only the contract owner can withdraw reserve funds." };
  }
  if (!input.recipientRaw || !isAddress(input.recipientRaw)) {
    return { valid: false, reason: "Enter a valid recipient address." };
  }

  let amount: bigint;
  try {
    amount = parseUnits(input.amountRaw, input.decimals);
  } catch {
    return { valid: false, reason: "Enter a valid USDT amount." };
  }

  if (amount <= BigInt(0)) {
    return { valid: false, reason: "Amount must be greater than zero." };
  }
  if (amount > input.availableReserveRaw) {
    return { valid: false, reason: "Amount exceeds the available (unlocked) reserve — locked policy funds can never be withdrawn." };
  }

  return { valid: true, amount, recipient: input.recipientRaw as Address };
}
