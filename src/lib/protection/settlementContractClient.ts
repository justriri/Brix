"use client";

import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseEventLogs, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { SETTLEMENT_CONTRACT_ABI } from "@/lib/protection/settlementContractAbi";
import { CONTRACT_WRAPPER_INDEX, hashProtectionSessionId } from "@/lib/protection/settlementAuthorizationCore";
import { BSC_PUBLIC_RPC_URLS } from "@/lib/config/assets";
import type { Wrapper } from "@/lib/types";

/**
 * Minimal browser-side contract interaction helpers for
 * WeekendGuardSettlement.sol — the smallest addition that lets the existing
 * wallet flow (useWallet.ts's plain EIP-1193 injected-provider connect, no
 * wagmi/RainbowKit) do three more things: approve USDT, purchase
 * protection, and claim a payout. Reuses viem exactly as chain.ts already
 * does for reads; this file is the write-side, browser-only counterpart.
 *
 * RESERVE ASSET IS USDT, NOT USDC — see WeekendGuardSettlement.sol's own
 * header comment for why (one stablecoin end to end: USDT buys the
 * tokenized stock AND funds/pays the protection reserve).
 *
 * TESTNET-FIRST BY CONFIG: which chain this targets is driven entirely by
 * NEXT_PUBLIC_SETTLEMENT_CHAIN_ID (defaults to BSC TESTNET, 97) — never
 * hardcoded to mainnet. NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS and
 * NEXT_PUBLIC_USDT_ADDRESS are public by nature (on-chain addresses, not
 * secrets) and intentionally use the NEXT_PUBLIC_ prefix so the browser can
 * read them — see DEPLOYMENT.md's env var audit for why every OTHER env var
 * in this project deliberately does NOT use that prefix.
 */

function resolveChain() {
  const chainId = Number(process.env.NEXT_PUBLIC_SETTLEMENT_CHAIN_ID ?? "97");
  return chainId === 56 ? bsc : bscTestnet;
}

export function getSettlementContractAddress(): Address | null {
  const address = process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS;
  return address ? (address as Address) : null;
}

export function getSettlementUsdtAddress(): Address | null {
  const address = process.env.NEXT_PUBLIC_USDT_ADDRESS;
  return address ? (address as Address) : null;
}

function walletClient() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet provider found.");
  }
  return createWalletClient({ chain: resolveChain(), transport: custom(window.ethereum) });
}

/**
 * RPC FIX (live-diagnosed): this used to route every READ (balance,
 * allowance, simulateContract, waitForTransactionReceipt) through
 * `custom(window.ethereum)` — the connected WALLET's own RPC node, never
 * our own choice. That's a different, uncontrolled RPC path from the one
 * spotPurchaseClient.ts/chain.ts already use for the buy/portfolio flows
 * (an explicit, vetted endpoint from BSC_PUBLIC_RPC_URLS) — reported live
 * as "markets started working after enabling a VPN" while the protection
 * flow still failed, consistent with the two flows depending on two
 * different network paths with different reliability. On BSC MAINNET
 * (chain 56 — this deployment), reads now use the SAME explicit,
 * already-vetted endpoint the rest of the app uses. On a testnet
 * deployment (chain 97, this file's own default), there is no equivalent
 * vetted testnet endpoint in this codebase, so reads still fall back to
 * the wallet's own provider there — unchanged for that case.
 *
 * The actual SIGNING calls (walletClient() above) are deliberately
 * untouched: a signature must always go through the connected wallet.
 */
function publicClient() {
  const chain = resolveChain();
  if (chain.id === bsc.id) {
    return createPublicClient({ chain, transport: http(BSC_PUBLIC_RPC_URLS[0], { timeout: 10_000, retryCount: 2 }) });
  }
  return createPublicClient({ chain, transport: custom(window.ethereum!) });
}

/** Chain ID (as the 0x-prefixed hex string useWallet.ts's `chainId` uses) the settlement contract is actually configured for — never hardcoded, derived from the same NEXT_PUBLIC_SETTLEMENT_CHAIN_ID resolveChain() reads, so a caller can validate the wallet is on the RIGHT chain for settlement specifically (which may differ from BSC mainnet on a testnet-first deployment). */
export function getSettlementChainIdHex(): `0x${string}` {
  return `0x${resolveChain().id.toString(16)}`;
}

export async function readUsdtBalance(ownerAddress: Address): Promise<bigint> {
  const usdt = getSettlementUsdtAddress();
  if (!usdt) throw new Error("Settlement contract is not configured for this deployment.");
  return publicClient().readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [ownerAddress] });
}

