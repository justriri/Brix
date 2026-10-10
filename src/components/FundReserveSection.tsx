"use client";

import { useEffect, useState } from "react";
import { parseUnits, formatUnits, type Address } from "viem";
import type { WalletState } from "@/lib/useWallet";
import {
  approveUsdt,
  fundReserveOnChain,
  getSettlementChainIdHex,
  getSettlementContractAddress,
  getSettlementUsdtAddress,
  readReserveStatus,
  readUsdtAllowance,
  waitForSettlementTransaction,
} from "@/lib/protection/settlementContractClient";
import { mapTransactionError, type TransactionErrorInfo } from "@/lib/invest/transactionErrors";
import { recordActivity } from "@/lib/brixActivity";

const USDT_DECIMALS = 18; // Binance-Peg BSC-USD, confirmed live — see SettlementDemo.tsx / SETTLEMENT.md.
const MAINNET_CHAIN_ID_HEX = "0x38"; // 56

/**
 * Standalone "fund the protection reserve" UI — previously only reachable
 * buried inside SettlementDemo.tsx's full purchase/resolve/claim demo flow
 * (itself only rendered after drilling into Markets -> a specific wrapper
 * -> Buy -> Verify -> Protect -> Get a quote), which is why it wasn't
 * actually findable in the running app. This reuses the EXISTING,
 * already-fixed funding sequence (approveUsdt -> wait -> fundReserveOnChain
 * -> wait -> re-read totalReserve()/availableReserve()) — no new funding
 * mechanism, no new contract. See SettlementDemo.tsx's own "Fund reserve"
 * button for the logic this mirrors.
 *
 * Checks the existing USDT allowance first and skips re-approving if it's
 * already sufficient — never requests an unlimited allowance, only ever
 * the exact amount being funded (same as every other approval in this app).
 *
 * Never auto-executes: every transaction requires an explicit click, and
 * the wallet's own confirm dialog is the real authorization step.
 */
