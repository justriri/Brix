"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { buildSellQuote, revalidatePurchaseQuote, type PurchaseQuote } from "@/lib/invest/spotPurchaseCore";
import {
  approveQuoteAsset,
  readAllowance,
  readBalance,
  getSmartRouterTrade,
  swapViaSmartRouter,
  describeRoute,
  waitForTransaction,
  SMART_ROUTER_ADDRESS,
  DEFAULT_QUOTE_ASSET,
} from "@/lib/invest/spotPurchaseClient";
import { mapTransactionError, mapQuoteError } from "@/lib/invest/transactionErrors";
import { recordActivity } from "@/lib/brixActivity";
import type { WalletState } from "@/lib/useWallet";
import type { TokenizedStock } from "@/lib/types";

/**
 * Real spot-SELL UI — the exit side of BuySpotPanel.tsx's purchase flow.
 *
 * ARCHITECTURE TRACED FIRST, before writing this: the tokenized-stock
 * tokens this app detects (bStocks/Ondo) are plain ERC-20/BEP-20 balances
 * held directly in the user's own wallet — see spotPurchaseClient.ts's own
 * doc comment ("nothing in this app ever takes custody of the tokenized
 * stock") and positionScanner.ts, which reads them via a plain
 * `balanceOf`. There is no vault/custody contract holding a position that
 * needs "withdrawing from" — WeekendGuardSettlement.sol only ever custodies
 * USDT (protection premiums/reserve), never the stock token itself (see
 * PurchaseProtectionButton.tsx's own doc comment). So "exit this position"
 * correctly means SELLING the token back to USDT via the same execution
 * infrastructure BuySpotPanel already uses — PancakeSwap's Smart Router —
 * not a fabricated "withdraw" button that doesn't correspond to any real
 * mechanism.
 *
 * Reuses spotPurchaseClient.ts's exports directly, unmodified: every
 * function there (getSmartRouterTrade, swapViaSmartRouter, readAllowance,
 * readBalance, approveQuoteAsset, waitForTransaction) is already generic
 * over which asset is input vs output — only the direction passed in here
 * differs from BuySpotPanel's. buildSellQuote() (spotPurchaseCore.ts) is
 * the sell-shaped wrapper around the exact same buildPurchaseQuote() math
 * (fair-value baseline, executable-liquidity gate, slippage) — nothing
 * about the underlying safety checks is re-derived or weakened.
 *
 * HONESTY RULES, same as BuySpotPanel:
 *  - The real on-chain balance is read before any amount can be chosen —
 *    never a cached/estimated figure.
 *  - A transaction is only reported "confirmed" after waitForTransaction()
 *    returns "success" against the REAL receipt.
 *  - An explicit confirmation step (phase "confirm") sits between seeing
 *    the quote and actually signing — selling is at least as consequential
 *    as buying and gets the same "never execute without an explicit,
 *    separate action" treatment used throughout this app.
 *  - After a successful sell, the caller's onSellComplete() is used to
 *    re-scan the REAL portfolio from chain (app/page.tsx's refreshPortfolio)
 *    — never an optimistic local balance edit.
 */

const BSC_MAINNET_CHAIN_ID_HEX = "0x38";
const SLIPPAGE_BPS = 50; // 0.50% — same tolerance BuySpotPanel uses.
const QUOTE_ASSET = DEFAULT_QUOTE_ASSET;

type Phase =
  | "loading-balance"
  | "need-amount"
  | "fetching-quote"
  | "checking-allowance"
  | "approval-needed"
  | "approval-pending"
  | "approval-confirming"
  | "ready"
  | "confirm"
  | "refreshing-quote"
  | "swap-pending"
  | "swap-confirming"
  | "verifying-position"
  | "complete"
  | "failed";

interface VerifiedPosition {
  positionAmount: number;
  positionValueUsd: number;
}

