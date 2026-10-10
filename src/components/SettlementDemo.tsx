"use client";

import { useState } from "react";
import { parseUnits, type Address } from "viem";
import { useWallet } from "@/lib/useWallet";
import { DevBadge } from "@/components/DevBadge";
import {
  approveUsdt,
  claimPayoutOnChain,
  fundReserveOnChain,
  getSettlementContractAddress,
  getSettlementUsdtAddress,
  purchaseProtectionOnChain,
  readReserveStatus,
  resolveSettlementOnChain,
  waitForSettlementTransaction,
  type SerializedSettlementAuthorization,
} from "@/lib/protection/settlementContractClient";
import { recordActivity } from "@/lib/brixActivity";

/**
 * Minimal on-chain settlement demo (build brief Task 13) — extends the
 * existing prototype UI with the states beyond "quote available":
 *   Fund Reserve -> Approve USDT -> Activate Protection -> ACTIVE -> SETTLEMENT ELIGIBLE -> Claim USDT
 *
 * Every button here calls a REAL contract function (contracts/src/
 * WeekendGuardSettlement.sol) via the REAL injected wallet (useWallet.ts,
 * unmodified) — never a fake/disabled button pretending to transact. If the
 * contract isn't deployed/configured for this environment, that is stated
 * plainly instead of showing non-functional controls (Task 13: "If
 * settlement is unavailable, say so clearly. Do not show fake transaction
 * buttons.").
 *
 * Uses hand-entered demo amounts rather than deep live wiring into the
 * quote flow — the same "real logic, demo-chosen inputs" pattern already
 * used by WeekendTrustScenarioDemo.tsx / ProtectionSessionDemo.tsx.
 *
 * NETWORK: driven entirely by NEXT_PUBLIC_SETTLEMENT_CHAIN_ID (97 = BSC
 * testnet default, 56 = BSC mainnet) — never hardcoded either way. The
 * session ID defaults to a `TEST-<timestamp>` prefix so a policy created
 * from this demo is easy to recognize later as a test, not a convention
 * the contract itself enforces (it has no concept of "test" policies).
 */

const USDT_DECIMALS = 18; // the REAL BSC Binance-Peg USDT is 18 decimals — live-verified, see SETTLEMENT.md

type FlowStep = "idle" | "approved" | "purchased" | "resolved" | "claimed";

