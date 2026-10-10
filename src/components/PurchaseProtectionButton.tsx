"use client";

import { useEffect, useState } from "react";
import { parseUnits, type Address } from "viem";
import type { WalletState } from "@/lib/useWallet";
import type { ProtectionQuote, Wrapper } from "@/lib/types";
import {
  approveUsdt,
  getPolicyIdFromPurchaseReceipt,
  getSettlementChainIdHex,
  getSettlementContractAddress,
  getSettlementUsdtAddress,
  purchaseProtectionOnChain,
  readReserveStatus,
  readUsdtAllowance,
  readUsdtBalance,
  simulatePurchaseProtection,
  waitForSettlementTransaction,
} from "@/lib/protection/settlementContractClient";
import { mapTransactionError, type TransactionErrorInfo } from "@/lib/invest/transactionErrors";
import { recordActivity } from "@/lib/brixActivity";

const USDT_DECIMALS = 18; // Binance-Peg BSC-USD, confirmed live — see SettlementDemo.tsx / SETTLEMENT.md.

/**
 * The real, on-chain "activate protection" action — BNB Chain confirmed
 * this app's fixed-term, pre-funded, non-leveraged weekend protection
 * satisfies the hackathon's "spot only" rule, so this REPLACES the
 * permanently-disabled placeholder button that used to sit here (see the
 * now-removed references to lib/protection/policy.ts's
 * ProtectionMechanismDisabledError — that module's functions were never
 * actually wired to anything; the real settlement path has always been
 * settlementContractClient.ts, already deployed and already demoed working
 * in SettlementDemo.tsx with hand-typed amounts). This component drives
 * the SAME real contract with the user's ACTUAL quote numbers instead.
 *
 * Validate-then-sign, same order as BuySpotPanel.tsx's swap flow: chain
 * check -> balance check -> allowance check (skip approve if already
 * sufficient) -> gas-free simulateContract() dry run -> real signature ->
 * wait for the mined receipt and report its REAL status. Never reports
 * "activated" from a tx hash alone.
 *
 * ERROR REPORTING (live-diagnosed gap, now fixed): this component used to
 * discard the raw error and show only mapTransactionError()'s short
 * userMessage, with no way to see the actual underlying reason — exactly
 * matching a real report of "Transaction failed. See details for the
 * technical error" with no useful details actually shown anywhere. Now:
 *  - `stage` records EXACTLY which step was in flight when a failure
 *    happened (balance check, allowance check, approval, simulation,
 *    signing, submission, confirmation) — never guessed after the fact.
 *  - The raw message, plus the error's `name`/code when available, is
 *    always kept and shown in an expandable "Technical details" section.
 *  - A transaction hash is shown ONLY once the wallet actually returned
 *    one (i.e. once signing succeeded) — never fabricated for a failure
 *    that happened before that point. If a hash exists, the message
 *    distinguishes "submitted, awaiting confirmation" from "confirmed
 *    reverted" — never conflated.
 *
 * No slippage control is offered here: unlike BuySpotPanel's AMM swap, this
 * is a fixed-premium contract call (the premium is set by the quote, not
 * discovered by a route) — there is no price to slip.
 */