export async function readUsdtAllowance(ownerAddress: Address): Promise<bigint> {
  const usdt = getSettlementUsdtAddress();
  const contract = getSettlementContractAddress();
  if (!usdt || !contract) throw new Error("Settlement contract is not configured for this deployment.");
  return publicClient().readContract({ address: usdt, abi: erc20Abi, functionName: "allowance", args: [ownerAddress, contract] });
}

export async function approveUsdt(ownerAddress: Address, amount: bigint): Promise<`0x${string}`> {
  const usdt = getSettlementUsdtAddress();
  const contract = getSettlementContractAddress();
  if (!usdt || !contract) throw new Error("Settlement contract is not configured for this deployment.");

  return walletClient().writeContract({
    account: ownerAddress,
    address: usdt,
    abi: erc20Abi,
    functionName: "approve",
    args: [contract, amount],
  });
}

/** Tops up the contract's USDT reserve — permissionless on the contract itself (anyone may fund it), requires a prior approveUsdt() for at least `amount`. */
export async function fundReserveOnChain(ownerAddress: Address, amount: bigint): Promise<`0x${string}`> {
  const contract = getSettlementContractAddress();
  if (!contract) throw new Error("Settlement contract is not configured for this deployment.");

  return walletClient().writeContract({
    account: ownerAddress,
    address: contract,
    abi: SETTLEMENT_CONTRACT_ABI,
    functionName: "fundReserve",
    args: [amount],
  });
}

export async function readReserveStatus(): Promise<{ totalReserve: bigint; availableReserve: bigint; totalLockedForActivePolicies: bigint } | null> {
  const contract = getSettlementContractAddress();
  if (!contract) return null;
  const [totalReserve, availableReserve, totalLockedForActivePolicies] = await Promise.all([
    publicClient().readContract({ address: contract, abi: SETTLEMENT_CONTRACT_ABI, functionName: "totalReserve" }),
    publicClient().readContract({ address: contract, abi: SETTLEMENT_CONTRACT_ABI, functionName: "availableReserve" }),
    publicClient().readContract({ address: contract, abi: SETTLEMENT_CONTRACT_ABI, functionName: "totalLockedForActivePolicies" }),
  ]);
  return { totalReserve, availableReserve, totalLockedForActivePolicies };
}

/** The contract's owner() — withdrawReserve is owner-only; callers check the connected wallet against this before ever attempting a withdrawal. */
export async function readSettlementOwner(): Promise<Address | null> {
  const contract = getSettlementContractAddress();
  if (!contract) return null;
  return publicClient().readContract({ address: contract, abi: SETTLEMENT_CONTRACT_ABI, functionName: "owner" });
}

/**
 * Withdraws `amount` of the settlement contract's reserve to `to` —
 * owner-only on the contract itself, and capped there to never exceed
 * `availableReserve()` (never lets locked policy funds move). This client
 * function does not re-implement either check; WithdrawReserveSection.tsx
 * validates both (lib/protection/withdrawalValidation.ts) before calling
 * this, and the contract enforces them again regardless.
 */
export async function withdrawReserveOnChain(ownerAddress: Address, amount: bigint, to: Address): Promise<`0x${string}`> {
  const contract = getSettlementContractAddress();
  if (!contract) throw new Error("Settlement contract is not configured for this deployment.");

  return walletClient().writeContract({
    account: ownerAddress,
    address: contract,
    abi: SETTLEMENT_CONTRACT_ABI,
    functionName: "withdrawReserve",
    args: [amount, to],
  });
}

export interface PurchaseProtectionParams {
  ownerAddress: Address;
  underlyingTicker: string;
  tokenizedStockContract: Address;
  wrapper: Wrapper;
  coveredPositionValue: bigint;
  thresholdBps: bigint;
  premiumAmount: bigint;
  maxPayoutAmount: bigint;
  expiryTime: bigint;
  protectionSessionId: string;
}

function purchaseProtectionArgs(params: PurchaseProtectionParams) {
  return [
    {
      underlyingTicker: params.underlyingTicker,
      tokenizedStockContract: params.tokenizedStockContract,
      wrapper: CONTRACT_WRAPPER_INDEX[params.wrapper as keyof typeof CONTRACT_WRAPPER_INDEX],
      coveredPositionValue: params.coveredPositionValue,
      thresholdBps: params.thresholdBps,
      premiumAmount: params.premiumAmount,
      maxPayoutAmount: params.maxPayoutAmount,
      expiryTime: params.expiryTime,
      protectionSessionId: hashProtectionSessionId(params.protectionSessionId),
    },
  ] as const;
}

/**
 * Gas-free dry run of purchaseProtection with the exact same args the real
 * call below will use — lets a caller (PurchaseProtectionButton.tsx) catch
 * a would-revert condition (e.g. insufficient allowance, a paused
 * contract, bad params) and show a clear error BEFORE ever prompting a
 * wallet signature, the same "validate, then sign" order BuySpotPanel.tsx
 * already uses for the swap flow.
 */