export function SellSpotPanel({
  wallet,
  stock,
  onSellComplete,
}: {
  wallet: WalletState;
  stock: TokenizedStock;
  /** Fired once, after a sell is confirmed on-chain — lets the parent re-scan the real portfolio (never an optimistic local edit). */
  onSellComplete?: (remaining: VerifiedPosition) => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading-balance");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [quote, setQuote] = useState<PurchaseQuote | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [approveTxHash, setApproveTxHash] = useState<string | null>(null);
  const [sellTxHash, setSellTxHash] = useState<string | null>(null);
  const [verifiedPosition, setVerifiedPosition] = useState<VerifiedPosition | null>(null);
  const [error, setError] = useState<{ userMessage: string; rawMessage: string } | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tokenAddress = stock.tokenAddress as Address | undefined;
  const onWrongChain = Boolean(wallet.address && wallet.chainId !== null && wallet.chainId !== BSC_MAINNET_CHAIN_ID_HEX);

  // Real on-chain balance — never estimated, never carried over from a
  // purchase's expected output. Re-read whenever the wallet/token changes.
  useEffect(() => {
    let cancelled = false;
    if (!wallet.address || !tokenAddress || onWrongChain) {
      // Clearing a stale balance when the wallet/chain/token changes is a
      // deliberate response to that external change, not state derivable
      // from render — same justification already used elsewhere in this
      // app (e.g. app/page.tsx) for this exact lint rule.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBalance(null);
      return;
    }
    setPhase("loading-balance");
    readBalance(wallet.address as Address, tokenAddress)
      .then((b) => {
        if (cancelled) return;
        setBalance(b);
        setPhase("need-amount");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(mapTransactionError(err));
        setPhase("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [wallet.address, tokenAddress, onWrongChain]);

  useEffect(() => {
    if (phase !== "ready" && phase !== "confirm" && phase !== "checking-allowance" && phase !== "approval-needed") {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [phase]);

  if (!tokenAddress) {
    return <div className="rounded-xl border border-border-subtle bg-surface-2 p-4 text-xs text-muted-2">No on-chain token address is available for this wrapper — cannot sell.</div>;
  }
  if (stock.decimals === undefined) {
    return <div className="rounded-xl border border-border-subtle bg-surface-2 p-4 text-xs text-muted-2">This token&apos;s on-chain decimals are unknown — refusing to compute a sell amount rather than guess.</div>;
  }
  if (stock.price === undefined) {
    return <div className="rounded-xl border border-border-subtle bg-surface-2 p-4 text-xs text-muted-2">No current price is available — cannot safely size a sell.</div>;
  }

  const decimals = stock.decimals;
  const inputAsset = { address: tokenAddress, symbol: stock.symbol ?? stock.underlying, decimals };
  const balanceHuman = balance !== null ? Number(formatUnits(balance, decimals)) : null;
  const amountNum = Number(amountRaw);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && balance !== null && parseUnits(amountRaw || "0", decimals) <= balance;

  function resetFlow() {
    setPhase(balance !== null ? "need-amount" : "loading-balance");
    setQuote(null);
    setApproveTxHash(null);
    setSellTxHash(null);
    setVerifiedPosition(null);
    setError(null);
  }

  async function fetchLiveQuote(): Promise<{ quote: PurchaseQuote; trade: NonNullable<Awaited<ReturnType<typeof getSmartRouterTrade>>> }> {
    const amountIn = parseUnits(amountRaw, decimals);
    const trade = await getSmartRouterTrade({ amountIn, inputToken: inputAsset, outputToken: QUOTE_ASSET });
    if (!trade) {
      throw new Error(
        `No executable route was found from ${inputAsset.symbol} to ${QUOTE_ASSET.symbol} through PancakeSwap right now — this token may not have enough on-chain liquidity to sell.`
      );
    }
    const q = buildSellQuote({
      quoteAmountInRaw: amountRaw,
      inputAsset,
      outputAsset: QUOTE_ASSET,
      stockPriceUsd: stock.price!,
      quoteAssetPriceUsd: 1,
      routerAmountOut: trade.outputAmount.quotient,
      slippageBps: SLIPPAGE_BPS,
      routeDescription: describeRoute(trade),
      routerAddress: SMART_ROUTER_ADDRESS,
    });
    return { quote: q, trade };
  }

  async function getQuote() {
    if (phase === "fetching-quote") return;
    setError(null);
    setPhase("fetching-quote");
    try {
      const { quote: q } = await fetchLiveQuote();
      setQuote(q);
      setPhase("checking-allowance");
      void checkAllowance(q);
    } catch (err) {
      setError(mapQuoteError(err));
      setPhase("failed");
    }
  }

  async function checkAllowance(q: PurchaseQuote) {
    if (!wallet.address) return;
    try {
      const allowance = await readAllowance(wallet.address as Address, q.inputAsset.address, SMART_ROUTER_ADDRESS);
      setPhase(allowance >= q.amountIn ? "ready" : "approval-needed");
    } catch (err) {
      setError(mapTransactionError(err));
      setPhase("failed");
    }
  }

  async function doApprove() {
    if (!wallet.address || !quote) return;
    setError(null);
    setPhase("approval-pending");
    try {
      const hash = await approveQuoteAsset(wallet.address as Address, quote.inputAsset.address, SMART_ROUTER_ADDRESS, quote.amountIn);
      setApproveTxHash(hash);
      setPhase("approval-confirming");
      const outcome = await waitForTransaction(hash);
      if (outcome !== "success") {
        setError({ userMessage: "The approval transaction failed on-chain.", rawMessage: "reverted" });
        setPhase("failed");
        return;
      }
      recordActivity({ type: "approve", label: `Approved ${quote.inputAsset.symbol} for sale`, hash });
      setPhase("ready");
    } catch (err) {
      setError(mapTransactionError(err));
      setPhase("failed");
    }
  }

  async function doSell() {
    if (!wallet.address || !quote) return;
    setError(null);

    setPhase("refreshing-quote");
    let freshQuote: PurchaseQuote;
    let freshTrade: NonNullable<Awaited<ReturnType<typeof getSmartRouterTrade>>>;
    try {
      const fresh = await fetchLiveQuote();
      freshQuote = fresh.quote;
      freshTrade = fresh.trade;
      const reason = revalidatePurchaseQuote(quote, {
        routerAddress: SMART_ROUTER_ADDRESS,
        inputAssetAddress: inputAsset.address,
        outputAssetAddress: QUOTE_ASSET.address,
      });
      if (reason) {
        setError({ userMessage: reason, rawMessage: reason });
        setPhase("failed");
        return;
      }
    } catch (err) {
      setError(mapQuoteError(err));
      setPhase("failed");
      return;
    }

    setPhase("swap-pending");
    try {
      const hash = await swapViaSmartRouter({ owner: wallet.address as Address, trade: freshTrade, slippageBps: SLIPPAGE_BPS });
      setSellTxHash(hash);
      setPhase("swap-confirming");
      const outcome = await waitForTransaction(hash);
      if (outcome !== "success") {
        setError({ userMessage: "The sell transaction failed on-chain.", rawMessage: "reverted" });
        setPhase("failed");
        return;
      }
      recordActivity({ type: "sell", label: `Sold ${stock.underlying} (${stock.wrapper}) for ${QUOTE_ASSET.symbol}`, hash });
      setQuote(freshQuote);
      setPhase("verifying-position");
      const remaining = await verifyRemainingPosition();
      setPhase("complete");
      if (remaining) onSellComplete?.(remaining);
    } catch (err) {
      setError(mapTransactionError(err));
      setPhase("failed");
    }
  }

  /** Re-reads the REAL remaining on-chain balance — never derives it by subtracting the swap's expected input from the balance shown before signing. */
  async function verifyRemainingPosition(): Promise<VerifiedPosition | null> {
    if (!wallet.address || !tokenAddress) return null;
    const remainingRaw = await readBalance(wallet.address as Address, tokenAddress);
    setBalance(remainingRaw);
    const remainingAmount = Number(formatUnits(remainingRaw, decimals));
    const position: VerifiedPosition = { positionAmount: remainingAmount, positionValueUsd: remainingAmount * (stock.price ?? 0) };
    setVerifiedPosition(position);
    return position;
  }

  const remainingSec = quote ? Math.max(0, Math.round((quote.expiresAt - nowTick) / 1000)) : 0;
  const quoteExpired = quote ? nowTick >= quote.expiresAt : false;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-2 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground/90">
          Sell {stock.underlying} ({stock.wrapper})
        </p>
        <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand ring-1 ring-inset ring-brand/30">
          Real on-chain swap — BSC mainnet
        </span>
      </div>
      <p className="text-xs text-muted-2">
        Sells back to {QUOTE_ASSET.symbol} through PancakeSwap&apos;s Smart Router — the same route/execution
        infrastructure used to buy. Tokens stay in your wallet until you sign; nothing here is held by BRIX.
      </p>

      {!wallet.address && <p className="mt-2 text-xs text-muted-2">Connect a wallet to sell.</p>}
      {wallet.address && onWrongChain && <p className="mt-2 text-xs text-amber-400">Switch your wallet to BSC mainnet to sell.</p>}

      {wallet.address && !onWrongChain && (
        <>
          {phase === "loading-balance" && <p className="mt-2 text-xs text-muted-2">Reading your real on-chain balance…</p>}

          {balance !== null && balance === BigInt(0) && phase !== "complete" && (
            <p className="mt-2 text-xs text-muted-2">You hold no {stock.underlying} ({stock.wrapper}) to sell right now.</p>
          )}

          {balance !== null && balance > BigInt(0) && (phase === "need-amount" || phase === "failed" || phase === "fetching-quote") && (
            <div className="mt-2">
              <p className="text-xs text-muted-2">
                Available: {balanceHuman?.toLocaleString(undefined, { maximumFractionDigits: 6 })} {inputAsset.symbol}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={amountRaw}
                  disabled={phase === "fetching-quote"}
                  onChange={(e) => {
                    setAmountRaw(e.target.value);
                    resetFlow();
                  }}
                  placeholder="0.0"
                  className="w-28 rounded border border-border-subtle bg-transparent px-2 py-1 text-foreground disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={phase === "fetching-quote" || balanceHuman === null}
                  onClick={() => {
                    setAmountRaw(formatUnits(balance, decimals));
                    resetFlow();
                  }}
                  className="rounded-lg border border-border-subtle px-2 py-1 text-xs font-medium text-foreground/90 transition-colors hover:border-border-strong disabled:opacity-40"
                >
                  Max
                </button>
                <button
                  type="button"
                  disabled={!amountValid || phase === "fetching-quote"}
                  onClick={getQuote}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-40"
                >
                  {phase === "fetching-quote" ? "Fetching live quote…" : "Get sell quote"}
                </button>
              </div>
              {amountRaw && !amountValid && phase !== "fetching-quote" && (
                <p className="mt-1 text-xs text-amber-400">Enter an amount greater than 0 and no more than your available balance.</p>
              )}
              {phase === "fetching-quote" && (
                <p className="mt-1 text-xs text-muted-2">Asking PancakeSwap&apos;s Smart Router for a live route — this can take several seconds.</p>
              )}
            </div>
          )}

          {quote && phase !== "need-amount" && phase !== "loading-balance" && (
            <div className="mt-3 rounded-xl border border-border-subtle bg-surface p-3 text-xs text-foreground/90">
              <p className="font-medium">Sell {quote.inputAsset.symbol}</p>
              <dl className="mt-1 grid grid-cols-2 gap-y-1">
                <dt className="text-muted-2">Selling</dt>
                <dd className="text-right tabular-nums">
                  {amountRaw} {quote.inputAsset.symbol}
                </dd>
                <dt className="text-muted-2">Estimated proceeds</dt>
                <dd className="text-right tabular-nums">
                  ≈ {(Number(quote.expectedAmountOut) / 10 ** quote.outputAsset.decimals).toFixed(2)} {quote.outputAsset.symbol}
                </dd>
                <dt className="text-muted-2">Route</dt>
                <dd className="text-right">{quote.routeDescription}</dd>
                <dt className="text-muted-2">Slippage tolerance</dt>
                <dd className="text-right tabular-nums">{(quote.slippageBps / 100).toFixed(2)}%</dd>
                <dt className="text-muted-2">Minimum proceeds</dt>
                <dd className="text-right tabular-nums">
                  {(Number(quote.minAmountOut) / 10 ** quote.outputAsset.decimals).toFixed(2)} {quote.outputAsset.symbol}
                </dd>
                <dt className="text-muted-2">Price impact</dt>
                <dd className="text-right tabular-nums">{(quote.priceImpactBps / 100).toFixed(2)}%</dd>
                <dt className="text-muted-2">Quote expires</dt>
                <dd className={`text-right tabular-nums ${quoteExpired ? "text-red-400" : ""}`}>{quoteExpired ? "expired" : `in ${remainingSec}s`}</dd>
              </dl>

              {quoteExpired && phase !== "complete" && phase !== "refreshing-quote" && (
                <button type="button" onClick={getQuote} className="mt-2 rounded-lg border border-border-subtle px-2 py-1 text-xs font-medium text-foreground/90 transition-colors hover:border-border-strong">
                  Refresh quote
                </button>
              )}

              {(!quoteExpired || phase === "refreshing-quote" || phase === "confirm") && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {phase === "checking-allowance" && <span className="text-muted-2">Checking allowance…</span>}
                  {phase === "approval-needed" && (
                    <button type="button" onClick={doApprove} className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-brand-foreground transition-colors hover:bg-brand/90">
                      Approve {quote.inputAsset.symbol}
                    </button>
                  )}
                  {phase === "approval-pending" && <span className="text-muted-2">Waiting for wallet…</span>}
                  {phase === "approval-confirming" && <span className="text-muted-2">Approval submitted — confirming…</span>}
                  {phase === "ready" && (
                    <button type="button" onClick={() => setPhase("confirm")} className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-brand-foreground transition-colors hover:bg-brand/90">
                      Sell {quote.inputAsset.symbol}
                    </button>
                  )}
                  {phase === "confirm" && (
                    <div className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
                      <p className="text-xs font-semibold text-amber-300">Confirm: sell {amountRaw} {quote.inputAsset.symbol} for ≈ {(Number(quote.expectedAmountOut) / 10 ** quote.outputAsset.decimals).toFixed(2)} {quote.outputAsset.symbol}?</p>
                      <p className="mt-1 text-xs text-amber-300/80">This submits a real on-chain transaction. Minimum you will receive: {(Number(quote.minAmountOut) / 10 ** quote.outputAsset.decimals).toFixed(2)} {quote.outputAsset.symbol}.</p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={doSell} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90">
                          Confirm sell
                        </button>
                        <button type="button" onClick={() => setPhase("ready")} className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-foreground/90 transition-colors hover:border-border-strong">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {phase === "refreshing-quote" && <span className="text-muted-2">Getting a fresh live quote before you sign anything — this can take several seconds…</span>}
                  {phase === "swap-pending" && <span className="text-muted-2">Waiting for wallet…</span>}
                  {phase === "swap-confirming" && <span className="text-muted-2">Sell submitted — confirming…</span>}
                  {phase === "verifying-position" && <span className="text-muted-2">Confirmed — verifying your real on-chain balance…</span>}
                </div>
              )}
            </div>
          )}

          {phase === "complete" && verifiedPosition && (
            <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
              <p className="font-medium text-emerald-400">Sell complete</p>
              <dl className="mt-1 grid grid-cols-2 gap-y-1 text-foreground/90">
                <dt className="text-muted-2">Remaining {stock.underlying} ({stock.wrapper})</dt>
                <dd className="text-right tabular-nums">{verifiedPosition.positionAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} tokens</dd>
                <dt className="text-muted-2">Remaining value</dt>
                <dd className="text-right tabular-nums">${verifiedPosition.positionValueUsd.toFixed(2)}</dd>
                <dt className="text-muted-2">Transaction</dt>
                <dd className="text-right">Confirmed</dd>
              </dl>
              <p className="mt-2 text-muted">Verified directly from your real on-chain balance — not the swap&apos;s estimated output.</p>
              <button type="button" onClick={resetFlow} className="mt-2 rounded-lg border border-border-subtle px-2 py-1 font-medium text-foreground/90 transition-colors hover:border-border-strong">
                Sell more
              </button>
            </div>
          )}

          {(approveTxHash || sellTxHash) && phase !== "complete" && <p className="mt-2 text-xs text-muted-2">Last transaction: {sellTxHash ?? approveTxHash}</p>}

          {error && (
            <div className="mt-2 text-xs text-red-400">
              <p>{error.userMessage}</p>
              <details className="mt-1 text-muted-2">
                <summary className="cursor-pointer">Details</summary>
                <p className="mt-1 break-all">{error.rawMessage}</p>
              </details>
              <button type="button" onClick={resetFlow} className="mt-2 rounded-lg border border-border-subtle px-2 py-1 font-medium text-foreground/90 transition-colors hover:border-border-strong">
                Start over
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