export function SettlementDemo() {
  const wallet = useWallet();
  const contractAddress = getSettlementContractAddress();
  const usdtAddress = getSettlementUsdtAddress();

  const [sessionId, setSessionId] = useState(() => `TEST-${Date.now()}`);
  const [reserveAmount, setReserveAmount] = useState("2");
  const [premium, setPremium] = useState("0");
  const [maxPayout, setMaxPayout] = useState("2");
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [step, setStep] = useState<FlowStep>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [reserveStatus, setReserveStatus] = useState<{ totalReserve: bigint; availableReserve: bigint } | null>(null);
  const [authorization, setAuthorization] = useState<{
    domain: unknown;
    authorization: SerializedSettlementAuthorization;
    signature: `0x${string}`;
    settlementOutcome: string;
  } | null>(null);

  if (!contractAddress || !usdtAddress) {
    return (
      <div className="mt-4 rounded-lg border border-border-subtle p-4 ">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-medium">On-Chain Settlement</p>
          <DevBadge label="Not deployed" />
        </div>
        <p className="text-sm text-muted-2">
          No settlement contract is configured for this environment (NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS /
          NEXT_PUBLIC_USDT_ADDRESS are unset). On-chain purchase and claim are unavailable — see{" "}
          <code>SETTLEMENT.md</code> for deployment steps. No funds can move without these configured.
        </p>
      </div>
    );
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border-subtle p-4 ">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">On-Chain Settlement</p>
        <DevBadge label="Testnet demo — illustrative amounts, not live-priced" />
      </div>
      <p className="text-xs text-muted-2">
        Real transactions against a real deployed contract, using demo-chosen amounts (the same pattern as the other
        demos on this page) rather than deep live wiring into the quote flow. Requires a connected wallet on the
        configured chain.
      </p>

      {!wallet.address ? (
        <button
          type="button"
          onClick={wallet.connect}
          disabled={wallet.isConnecting}
          className="mt-3 rounded border border-border-subtle px-3 py-1.5 text-sm font-medium "
        >
          {wallet.isConnecting ? "Connecting…" : "Connect wallet"}
        </button>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1">
              Session ID (off-chain link)
              <input
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="w-full min-w-0 rounded border border-border-subtle bg-transparent px-2 py-1"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              Premium (USDT)
              <input
                value={premium}
                onChange={(e) => setPremium(e.target.value)}
                className="w-full min-w-0 rounded border border-border-subtle bg-transparent px-2 py-1"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              Max payout (USDT)
              <input
                value={maxPayout}
                onChange={(e) => setMaxPayout(e.target.value)}
                className="w-full min-w-0 rounded border border-border-subtle bg-transparent px-2 py-1"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              Reserve to fund (USDT)
              <input
                value={reserveAmount}
                onChange={(e) => setReserveAmount(e.target.value)}
                className="w-full min-w-0 rounded border border-border-subtle bg-transparent px-2 py-1"
              />
            </label>
          </div>

          <p className="mt-2 text-xs text-muted-2">
            Current reserve: {reserveStatus ? `${(Number(reserveStatus.totalReserve) / 1e18).toFixed(4)} USDT total, ${(Number(reserveStatus.availableReserve) / 1e18).toFixed(4)} USDT available` : "unknown — click \"Check reserve\""}{" "}
            <button
              type="button"
              onClick={() => run(async () => setReserveStatus(await readReserveStatus()))}
              className="underline"
            >
              Check reserve
            </button>
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  // Live-audited gap, fixed here: this used to await only
                  // approveUsdt()/fundReserveOnChain() RETURNING a hash
                  // (i.e. the wallet accepted/broadcast it) and immediately
                  // move on — never confirming either transaction actually
                  // succeeded on-chain before the next step, and reading
                  // reserve status right after submitting the fund tx
                  // (which could still be pending, showing stale pre-fund
                  // numbers). Now waits for each REAL receipt and reports a
                  // revert explicitly instead of silently proceeding.
                  const amount = parseUnits(reserveAmount, USDT_DECIMALS);
                  const approveHash = await approveUsdt(wallet.address as Address, amount);
                  recordActivity({ type: "settlement-approve", label: `Approved ${reserveAmount} USDT to fund reserve`, hash: approveHash });
                  const approveOutcome = await waitForSettlementTransaction(approveHash);
                  if (approveOutcome !== "success") {
                    throw new Error(`The USDT approval transaction (${approveHash}) reverted on-chain. The reserve was not funded.`);
                  }

                  const fundHash = await fundReserveOnChain(wallet.address as Address, amount);
                  setLastTxHash(fundHash);
                  recordActivity({ type: "settlement-fund-reserve", label: `Funded settlement reserve with ${reserveAmount} USDT`, hash: fundHash });
                  const fundOutcome = await waitForSettlementTransaction(fundHash);
                  if (fundOutcome !== "success") {
                    throw new Error(`The fund-reserve transaction (${fundHash}) reverted on-chain. Reserve was not updated.`);
                  }

                  setReserveStatus(await readReserveStatus());
                })
              }
              className="rounded border border-border-subtle px-2 py-1 text-xs font-medium disabled:opacity-40 "
            >
              0. Fund reserve
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const hash = await approveUsdt(wallet.address as Address, parseUnits(premium, USDT_DECIMALS));
                  setLastTxHash(hash);
                  recordActivity({ type: "settlement-approve", label: `Approved ${premium} USDT for settlement`, hash });
                  setStep("approved");
                })
              }
              className="rounded border border-border-subtle px-2 py-1 text-xs font-medium disabled:opacity-40 "
            >
              1. Approve USDT
            </button>

            <button
              type="button"
              disabled={busy || step === "idle"}
              onClick={() =>
                run(async () => {
                  const hash = await purchaseProtectionOnChain({
                    ownerAddress: wallet.address as Address,
                    underlyingTicker: "TSLA",
                    tokenizedStockContract: "0x0000000000000000000000000000000000000000",
                    wrapper: "bstocks",
                    coveredPositionValue: parseUnits(maxPayout, USDT_DECIMALS),
                    thresholdBps: BigInt(500),
                    premiumAmount: parseUnits(premium, USDT_DECIMALS),
                    maxPayoutAmount: parseUnits(maxPayout, USDT_DECIMALS),
                    expiryTime: BigInt(Math.floor(Date.now() / 1000) + 60),
                    protectionSessionId: sessionId,
                  });
                  setLastTxHash(hash);
                  recordActivity({ type: "settlement-activate", label: `Activated on-chain protection policy (session ${sessionId})`, hash });
                  setStep("purchased");
                })
              }
              className="rounded border border-border-subtle px-2 py-1 text-xs font-medium disabled:opacity-40 "
            >
              2. Activate protection
            </button>

            <input
              placeholder="On-chain policy ID"
              value={policyId ?? ""}
              onChange={(e) => setPolicyId(e.target.value)}
              className="w-40 rounded border border-border-subtle bg-transparent px-2 py-1 text-xs "
            />

            <button
              type="button"
              disabled={busy || !policyId}
              onClick={() =>
                run(async () => {
                  const res = await fetch("/api/dev/settlement-authorization", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionId, policyId, nonce: Date.now().toString() }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error ?? "Could not get a settlement authorization.");
                  setAuthorization(data);
                  recordActivity({ type: "settlement-authorize", label: `Settlement authorization obtained for policy ${policyId}: ${data.settlementOutcome}`, hash: null });
                })
              }
              className="rounded border border-border-subtle px-2 py-1 text-xs font-medium disabled:opacity-40 "
            >
              3. Request settlement authorization
            </button>

            <button
              type="button"
              disabled={busy || !authorization || !policyId}
              onClick={() =>
                run(async () => {
                  if (!authorization || !policyId) return;
                  const hash = await resolveSettlementOnChain(
                    wallet.address as Address,
                    BigInt(policyId),
                    authorization.authorization,
                    authorization.signature
                  );
                  setLastTxHash(hash);
                  recordActivity({ type: "settlement-resolve", label: `Resolved settlement on-chain for policy ${policyId}`, hash });
                  setStep("resolved");
                })
              }
              className="rounded border border-border-subtle px-2 py-1 text-xs font-medium disabled:opacity-40 "
            >
              4. Resolve on-chain
            </button>

            <button
              type="button"
              disabled={busy || step !== "resolved" || !policyId}
              onClick={() =>
                run(async () => {
                  if (!policyId) return;
                  const hash = await claimPayoutOnChain(wallet.address as Address, BigInt(policyId));
                  setLastTxHash(hash);
                  recordActivity({ type: "settlement-claim", label: `Claimed USDT payout for policy ${policyId}`, hash });
                  setStep("claimed");
                })
              }
              className="rounded border border-border-subtle px-2 py-1 text-xs font-medium disabled:opacity-40 "
            >
              5. Claim USDT
            </button>
          </div>

          {authorization && (
            <p className="mt-2 text-xs text-muted-2">
              Settlement outcome from the off-chain decision: <span className="font-semibold">{authorization.settlementOutcome}</span>
              {authorization.settlementOutcome !== "SETTLEMENT_ELIGIBLE" && " — resolving on-chain will close this policy with no payout."}
            </p>
          )}
          {lastTxHash && <p className="mt-2 text-xs text-muted-2">Last transaction: {lastTxHash}</p>}
          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
}
