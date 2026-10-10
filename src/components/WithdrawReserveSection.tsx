"use client";

import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import type { WalletState } from "@/lib/useWallet";
import {
  getSettlementChainIdHex,
  getSettlementContractAddress,
  getSettlementUsdtAddress,
  readReserveStatus,
  readSettlementOwner,
  waitForSettlementTransaction,
  withdrawReserveOnChain,
} from "@/lib/protection/settlementContractClient";
import { validateWithdrawal } from "@/lib/protection/withdrawalValidation";
import { mapTransactionError, type TransactionErrorInfo } from "@/lib/invest/transactionErrors";
import { recordActivity } from "@/lib/brixActivity";

const USDT_DECIMALS = 18; // Binance-Peg BSC-USD, confirmed live — see SettlementDemo.tsx / SETTLEMENT.md.
const MAINNET_CHAIN_ID_HEX = "0x38"; // 56

/**
 * Owner-only "withdraw unused reserve" UI — the counterpart to
 * FundReserveSection.tsx, calling the SAME deployed contract's existing
 * withdrawReserve(amount, to) (owner-only, capped at availableReserve on
 * the contract itself; see WeekendGuardSettlement.sol). No new contract,
 * no second funding mechanism — only a client wrapper + a pure validator
 * (lib/protection/withdrawalValidation.ts) added on top of what already
 * existed.
 *
 * Deliberately separate from claimPayout/resolveSettlement/policy expiry:
 * this component never touches any policy, never calls any other
 * contract function, and the contract's own cap already makes it
 * impossible for this to move a locked policy's funds.
 *
 * Every number shown (total/locked/available reserve, owner address) is
 * read live from the deployed contract, never cached/assumed — and
 * re-read again immediately before submitting, so a stale frontend
 * balance can never be the basis for a withdrawal attempt.
 */