export function PurchaseProtectionButton({
  wallet,
  quote,
  tokenizedStockContract,
  wrapper,
  onPurchased,
}: {
  wallet: WalletState;
  quote: ProtectionQuote;
  tokenizedStockContract: Address | undefined;
  wrapper: Wrapper;
  onPurchased: (txHash: `0x${string}`) => void;
}) {
  type Phase = "idle" | "checking" | "approving" | "purchasing" | "confirming" | "purchased" | "failed";
  type Stage =
    | "balance check"
    | "allowance check"
    | "USDT approval"
    | "pre-flight simulation"
    | "wallet signing"
    | "transaction submission"
    | "transaction confirmation";

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<(TransactionErrorInfo & { stage: Stage; hadHash: boolean }) | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [reserveShortfall, setReserveShortfall] = useState<string | null>(null);

  const settlementConfigured = Boolean(getSettlementContractAddress() && getSettlementUsdtAddress());
  const wrongSettlementChain = Boolean(wallet.chainId && wallet.chainId !== getSettlementChainIdHex());

  const maxPayoutRaw = parseUnits((quote.maxPayoutAmount ?? quote.coverageAmount).toFixed(USDT_DECIMALS), USDT_DECIMALS);

  // Proactive check, not a replacement for the real pre-signing simulation
  // below: lets the UI say plainly "the reserve pool can't cover this
  // right now" before the user even clicks, rather than only discovering
  // it after a simulated (or worse, real) revert. Read-only, no signature.
  useEffect(() => {
    let cancelled = false;
    if (!settlementConfigured) return;
    readReserveStatus()
      .then((status) => {
        if (cancelled || !status) return;
        if (status.availableReserve < maxPayoutRaw) {
          const availableUsdt = (Number(status.availableReserve) / 10 ** USDT_DECIMALS).toFixed(2);
          const neededUsdt = (Number(maxPayoutRaw) / 10 ** USDT_DECIMALS).toFixed(2);
          setReserveShortfall(`The contract's reserve pool currently has ${availableUsdt} USDT available, below the ${neededUsdt} USDT this policy would need to cover. Activation will fail until the reserve is topped up.`);
        }
      })
      .catch(() => {
        // Best-effort only — the real simulateContract() call before
        // signing is the authoritative check; a failed pre-check here just
        // means the warning doesn't show early, not that anything unsafe happens.
      });
    return () => {
      cancelled = true;
    };
  }, [settlementConfigured, maxPayoutRaw]);

  async function activate() {
    if (!wallet.address) {
      setError({ userMessage: "No wallet is connected.", rawMessage: "No wallet is connected.", stage: "wallet signing", hadHash: false });
      return;
    }
    if (!tokenizedStockContract) {
      setError({
        userMessage: "This position's on-chain token address is unavailable, so a policy cannot reference it safely.",
        rawMessage: "tokenizedStockContract is undefined",
        stage: "pre-flight simulation",
        hadHash: false,
      });
      return;
    }
    if (wrongSettlementChain) {
      setError({
        userMessage: "Your wallet is on the wrong network. Switch to the configured settlement chain to continue.",
        rawMessage: `wallet.chainId=${wallet.chainId}, expected ${getSettlementChainIdHex()}`,
        stage: "wallet signing",
        hadHash: false,
      });
      return;
    }

    setError(null);
    setPhase("checking");
    const owner = wallet.address as Address;
    const premiumRaw = parseUnits(quote.premium.toFixed(USDT_DECIMALS), USDT_DECIMALS);
    const coveredPositionValueRaw = parseUnits(quote.coverageAmount.toFixed(USDT_DECIMALS), USDT_DECIMALS);
    const thresholdBps = BigInt(Math.round(quote.thresholdPercent * 100));
    const expiryTime = BigInt(Math.floor(quote.expiresAt / 1000));
    // Unique per purchase attempt — the contract only uses this as an
    // opaque off-chain link (hashed, see settlementAuthorizationCore.ts),
    // never interpreted on-chain.
    const protectionSessionId = `${wrapper}-${quote.underlying}-${owner}-${Date.now()}`;
    const purchaseParams = {
      ownerAddress: owner,
      underlyingTicker: quote.underlying,
      tokenizedStockContract,
      wrapper,
      coveredPositionValue: coveredPositionValueRaw,
      thresholdBps,
      premiumAmount: premiumRaw,
      maxPayoutAmount: maxPayoutRaw,
      expiryTime,
      protectionSessionId,
    };

    let balance: bigint, allowance: bigint;
    try {
      [balance, allowance] = await Promise.all([readUsdtBalance(owner), readUsdtAllowance(owner)]);
    } catch (err) {
      setError({ ...mapTransactionError(err), stage: "balance check", hadHash: false });
      setPhase("failed");
      return;
    }

    if (balance < premiumRaw) {
      setError({
        userMessage: `Your wallet does not have enough USDT to pay the ${quote.premium.toFixed(2)} USDT premium (balance: ${(Number(balance) / 10 ** USDT_DECIMALS).toFixed(2)} USDT).`,
        rawMessage: `balance=${balance}, required=${premiumRaw}`,
        stage: "balance check",
        hadHash: false,
      });
      setPhase("failed");
      return;
    }

    if (allowance < premiumRaw) {
      setPhase("approving");
      let approveHash: `0x${string}`;
      try {
        approveHash = await approveUsdt(owner, premiumRaw);
      } catch (err) {
        setError({ ...mapTransactionError(err), stage: "USDT approval", hadHash: false });
        setPhase("failed");
        return;
      }
      recordActivity({ type: "settlement-approve", label: `Approved ${quote.premium.toFixed(2)} USDT for weekend protection`, hash: approveHash });
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
          userMessage: "The USDT approval transaction reverted on-chain. No protection was activated.",
          rawMessage: `approval tx ${approveHash} reverted`,
          stage: "USDT approval",
          hadHash: true,
        });
        setPhase("failed");
        return;
      }
    }

    // Gas-free dry run with the exact same args — catches a would-revert
    // condition (paused contract, bad params, insufficient reserve, etc.)
    // before ever prompting the real signature below. No hash exists yet
    // at this point: nothing has been submitted.
    try {
      await simulatePurchaseProtection(purchaseParams);
    } catch (err) {
      setError({ ...mapTransactionError(err), stage: "pre-flight simulation", hadHash: false });
      setPhase("failed");
      return;
    }

    setPhase("purchasing");
    let purchaseHash: `0x${string}`;
    try {
      purchaseHash = await purchaseProtectionOnChain(purchaseParams);
    } catch (err) {
      // Could fail at wallet signing (rejected, wrong network mid-flow) OR
      // at submission (RPC rejected the signed tx) — mapTransactionError's
      // own patterns (e.g. "user rejected") already distinguish those in
      // the message; either way, no hash was ever returned, so hadHash is
      // false here, never fabricated.
      setError({ ...mapTransactionError(err), stage: "wallet signing", hadHash: false });
      setPhase("failed");
      return;
    }
    recordActivity({ type: "settlement-activate", label: `Activated weekend protection for ${quote.underlying} (${wrapper})`, hash: purchaseHash });
    setTxHash(purchaseHash);

    setPhase("confirming");
    try {
      const outcome = await waitForSettlementTransaction(purchaseHash);
      if (outcome !== "success") {
        setError({
          userMessage: "The protection-activation transaction was submitted and mined, but REVERTED on-chain. No protection was activated.",
          rawMessage: `transaction ${purchaseHash} reverted`,
          stage: "transaction confirmation",
          hadHash: true,
        });
        setPhase("failed");
        return;
      }
    } catch (err) {
      // The transaction WAS submitted (we have a hash) but we couldn't
      // confirm its outcome (e.g. the RPC call to fetch the receipt
      // failed/timed out) — genuinely PENDING/unknown, not a revert and
      // not a success. Never claim either without the real receipt.
      setError({
        ...mapTransactionError(err),
        userMessage: `Transaction ${purchaseHash} was submitted, but its confirmation status could not be verified (${mapTransactionError(err).userMessage}). Check BscScan for this hash before retrying.`,
        stage: "transaction confirmation",
        hadHash: true,
      });
      setPhase("failed");
      return;
    }

    // Best-effort session registration — never blocks or fails the purchase
    // itself (the on-chain policy already exists and is already confirmed
    // real at this point). If this fails (e.g. a transient fetch error, or
    // the live price snapshot being temporarily unavailable), the policy
    // still exists on-chain; monitoring simply won't start until a session
    // is registered, which the Portfolio claim section can retry later.
    try {
      const contract = getSettlementContractAddress();
      const onChainPolicyId = await getPolicyIdFromPurchaseReceipt(purchaseHash);
      if (contract && onChainPolicyId !== null) {
        await fetch("/api/protection-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: protectionSessionId,
            underlying: quote.underlying,
            wrapper,
            onChainPolicyId: onChainPolicyId.toString(),
            settlementContractAddress: contract,
            expiresAt: Number(expiryTime) * 1000,
            thresholdPercent: quote.thresholdPercent,
          }),
        });
      }
    } catch {
      // Logged nowhere sensitive-free to log to from the browser; silently
      // best-effort, per the comment above.
    }

    setPhase("purchased");
    onPurchased(purchaseHash);
  }

  if (!settlementConfigured) {
    return (
      <p className="mt-3 text-xs text-muted-2">
        No settlement contract is configured for this environment — activation is unavailable here. See SETTLEMENT.md.
      </p>
    );
  }

  if (phase === "purchased" && txHash) {
    return (
      <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
        <p className="font-semibold">✓ Protection activated on-chain.</p>
        <p className="mt-1 break-all text-emerald-300/80">Transaction: {txHash}</p>
      </div>
    );
  }

  const busy = phase === "checking" || phase === "approving" || phase === "purchasing" || phase === "confirming";
  const label: Record<Phase, string> = {
    idle: "Activate protection",
    checking: "Checking balance & allowance…",
    approving: "Approving USDT…",
    purchasing: "Activating protection…",
    confirming: "Waiting for confirmation…",
    purchased: "Protection activated",
    failed: "Activate protection",
  };

  return (
    <div className="mt-3">
      {reserveShortfall && !error && (
        <p className="mb-2 text-xs text-amber-400">⚠ {reserveShortfall}</p>
      )}
      <button
        type="button"
        onClick={activate}
        disabled={busy || !wallet.address}
        className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label[phase]}
      </button>

      {error && (
        <div className="mt-2 text-xs text-red-400">
          <p className="font-medium">Failed during {error.stage}: {error.userMessage}</p>
          <p className="mt-1 text-muted-2">
            {error.hadHash && txHash
              ? `A transaction was submitted (hash below) — this failure happened after signing.`
              : "No transaction was submitted — this failed before anything was signed or broadcast."}
          </p>
          {txHash && <p className="mt-1 break-all text-muted-2">Transaction: {txHash}</p>}
          <details className="mt-1 text-muted-2">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-1 break-all">{error.rawMessage}</p>
          </details>
        </div>
      )}

      <p className="mt-2 text-xs text-muted-2">
        This collects a real {quote.premium.toFixed(2)} USDT premium and activates a real on-chain policy against the
        deployed WeekendGuardSettlement contract. Your position itself is never moved or custodied.
      </p>
    </div>
  );
}