export function FundReserveSection({ wallet }: { wallet: WalletState }) {
  const contractAddress = getSettlementContractAddress();
  const usdtAddress = getSettlementUsdtAddress();
  const settlementChainHex = getSettlementChainIdHex();
  const wrongSettlementChain = Boolean(wallet.chainId && wallet.chainId !== settlementChainHex);
  const networkLabel = settlementChainHex === MAINNET_CHAIN_ID_HEX ? "BNB Smart Chain Mainnet (chain ID 56)" : `BNB Smart Chain Testnet (chain ID ${parseInt(settlementChainHex, 16)})`;

  const [amountRaw, setAmountRaw] = useState("5");
  const [reserveStatus, setReserveStatus] = useState<{ totalReserve: bigint; availableReserve: bigint } | null>(null);
  const [loadingReserve, setLoadingReserve] = useState(false);

  type Phase = "idle" | "approving" | "funding" | "confirming" | "done" | "failed";
  type Stage = "allowance check" | "USDT approval" | "reserve funding" | "transaction confirmation" | "wallet";
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<(TransactionErrorInfo & { stage: Stage; hadHash: boolean }) | null>(null);
  const [lastTxHash, setLastTxHash] = useState<`0x${string}` | null>(null);

  async function refreshReserve() {
    if (!contractAddress) return;
    setLoadingReserve(true);
    try {
      setReserveStatus(await readReserveStatus());
    } catch {
      // Best-effort display only — a failed refresh doesn't block anything else.
    } finally {
      setLoadingReserve(false);
    }
  }

  // Fetching the real on-chain reserve once, right when this section
  // mounts, is a deliberate response to the component appearing at all
  // (so the numbers shown are never stale from a previous mount) — not
  // state derivable from render, matching this app's existing pattern for
  // this lint rule (e.g. SellSpotPanel.tsx's balance-loading effect).
  useEffect(() => {
    let cancelled = false;
    if (!contractAddress) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingReserve(true);
    readReserveStatus()
      .then((status) => {
        if (!cancelled) setReserveStatus(status);
      })
      .catch(() => {
        // Best-effort display only.
      })
      .finally(() => {
        if (!cancelled) setLoadingReserve(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contractAddress]);

  if (!contractAddress || !usdtAddress) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface-2 p-4 text-xs text-muted-2">
        No settlement contract is configured for this environment (NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS /
        NEXT_PUBLIC_USDT_ADDRESS are unset) — reserve funding is unavailable here.
      </div>
    );
  }

  const amountNum = Number(amountRaw);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const busy = phase === "approving" || phase === "funding" || phase === "confirming";

  async function fund() {
    if (!wallet.address) {
      setError({ userMessage: "No wallet is connected.", rawMessage: "No wallet is connected.", stage: "wallet", hadHash: false });
      return;
    }
    if (wrongSettlementChain) {
      setError({
        userMessage: `Your wallet is on the wrong network. Switch to ${networkLabel} to continue.`,
        rawMessage: `wallet.chainId=${wallet.chainId}, expected ${settlementChainHex}`,
        stage: "wallet",
        hadHash: false,
      });
      return;
    }

    setError(null);
    setLastTxHash(null);
    const owner = wallet.address as Address;
    const amount = parseUnits(amountRaw, USDT_DECIMALS);

    let allowance: bigint;
    try {
      allowance = await readUsdtAllowance(owner);
    } catch (err) {
      setError({ ...mapTransactionError(err), stage: "allowance check", hadHash: false });
      setPhase("failed");
      return;
    }

    if (allowance < amount) {
      setPhase("approving");
      let approveHash: `0x${string}`;
      try {
        approveHash = await approveUsdt(owner, amount);
      } catch (err) {
        setError({ ...mapTransactionError(err), stage: "USDT approval", hadHash: false });
        setPhase("failed");
        return;
      }
      setLastTxHash(approveHash);
      recordActivity({ type: "settlement-approve", label: `Approved ${amountRaw} USDT to fund the protection reserve`, hash: approveHash });

      let approveOutcome: "success" | "reverted";
      try {
        approveOutcome = await waitForSettlementTransaction(approveHash);
      } catch (err) {
        setError({ ...mapTransactionError(err), stage: "USDT approval", hadHash: true });
        setPhase("failed");
        return;
      }
      if (approveOutcome !== "success") {
        setError({
          userMessage: "The USDT approval transaction reverted on-chain. The reserve was not funded.",
          rawMessage: `approval tx ${approveHash} reverted`,
          stage: "USDT approval",
          hadHash: true,
        });
        setPhase("failed");
        return;
      }
    }

    setPhase("funding");
    let fundHash: `0x${string}`;
    try {
      fundHash = await fundReserveOnChain(owner, amount);
    } catch (err) {
      setError({ ...mapTransactionError(err), stage: "reserve funding", hadHash: false });
      setPhase("failed");
      return;
    }
    setLastTxHash(fundHash);
    recordActivity({ type: "settlement-fund-reserve", label: `Funded settlement reserve with ${amountRaw} USDT`, hash: fundHash });

    setPhase("confirming");
    let fundOutcome: "success" | "reverted";
    try {
      fundOutcome = await waitForSettlementTransaction(fundHash);
    } catch (err) {
      setError({ ...mapTransactionError(err), stage: "transaction confirmation", hadHash: true });
      setPhase("failed");
      return;
    }
    if (fundOutcome !== "success") {
      setError({
        userMessage: "The fund-reserve transaction was submitted and mined, but REVERTED on-chain. Reserve was not updated.",
        rawMessage: `fund tx ${fundHash} reverted`,
        stage: "transaction confirmation",
        hadHash: true,
      });
      setPhase("failed");
      return;
    }

    setPhase("done");
    await refreshReserve();
  }

  const buttonLabel: Record<Phase, string> = {
    idle: "Fund reserve",
    approving: "Approving USDT…",
    funding: "Waiting for wallet…",
    confirming: "Confirming…",
    done: "Fund reserve",
    failed: "Fund reserve",
  };

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-2 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-foreground/90">Fund Protection Reserve</p>
        <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand ring-1 ring-inset ring-brand/30">
          Real on-chain — {networkLabel}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-3">
        <dt className="text-muted-2">Settlement contract</dt>
        <dd className="break-all text-foreground/90">{contractAddress}</dd>
        <dt className="text-muted-2">USDT token</dt>
        <dd className="break-all text-foreground/90">{usdtAddress}</dd>
        <dt className="text-muted-2">Connected wallet</dt>
        <dd className="break-all text-foreground/90">{wallet.address ?? "Not connected"}</dd>
        <dt className="text-muted-2">Network</dt>
        <dd className={wrongSettlementChain ? "text-amber-400" : "text-foreground/90"}>
          {networkLabel}
          {wrongSettlementChain && " — your wallet is on a different network"}
        </dd>
      </dl>

      <div className="mt-3 rounded-lg border border-border-subtle bg-surface p-3 text-xs">
        <div className="flex items-center justify-between">
          <p className="text-muted-2">Current reserve (live, from the deployed contract)</p>
          <button type="button" onClick={refreshReserve} disabled={loadingReserve} className="text-muted-2 underline disabled:opacity-40">
            {loadingReserve ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <dl className="mt-1 grid grid-cols-2 gap-y-1">
          <dt className="text-muted-2">Total reserve</dt>
          <dd className="text-right tabular-nums">{reserveStatus ? `${formatUnits(reserveStatus.totalReserve, USDT_DECIMALS)} USDT` : "—"}</dd>
          <dt className="text-muted-2">Available reserve</dt>
          <dd className="text-right tabular-nums">{reserveStatus ? `${formatUnits(reserveStatus.availableReserve, USDT_DECIMALS)} USDT` : "—"}</dd>
        </dl>
      </div>

      {!wallet.address && <p className="mt-3 text-xs text-muted-2">Connect a wallet to fund the reserve.</p>}

      {wallet.address && (
        <div className="mt-3 flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            Amount (USDT)
            <input
              value={amountRaw}
              disabled={busy}
              onChange={(e) => {
                setAmountRaw(e.target.value);
                setError(null);
              }}
              className="w-24 rounded border border-border-subtle bg-transparent px-2 py-1 text-foreground disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            onClick={fund}
            disabled={busy || !amountValid}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-40"
          >
            {buttonLabel[phase]}
          </button>
        </div>
      )}

      {phase === "done" && !error && (
        <p className="mt-2 text-xs text-emerald-400">✓ Reserve funded and confirmed on-chain. Values above are the real, refreshed on-chain numbers.</p>
      )}

      {lastTxHash && <p className="mt-2 break-all text-xs text-muted-2">Last transaction: {lastTxHash}</p>}

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
        Funding is permissionless (anyone may top up the reserve) and uses a limited USDT approval for exactly the
        amount entered — never an unlimited allowance. Approval and funding are two separate transactions; each
        requires your explicit confirmation in your wallet.
      </p>
    </div>
  );
}
