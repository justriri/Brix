"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import type { WalletState } from "@/lib/useWallet";
import {
  claimPayoutOnChain,
  getSettlementChainIdHex,
  getSettlementContractAddress,
  readUsdtBalance,
  resolveSettlementOnChain,
  waitForSettlementTransaction,
  type SerializedSettlementAuthorization,
} from "@/lib/protection/settlementContractClient";
import { mapTransactionError, type TransactionErrorInfo } from "@/lib/invest/transactionErrors";
import { recordActivity } from "@/lib/brixActivity";

const USDT_DECIMALS = 18;
const WRAPPER_NAMES = ["bStocks", "Ondo", "xStocks"];

interface PolicyStatus {
  policyId: string;
  underlyingTicker: string;
  wrapper: number;
  maxPayoutAmount: string;
  premiumAmount: string;
  expiryTime: string;
  onChainStatus: number;
  onChainStatusLabel: string;
  statusLabel: string;
  settlementOutcome?: string;
  settlementReason?: string;
  trustBrokenAt?: string;
  readyAuthorization?: {
    domain: { name: "WeekendGuardSettlement"; version: "1"; chainId: number; verifyingContract: `0x${string}` };
    authorization: SerializedSettlementAuthorization;
    signature: `0x${string}`;
  };
}

const STATUS_COPY: Record<string, { label: string; tone: string; explanation: string }> = {
  MONITORING_NOT_STARTED: {
    label: "Monitoring not started",
    tone: "bg-surface-3 text-muted",
    explanation: "This policy exists on-chain, but weekend monitoring hasn't registered for it yet. Reload in a moment — this is usually transient.",
  },
  MONITORING_IN_PROGRESS: {
    label: "Monitoring in progress",
    tone: "bg-brand/10 text-brand",
    explanation: "Trust and price checkpoints are being tracked through the protection window. Nothing to do yet — check back after expiry.",
  },
  SETTLED_AWAITING_AUTHORIZATION: {
    label: "Settled — awaiting authorization",
    tone: "bg-amber-500/10 text-amber-400",
    explanation: "A settlement decision was reached, but a signed authorization hasn't been generated yet (the settlement signer may not be configured). This requires an operator action, not yours.",
  },
  READY_TO_RESOLVE_ELIGIBLE: {
    label: "Eligible — ready to resolve",
    tone: "bg-emerald-500/10 text-emerald-400",
    explanation: "The protection threshold was crossed and trust held throughout the window. Resolve on-chain, then claim your payout.",
  },
  READY_TO_RESOLVE_NOT_ELIGIBLE: {
    label: "Not eligible — ready to resolve",
    tone: "bg-surface-3 text-muted",
    explanation: "Either the threshold wasn't crossed, or trust/data was broken/inconclusive during the window, so no payout applies. Resolving on-chain closes the policy and releases its reserve lock.",
  },
  RESOLVED_ELIGIBLE_AWAITING_CLAIM: {
    label: "Resolved — claim available",
    tone: "bg-emerald-500/10 text-emerald-400",
    explanation: "Settlement is confirmed on-chain and eligible. Claim your USDT payout below.",
  },
  CLAIMED: { label: "Claimed", tone: "bg-surface-3 text-muted", explanation: "This policy's payout has already been claimed." },
  CLOSED_NO_PAYOUT: { label: "Closed — no payout", tone: "bg-surface-3 text-muted", explanation: "This policy resolved with no payout and is closed." },
};

function ActionButton({
  wallet,
  policy,
  onDone,
}: {
  wallet: WalletState;
  policy: PolicyStatus;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<(TransactionErrorInfo & { hadHash: boolean }) | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  async function run(action: () => Promise<`0x${string}`>, activityLabel: string) {
    if (!wallet.address) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await action();
      setTxHash(hash);
      recordActivity({ type: "settlement-resolve", label: activityLabel, hash });
      const outcome = await waitForSettlementTransaction(hash);
      if (outcome !== "success") {
        setError({ userMessage: "The transaction was mined but reverted on-chain.", rawMessage: `tx ${hash} reverted`, hadHash: true });
        return;
      }
      onDone();
    } catch (err) {
      setError({ ...mapTransactionError(err), hadHash: Boolean(txHash) });
    } finally {
      setBusy(false);
    }
  }

  if (policy.statusLabel === "READY_TO_RESOLVE_ELIGIBLE" || policy.statusLabel === "READY_TO_RESOLVE_NOT_ELIGIBLE") {
    const auth = policy.readyAuthorization;
    if (!auth) return null;
    return (
      <div className="mt-3">
        <button
          type="button"
          disabled={busy || !wallet.address}
          onClick={() =>
            run(
              () => resolveSettlementOnChain(wallet.address as Address, BigInt(policy.policyId), auth.authorization, auth.signature),
              `Resolved settlement on-chain for policy ${policy.policyId}`
            )
          }
          className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Resolving…" : "Resolve settlement on-chain"}
        </button>
        {error && <ErrorNote error={error} txHash={txHash} />}
      </div>
    );
  }

  if (policy.statusLabel === "RESOLVED_ELIGIBLE_AWAITING_CLAIM") {
    return (
      <div className="mt-3">
        <button
          type="button"
          disabled={busy || !wallet.address}
          onClick={() =>
            run(
              () => claimPayoutOnChain(wallet.address as Address, BigInt(policy.policyId)),
              `Claimed USDT payout for policy ${policy.policyId}`
            )
          }
          className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Claiming…" : `Claim ${formatUnits(BigInt(policy.maxPayoutAmount), USDT_DECIMALS)} USDT`}
        </button>
        {error && <ErrorNote error={error} txHash={txHash} />}
      </div>
    );
  }

  return null;
}

