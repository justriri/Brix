import { createPublicClient, fallback, http, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";
// Relative import WITH an explicit .ts extension — this file is now
// imported transitively by settlementAuthorizationIssuer.ts, which must
// stay resolvable by Node's test runner directly, not just Next's bundler.
import { SETTLEMENT_CONTRACT_ABI } from "./settlementContractAbi.ts";
import { BSC_PUBLIC_RPC_URLS } from "../config/assets.ts";

/**
 * Server-side, read-only on-chain policy lookup — the piece the security
 * patch adds (see reports/Settlement audit and deployment readiness.md,
 * section E/L: "prefer an on-chain binding... use getPolicy(policyId)").
 *
 * Deliberately separate from settlementContractClient.ts, which is
 * "use client" and browser-only (its `publicClient()` wraps
 * `window.ethereum`, which does not exist on the server). This file uses a
 * plain HTTP transport instead — the chain's own default public RPC via
 * viem/chains, no new env var required, matching the same
 * NEXT_PUBLIC_SETTLEMENT_CHAIN_ID selection the browser side already uses
 * (reading a NEXT_PUBLIC_ var server-side is fine; it's just also inlined
 * client-side).
 *
 * Also deliberately separate from chain.ts, which is hardcoded to BSC
 * MAINNET for real tokenized-stock balance reads elsewhere in the app —
 * the settlement contract may be deployed on testnet, a different chain
 * selection, so this does not reuse or modify chain.ts.
 */

function resolveChain() {
  const chainId = Number(process.env.NEXT_PUBLIC_SETTLEMENT_CHAIN_ID ?? "97");
  return chainId === 56 ? bsc : bscTestnet;
}

/**
 * PRODUCTION RESILIENCE FIX: this used to call `http()` with no URL at
 * all, which falls back to viem/chains' own built-in default RPC for BSC —
 * independently observed elsewhere in this codebase
 * (spotPurchaseClient.ts's own comment) to return HTTP 429 under load.
 * For mainnet, now explicitly falls through BSC_PUBLIC_RPC_URLS (same
 * vetted list chain.ts uses) via viem's fallback() transport. Testnet has
 * no equivalent vetted list in this codebase, so it keeps using viem's
 * default there — unchanged for that case.
 */
function readOnlyClient() {
  const chain = resolveChain();
  if (chain.id === bsc.id) {
    return createPublicClient({
      chain,
      transport: fallback(BSC_PUBLIC_RPC_URLS.map((url) => http(url, { timeout: 8_000, retryCount: 0 }))),
    });
  }
  return createPublicClient({ chain, transport: http() });
}

export interface OnChainPolicySummary {
  policyId: string;
  owner: Address;
  underlyingTicker: string;
  tokenizedStockContract: Address;
  /** Raw Wrapper enum value: 0 BSTOCKS, 1 ONDO, 2 XSTOCKS. */
  wrapper: number;
  coveredPositionValue: bigint;
  thresholdBps: bigint;
  premiumAmount: bigint;
  maxPayoutAmount: bigint;
  startTime: bigint;
  expiryTime: bigint;
  protectionSessionId: `0x${string}`;
  /** Raw PolicyStatus enum value: 0 NONE, 1 ACTIVE, 2 ELIGIBLE, 3 CLAIMED, 4 CLOSED_NO_PAYOUT. */
  status: number;
  settled: boolean;
}

function toSummary(policyId: bigint, policy: {
  owner: Address;
  underlyingTicker: string;
  tokenizedStockContract: Address;
  wrapper: number;
  coveredPositionValue: bigint;
  thresholdBps: bigint;
  premiumAmount: bigint;
  maxPayoutAmount: bigint;
  startTime: bigint;
  expiryTime: bigint;
  protectionSessionId: `0x${string}`;
  status: number;
  settled: boolean;
}): OnChainPolicySummary {
  return { policyId: policyId.toString(), ...policy };
}

/**
 * Reads a policy directly from the deployed contract. Returns `null` if the
 * contract is unreachable/misconfigured — callers must fail closed on
 * `null`, never assume a binding match in that case. A policyId that was
 * never created is NOT an error at the contract level (Solidity mappings
 * zero-initialize) — it comes back with `status: 0` (NONE), which callers
 * must explicitly reject as "no such policy," not treat as a valid binding.
 */
export async function getOnChainPolicy(
  contractAddress: Address,
  policyId: bigint
): Promise<OnChainPolicySummary | null> {
  try {
    const client = readOnlyClient();
    const policy = await client.readContract({
      address: contractAddress,
      abi: SETTLEMENT_CONTRACT_ABI,
      functionName: "getPolicy",
      args: [policyId],
    });
    return toSummary(policyId, policy);
  } catch {
    return null;
  }
}

/**
 * The contract has no owner-indexed getter — `policies` is a plain
 * `mapping(uint256 => Policy)`, and `nextPolicyId` is the only way to know
 * how many have ever been created. This scans every policy id from 1 to
 * `nextPolicyId - 1` (small numbers for this MVP's real volume) and keeps
 * only the ones whose `owner` matches. Read-only, no signature, safe to call
 * from a public status endpoint. Returns an empty array (never throws) if
 * the contract is unreachable/misconfigured, so a caller can distinguish
 * "no policies" from "couldn't check" only by also checking `nextPolicyId`
 * separately if that distinction matters to it.
 */
export async function listPoliciesForOwner(contractAddress: Address, owner: Address): Promise<OnChainPolicySummary[]> {
  const client = readOnlyClient();
  let nextPolicyId: bigint;
  try {
    nextPolicyId = await client.readContract({
      address: contractAddress,
      abi: SETTLEMENT_CONTRACT_ABI,
      functionName: "nextPolicyId",
    });
  } catch {
    return [];
  }

  const ownerLower = owner.toLowerCase();
  const results: OnChainPolicySummary[] = [];
  for (let id = BigInt(1); id < nextPolicyId; id++) {
    const policy = await getOnChainPolicy(contractAddress, id);
    if (policy && policy.owner.toLowerCase() === ownerLower) {
      results.push(policy);
    }
  }
  return results;
}

/** The contract's trustedSigner() — lets a caller cross-check the configured SETTLEMENT_SIGNER_PRIVATE_KEY's own address actually matches what the deployed contract trusts, rather than assuming it. */
export async function getOnChainTrustedSigner(contractAddress: Address): Promise<Address | null> {
  try {
    const client = readOnlyClient();
    return await client.readContract({
      address: contractAddress,
      abi: SETTLEMENT_CONTRACT_ABI,
      functionName: "trustedSigner",
    });
  } catch {
    return null;
  }
}