export function WithdrawReserveSection({ wallet }: { wallet: WalletState }) {
  const contractAddress = getSettlementContractAddress();
  const usdtAddress = getSettlementUsdtAddress();
  const settlementChainHex = getSettlementChainIdHex();
  const wrongSettlementChain = Boolean(wallet.chainId && wallet.chainId !== settlementChainHex);
  const networkLabel = settlementChainHex === MAINNET_CHAIN_ID_HEX ? "BNB Smart Chain Mainnet (chain ID 56)" : `BNB Smart Chain Testnet (chain ID ${parseInt(settlementChainHex, 16)})`;

  const [reserveStatus, setReserveStatus] = useState<{ totalReserve: bigint; availableReserve: bigint; totalLockedForActivePolicies: bigint } | null>(null);
  const [owner, setOwner] = useState<Address | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [amountRaw, setAmountRaw] = useState("");
  const [recipientRaw, setRecipientRaw] = useState("");

  type Phase = "idle" | "awaiting-approval" | "pending" | "done" | "failed";
  type Stage = "validation" | "wallet signing" | "transaction confirmation";
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<(TransactionErrorInfo & { stage: Stage; hadHash: boolean }) | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  async function refreshStatus() {
    if (!contractAddress) return;
    setLoadingStatus(true);
    try {
      const [status, ownerAddress] = await Promise.all([readReserveStatus(), readSettlementOwner()]);
      setReserveStatus(status);
      setOwner(ownerAddress);
    } catch {
      // Best-effort display only.
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!contractAddress) return;
    // Fetching the real on-chain reserve/owner once, right when this
    // section mounts, is a deliberate response to the component appearing
    // at all — not state derivable from render (same pattern already used
    // by FundReserveSection.tsx for this exact lint rule).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingStatus(true);
    Promise.all([readReserveStatus(), readSettlementOwner()])
      .then(([status, ownerAddress]) => {
        if (cancelled) return;
        setReserveStatus(status);
        setOwner(ownerAddress);
      })
      .catch(() => {
        // Best-effort display only.
      })
      .finally(() => {
        if (!cancelled) setLoadingStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contractAddress]);

  // Default the recipient to the connected wallet once it's known, but
  // only if the user hasn't typed something else already.
  useEffect(() => {
    if (wallet.address && !recipientRaw) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecipientRaw(wallet.address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address]);

  if (!contractAddress || !usdtAddress) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface-2 p-4 text-xs text-muted-2">
        No settlement contract is configured for this environment — reserve withdrawal is unavailable here.
      </div>
    );
  }

  const isOwner = Boolean(wallet.address && owner && wallet.address.toLowerCase() === owner.toLowerCase());
  const busy = phase === "awaiting-approval" || phase === "pending";

  async function withdraw() {
    setError(null);
    setTxHash(null);

    if (!wallet.address) {
      setError({ userMessage: "No wallet is connected.", rawMessage: "No wallet is connected.", stage: "validation", hadHash: false });
      return;
    }

    // Re-read the latest on-chain figures immediately before validating —
    // never trust whatever is still on screen from the last refresh.
    let latest: { totalReserve: bigint; availableReserve: bigint; totalLockedForActivePolicies: bigint } | null;
    let latestOwner: Address | null;
    try {
      [latest, latestOwner] = await Promise.all([readReserveStatus(), readSettlementOwner()]);
    } catch (err) {
      setError({ ...mapTransactionError(err), stage: "validation", hadHash: false });
      setPhase("failed");
      return;
    }
    setReserveStatus(latest);
    setOwner(latestOwner);

    const validation = validateWithdrawal({
      amountRaw,
      recipientRaw,
      availableReserveRaw: latest?.availableReserve ?? BigInt(0),
      decimals: USDT_DECIMALS,
      isOwner: Boolean(wallet.address && latestOwner && wallet.address.toLowerCase() === latestOwner.toLowerCase()),
      correctChain: !wrongSettlementChain,
    });

    if (!validation.valid) {
      setError({ userMessage: validation.reason, rawMessage: validation.reason, stage: "validation", hadHash: false });
      return;
    }

    setPhase("awaiting-approval");
    let hash: `0x${string}`;
    try {
      hash = await withdrawReserveOnChain(wallet.address as Address, validation.amount, validation.recipient);
    } catch (err) {
      setError({ ...mapTransactionError(err), stage: "wallet signing", hadHash: false });
      setPhase("failed");
      return;
    }
    setTxHash(hash);
    recordActivity({ type: "settlement-withdraw-reserve", label: `Withdrew ${amountRaw} USDT from the protection reserve to ${validation.recipient}`, hash });

    setPhase("pending");
    let outcome: "success" | "reverted";
    try {
      outcome = await waitForSettlementTransaction(hash);
    } catch (err) {
      setError({ ...mapTransactionError(err), stage: "transaction confirmation", hadHash: true });
      setPhase("failed");
      return;
    }
    if (outcome !== "success") {
      setError({
        userMessage: "The withdrawal transaction was submitted and mined, but REVERTED on-chain. No funds were withdrawn.",
        rawMessage: `tx ${hash} reverted`,
        stage: "transaction confirmation",
        hadHash: true,
      });
      setPhase("failed");
      return;
    }

    setPhase("done");
    await refreshStatus();
  }

  const buttonLabel: Record<Phase, string> = {
    idle: "Withdraw",
    "awaiting-approval": "Waiting for wallet…",
    pending: "Confirming…",
    done: "Withdraw",
    failed: "Withdraw",
  };

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-2 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-foreground/90">Withdraw Reserve</p>
        <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand ring-1 ring-inset ring-brand/30">
          Owner-only — {networkLabel}
        </span>
      </div>

      <div className="rounded-lg border border-border-subtle bg-surface p-3 text-xs">
        <div className="flex items-center justify-between">
          <p className="text-muted-2">Current reserve (live, from the deployed contract)</p>
          <button type="button" onClick={refreshStatus} disabled={loadingStatus} className="text-muted-2 underline disabled:opacity-40">
            {loadingStatus ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <dl className="mt-1 grid grid-cols-2 gap-y-1">
          <dt className="text-muted-2">Total reserve</dt>
          <dd className="text-right tabular-nums">{reserveStatus ? `${formatUnits(reserveStatus.totalReserve, USDT_DECIMALS)} USDT` : "—"}</dd>
          <dt className="text-muted-2">Locked (active policies)</dt>
          <dd className="text-right tabular-nums">{reserveStatus ? `${formatUnits(reserveStatus.totalLockedForActivePolicies, USDT_DECIMALS)} USDT` : "—"}</dd>
          <dt className="text-muted-2">Available to withdraw</dt>
          <dd className="text-right tabular-nums font-medium text-foreground">{reserveStatus ? `${formatUnits(reserveStatus.availableReserve, USDT_DECIMALS)} USDT` : "—"}</dd>
        </dl>
      </div>

      {!wallet.address && <p className="mt-3 text-xs text-muted-2">Connect a wallet to withdraw.</p>}

      {wallet.address && !isOwner && (
        <p className="mt-3 text-xs text-amber-400">
          Connected wallet is not the contract owner ({owner ?? "unknown"}) — withdrawal is only available to the owner.
        </p>
      )}

      {wallet.address && isOwner && (
        <div className="mt-3 space-y-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Amount (USDT)
            <input
              value={amountRaw}
              disabled={busy}
              onChange={(e) => {
                setAmountRaw(e.target.value);
                setError(null);
              }}
              placeholder="0.0"
              className="w-full rounded border border-border-subtle bg-transparent px-2 py-1 text-foreground disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Recipient address
            <input
              value={recipientRaw}
              disabled={busy}
              onChange={(e) => {
                setRecipientRaw(e.target.value);
                setError(null);
              }}
              className="w-full rounded border border-border-subtle bg-transparent px-2 py-1 font-mono text-foreground disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            onClick={withdraw}
            disabled={busy}
            className="w-full rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-40"
          >
            {buttonLabel[phase]}
          </button>
        </div>
      )}

      {phase === "done" && !error && (
        <p className="mt-2 text-xs text-emerald-400">✓ Withdrawal confirmed on-chain. Values above are the real, refreshed on-chain numbers.</p>
      )}

      {txHash && <p className="mt-2 break-all text-xs text-muted-2">Last transaction: {txHash}</p>}

      {error && (
        <div className="mt-2 text-xs text-red-400">
          <p className="font-medium">Failed during {error.stage}: {error.userMessage}</p>
          <p className="mt-1 text-muted-2">
            {error.hadHash ? "A transaction was submitted — this failure happened after signing." : "No transaction was submitted — this failed before anything was signed or broadcast."}
          </p>
          <details className="mt-1 text-muted-2">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-1 break-all">{error.rawMessage}</p>
          </details>
        </div>
      )}

      <p className="mt-2 text-xs text-muted-2">
        Withdrawal amount and recipient are validated client-side AND enforced by the contract itself — the contract
        caps every withdrawal at <code>totalReserve - totalLockedForActivePolicies</code>, so funds backing an
        active policy can never be withdrawn. Nothing submits automatically; your wallet&apos;s own confirmation is the
        real authorization step.
      </p>
    </div>
  );
}