function ErrorNote({ error, txHash }: { error: TransactionErrorInfo & { hadHash: boolean }; txHash: string | null }) {
  return (
    <div className="mt-2 text-xs text-red-400">
      <p className="font-medium">{error.userMessage}</p>
      {txHash && <p className="mt-1 break-all text-muted-2">Transaction: {txHash}</p>}
      <details className="mt-1 text-muted-2">
        <summary className="cursor-pointer">Technical details</summary>
        <p className="mt-1 break-all">{error.rawMessage}</p>
      </details>
    </div>
  );
}

/**
 * The customer-facing claim flow (PHASE 2E) — shows each real on-chain
 * policy the connected wallet owns, its actual monitoring/settlement
 * status (never "paid" merely because a decision was computed or a tx was
 * submitted — each stage is its own distinct status from
 * /api/protection-policy-status), and a Resolve/Claim action only when the
 * contract itself would actually accept it right now. Every button here
 * calls the REAL deployed contract via the connected wallet, same
 * validate-then-sign/wait-for-receipt pattern as PurchaseProtectionButton.tsx —
 * never fabricates a success.
 */
export function PolicyClaimSection({ wallet }: { wallet: WalletState }) {
  const [policies, setPolicies] = useState<PolicyStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<bigint | null>(null);
  const contractAddress = getSettlementContractAddress();

  const refresh = useCallback(() => {
    if (!wallet.address || !contractAddress) return;
    fetch(`/api/protection-policy-status?owner=${wallet.address}&contract=${contractAddress}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setError(null);
        setPolicies(d.policies);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load policy status."));
    readUsdtBalance(wallet.address as Address)
      .then(setUsdtBalance)
      .catch(() => {});
  }, [wallet.address, contractAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!contractAddress) return null;
  if (!wallet.address) return null;
  if (error) {
    return <p className="mt-4 text-sm text-red-400">Could not load protection policy status: {error}</p>;
  }
  if (!policies) {
    return <p className="mt-4 text-sm text-muted">Checking your Weekend Protection policies…</p>;
  }
  if (policies.length === 0) return null;

  const wrongChain = Boolean(wallet.chainId && wallet.chainId !== getSettlementChainIdHex());

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Weekend Protection — settlement & claims</h3>
        {usdtBalance !== null && (
          <p className="text-xs text-muted-2">Your USDT balance: {formatUnits(usdtBalance, USDT_DECIMALS)}</p>
        )}
      </div>
      {wrongChain && (
        <p className="text-xs text-amber-400">Your wallet is on the wrong network for this settlement contract — switch networks before resolving or claiming.</p>
      )}
      {policies.map((policy) => {
        const copy = STATUS_COPY[policy.statusLabel] ?? { label: policy.statusLabel, tone: "bg-surface-3 text-muted", explanation: "" };
        return (
          <div key={policy.policyId} className="rounded-xl border border-border-subtle bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">
                Policy #{policy.policyId} — {policy.underlyingTicker} ({WRAPPER_NAMES[policy.wrapper] ?? "unknown"})
              </p>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${copy.tone}`}>{copy.label}</span>
            </div>
            <p className="mt-1 text-xs text-muted-2">{copy.explanation}</p>
            {policy.settlementReason && <p className="mt-1 text-xs text-muted-2">Reason: {policy.settlementReason}</p>}
            <p className="mt-2 text-xs text-muted-2">
              Max payout: {formatUnits(BigInt(policy.maxPayoutAmount), USDT_DECIMALS)} USDT · Expiry: {new Date(Number(policy.expiryTime) * 1000).toLocaleString()}
            </p>
            <ActionButton wallet={wallet} policy={policy} onDone={refresh} />
          </div>
        );
      })}
    </div>
  );
}