export async function simulatePurchaseProtection(params: PurchaseProtectionParams): Promise<void> {
  const contract = getSettlementContractAddress();
  if (!contract) throw new Error("Settlement contract is not configured for this deployment.");

  await publicClient().simulateContract({
    account: params.ownerAddress,
    address: contract,
    abi: SETTLEMENT_CONTRACT_ABI,
    functionName: "purchaseProtection",
    args: purchaseProtectionArgs(params),
  });
}

/**
 * Reads back the real on-chain policyId a CONFIRMED purchaseProtection
 * transaction created, by decoding its own PolicyPurchased event — never
 * guessed from nextPolicyId() (which would be racy if another purchase
 * happened concurrently). Returns null if the receipt has no such event
 * (e.g. hash is wrong, or the tx reverted — callers should only call this
 * after waitForSettlementTransaction() already confirmed "success").
 */
export async function getPolicyIdFromPurchaseReceipt(hash: `0x${string}`): Promise<bigint | null> {
  const receipt = await publicClient().getTransactionReceipt({ hash });
  const events = parseEventLogs({ abi: SETTLEMENT_CONTRACT_ABI, logs: receipt.logs, eventName: "PolicyPurchased" });
  return events[0]?.args.policyId ?? null;
}

export async function purchaseProtectionOnChain(params: PurchaseProtectionParams): Promise<`0x${string}`> {
  const contract = getSettlementContractAddress();
  if (!contract) throw new Error("Settlement contract is not configured for this deployment.");

  return walletClient().writeContract({
    account: params.ownerAddress,
    address: contract,
    abi: SETTLEMENT_CONTRACT_ABI,
    functionName: "purchaseProtection",
    args: purchaseProtectionArgs(params),
  });
}

export type SettlementReceiptOutcome = "success" | "reverted";

/**
 * Waits for a submitted settlement transaction (approve/purchase) to
 * actually be mined and reports its REAL on-chain outcome — never assumes
 * success just because the wallet accepted/returned a hash. Mirrors
 * spotPurchaseClient.ts's waitForTransaction() exactly, using THIS file's
 * own publicClient() (the settlement contract's configured chain, which
 * may be BSC testnet rather than mainnet on a testnet-first deployment).
 */
export async function waitForSettlementTransaction(hash: `0x${string}`): Promise<SettlementReceiptOutcome> {
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  return receipt.status === "success" ? "success" : "reverted";
}

export interface SerializedSettlementAuthorization {
  policyId: string;
  eligible: boolean;
  finalReferencePrice: string;
  settlementTimestamp: string;
  authorizationExpiry: string;
  nonce: string;
}

/** Submits the backend-signed authorization on-chain — permissionless by design (see the contract's own doc comment), so the user's own wallet can be the one to call this, no separate relayer required for the demo. */
export async function resolveSettlementOnChain(
  callerAddress: Address,
  policyId: bigint,
  auth: SerializedSettlementAuthorization,
  signature: `0x${string}`
): Promise<`0x${string}`> {
  const contract = getSettlementContractAddress();
  if (!contract) throw new Error("Settlement contract is not configured for this deployment.");

  return walletClient().writeContract({
    account: callerAddress,
    address: contract,
    abi: SETTLEMENT_CONTRACT_ABI,
    functionName: "resolveSettlement",
    args: [
      policyId,
      {
        policyId: BigInt(auth.policyId),
        eligible: auth.eligible,
        finalReferencePrice: BigInt(auth.finalReferencePrice),
        settlementTimestamp: BigInt(auth.settlementTimestamp),
        authorizationExpiry: BigInt(auth.authorizationExpiry),
        nonce: BigInt(auth.nonce),
      },
      signature,
    ],
  });
}

export async function claimPayoutOnChain(ownerAddress: Address, policyId: bigint): Promise<`0x${string}`> {
  const contract = getSettlementContractAddress();
  if (!contract) throw new Error("Settlement contract is not configured for this deployment.");

  return walletClient().writeContract({
    account: ownerAddress,
    address: contract,
    abi: SETTLEMENT_CONTRACT_ABI,
    functionName: "claimPayout",
    args: [policyId],
  });
}

export async function readPolicyStatus(policyId: bigint): Promise<number | null> {
  const contract = getSettlementContractAddress();
  if (!contract) return null;
  const policy = await publicClient().readContract({
    address: contract,
    abi: SETTLEMENT_CONTRACT_ABI,
    functionName: "getPolicy",
    args: [policyId],
  });
  return policy.status;
}
