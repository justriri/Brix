"use client";

import { useEffect, useRef, useState } from "react";
import { parseUnits, type Address } from "viem";
import { buildPurchaseQuote, revalidatePurchaseQuote, type PurchaseQuote } from "@/lib/invest/spotPurchaseCore";
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
 * Real spot-purchase UI — Discover/Analyze (above, unchanged) -> Get Buy
 * Quote -> Approve -> Buy -> Verify Position -> Protect, all against a
 * real PancakeSwap Smart-Router-routed swap (spotPurchaseClient.ts).
 *
 * EXECUTION-VENUE FIX: this used to hand-pick a single PancakeSwap V2 pool
 * ourselves (via DexScreener + a trusted-quote-asset filter), which is what
 * caused a real TSLAB purchase to revert — the pool we picked for
 * quoting/liquidity was not the one, or not the only one, actually
 * executable. A controlled investigation (official PancakeSwap docs/
 * source) found that bStocks and Ondo tokens are actually traded, in
 * production, through PancakeSwap's own Smart Router (V2+V3, multi-hop) —
 * so this component now always asks Smart Router for USDT -> this stock's
 * best live route, and executes the EXACT SAME trade object it quoted.
 * BRIX no longer decides which pool to use at all.
 *
 * HONESTY RULES, enforced in code below, not just claimed:
 *  - No control is shown if decimals, price, or a BSC-mainnet wallet
 *    connection are not all satisfied. If Smart Router finds no executable
 *    route at all, that is reported plainly — never a fabricated quote.
 *  - A transaction is only ever reported "confirmed" after
 *    waitForTransaction() returns "success" against the REAL receipt —
 *    never merely because a wallet returned a hash.
 *  - The purchased position shown after a purchase comes from a REAL
 *    re-read via the EXISTING /api/binance-rwa-quote endpoint (the same one
 *    the Weekend Protection card below already uses) — the swap's own
 *    *expected* output is never presented as the final position.
 *  - Price impact is computed from Smart Router's REAL live quote for the
 *    exact route it will execute — never estimated, never silently widened
 *    via slippage. A trade the route cannot execute without excessive price
 *    impact is rejected by buildPurchaseQuote() before a quote is ever
 *    shown, let alone signed.
 *  - Right before signing, doBuy() fetches a BRAND NEW trade and re-runs
 *    the same executable-liquidity gate — it never reuses a possibly-stale
 *    route from when the quote was first shown.
 *  - DEMO_MAX_INPUT_AMOUNT below is an explicit, temporary, configurable
 *    hackathon-demo safety cap — NOT derived from any route/price-impact
 *    constraint — chosen to match the hackathon's own stated "a few
 *    dollars is enough to prove the flow works" guidance.
 */

const BSC_MAINNET_CHAIN_ID_HEX = "0x38";
const SLIPPAGE_BPS = 50; // 0.50%
const DEMO_MAX_INPUT_AMOUNT = 50; // explicit, temporary hackathon-demo cap — see module doc above

const QUOTE_ASSET = DEFAULT_QUOTE_ASSET;

type Phase =
  | "need-amount"
  | "fetching-quote"
  | "quoted"
  | "checking-allowance"
  | "approval-needed"
  | "approval-pending"
  | "approval-confirming"
  | "ready"
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

export function BuySpotPanel({
  wallet,
  stock,
  onPurchaseComplete,
}: {
  wallet: WalletState;
  stock: TokenizedStock;
  /** Fired once, with the REAL verified position (never the swap's expected output), right after a purchase is confirmed and the on-chain balance has been re-read. Purely additive — lets a parent (e.g. the guided Investment Intelligence journey) react to a completed purchase (e.g. by revealing a "Protect this position" step) without this component knowing anything about what's outside it. */
  onPurchaseComplete?: (position: VerifiedPosition) => void;
}) {
  const [amountRaw, setAmountRaw] = useState("10");
  const [phase, setPhase] = useState<Phase>("need-amount");
  const [quote, setQuote] = useState<PurchaseQuote | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [approveTxHash, setApproveTxHash] = useState<string | null>(null);
  const [swapTxHash, setSwapTxHash] = useState<string | null>(null);
  const [verifiedPosition, setVerifiedPosition] = useState<VerifiedPosition | null>(null);
  const [error, setError] = useState<{ userMessage: string; rawMessage: string } | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown tick while a quote is live — stopped once the flow moves past
  // needing a fresh, unexpired quote (approval/swap in flight or done).
  useEffect(() => {
    if (phase !== "quoted" && phase !== "checking-allowance" && phase !== "approval-needed" && phase !== "ready") {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [phase]);

  if (!stock.tokenAddress) {
    return <div className="mt-3 rounded-xl border border-border-subtle bg-surface-2 p-3 text-xs text-muted-2">No on-chain token address is available for this wrapper — cannot buy.</div>;
  }
  if (stock.decimals === undefined) {
    return <div className="mt-3 rounded-xl border border-border-subtle bg-surface-2 p-3 text-xs text-muted-2">This token&apos;s on-chain decimals are unknown — refusing to compute a purchase amount rather than guess.</div>;
  }
  if (stock.price === undefined) {
    return <div className="mt-3 rounded-xl border border-border-subtle bg-surface-2 p-3 text-xs text-muted-2">No current price is available — cannot safely size a purchase.</div>;
  }

  const outputAsset = { address: stock.tokenAddress as Address, symbol: stock.underlying, decimals: stock.decimals };
  const onWrongChain = Boolean(wallet.address && wallet.chainId !== null && wallet.chainId !== BSC_MAINNET_CHAIN_ID_HEX);
  const amountNum = Number(amountRaw);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= DEMO_MAX_INPUT_AMOUNT;

  function resetFlow() {
    setPhase("need-amount");
    setQuote(null);
    setApproveTxHash(null);
    setSwapTxHash(null);
    setVerifiedPosition(null);
    setError(null);
  }

  /**
   * Asks PancakeSwap's Smart Router for a live, executable route and builds
   * a quote from it (re-running the executable-liquidity gate). Shared by
   * getQuote() (first display) and doBuy() (which always re-fetches a
   * BRAND NEW trade right before signing, rather than reusing a possibly-
   * stale one) — one code path, so they can never diverge.
   */
  async function fetchLiveQuote(): Promise<{ quote: PurchaseQuote; trade: NonNullable<Awaited<ReturnType<typeof getSmartRouterTrade>>> }> {
    const amountIn = parseUnits(amountRaw, QUOTE_ASSET.decimals);
    const trade = await getSmartRouterTrade({ amountIn, inputToken: QUOTE_ASSET, outputToken: outputAsset });
    if (!trade) {
      throw new Error(
        `No executable route was found from ${QUOTE_ASSET.symbol} to ${stock.underlying} through PancakeSwap right now — this token may not have enough on-chain liquidity to buy.`
      );
    }
    const q = buildPurchaseQuote({
      quoteAmountInRaw: amountRaw,
      inputAsset: QUOTE_ASSET,
      outputAsset,
      quoteAssetPriceUsd: 1,
      stockPriceUsd: stock.price!,
      routerAmountOut: trade.outputAmount.quotient,
      slippageBps: SLIPPAGE_BPS,
      routeDescription: describeRoute(trade),
      routerAddress: SMART_ROUTER_ADDRESS,
    });
    return { quote: q, trade };
  }

  async function getQuote() {
    // Re-entrancy guard: a live Smart Router quote can take anywhere from
    // ~1s to tens of seconds under public-RPC contention (live-diagnosed
    // during the "Get Buy Quote isn't working" investigation) — without
    // this, a second click before the first request resolves fires a
    // second, fully independent Smart Router round trip, compounding RPC
    // load and risking two responses landing out of order.
    if (phase === "fetching-quote") return;
    setError(null);
    setPhase("fetching-quote");
    try {
      const { quote: q } = await fetchLiveQuote();
      setQuote(q);
      setPhase("checking-allowance");
      void checkAllowanceAndBalance(q);
    } catch (err) {
      setError(mapQuoteError(err));
      setPhase("failed");
    }
  }

  async function checkAllowanceAndBalance(q: PurchaseQuote) {
    if (!wallet.address) return;
    try {
      const [allowance, balance] = await Promise.all([
        readAllowance(wallet.address as Address, q.inputAsset.address, SMART_ROUTER_ADDRESS),
        readBalance(wallet.address as Address, q.inputAsset.address),
      ]);
      if (balance < q.amountIn) {
        setError({ userMessage: `Your wallet does not have enough ${q.inputAsset.symbol} for this purchase.`, rawMessage: "insufficient balance" });
        setPhase("failed");
        return;
      }
      setPhase(allowance >= q.amountIn ? "ready" : "approval-needed");
    } catch (err) {
      const mapped = mapTransactionError(err);
      setError(mapped);
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
      recordActivity({ type: "approve", label: `Approved ${quote.inputAsset.symbol} for ${stock.underlying} (${stock.wrapper})`, hash });
      setPhase("ready");
    } catch (err) {
      setError(mapTransactionError(err));
      setPhase("failed");
    }
  }

  async function doBuy() {
    if (!wallet.address || !quote) return;
    setError(null);

    // Re-fetch a BRAND NEW trade and re-run the executable-liquidity gate
    // immediately before signing (build brief section 10 — "fail safely if
    // the original assumptions are no longer valid") — never reuse the
    // trade from when the quote was first shown, since the best route can
    // legitimately shift between then and now. Visible phase added here
    // (previously silent) so the UI doesn't appear frozen during this
    // live round trip, which can itself take several seconds.
    setPhase("refreshing-quote");
    let freshQuote: PurchaseQuote;
    let freshTrade: NonNullable<Awaited<ReturnType<typeof getSmartRouterTrade>>>;
    try {
      const fresh = await fetchLiveQuote();
      freshQuote = fresh.quote;
      freshTrade = fresh.trade;
      const reason = revalidatePurchaseQuote(quote, {
        routerAddress: SMART_ROUTER_ADDRESS,
        inputAssetAddress: QUOTE_ASSET.address,
        outputAssetAddress: stock.tokenAddress as Address,
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
      const hash = await swapViaSmartRouter({
        owner: wallet.address as Address,
        trade: freshTrade,
        slippageBps: SLIPPAGE_BPS,
      });
      setSwapTxHash(hash);
      setPhase("swap-confirming");
      const outcome = await waitForTransaction(hash);
      if (outcome !== "success") {
        setError({ userMessage: "The purchase transaction failed on-chain.", rawMessage: "reverted" });
        setPhase("failed");
        return;
      }
      recordActivity({ type: "buy", label: `Bought ${stock.underlying} (${stock.wrapper})`, hash });
      setQuote(freshQuote);
      setPhase("verifying-position");
      const position = await verifyPosition();
      setPhase("complete");
      if (position) onPurchaseComplete?.(position);
    } catch (err) {
      setError(mapTransactionError(err));
      setPhase("failed");
    }
  }

  /** Re-reads the REAL on-chain position via the EXISTING /api/binance-rwa-quote endpoint — the same one the Weekend Protection flow uses. Never trusts the swap's own expected output as the final position. */
  async function verifyPosition(): Promise<VerifiedPosition | null> {
    if (!wallet.address) return null;
    const res = await fetch("/api/binance-rwa-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: wallet.address, wrapper: stock.wrapper, thresholdPercent: 5, underlying: stock.underlying }),
    });
    const data = await res.json();
    if (!res.ok) return null;
    const position: VerifiedPosition = { positionAmount: data.positionAmount, positionValueUsd: data.positionValueUsd };
    setVerifiedPosition(position);
    return position;
  }

  const remainingSec = quote ? Math.max(0, Math.round((quote.expiresAt - nowTick) / 1000)) : 0;
  const quoteExpired = quote ? nowTick >= quote.expiresAt : false;

  return (
    <div className="mt-3 rounded-xl border border-border-subtle bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-foreground/90">
          Buy spot {stock.underlying} ({stock.wrapper})
        </p>
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand ring-1 ring-inset ring-brand/30">
          Real on-chain swap — BSC mainnet
        </span>
      </div>
      <p className="text-xs text-muted-2">
        Routed live through PancakeSwap&apos;s own Smart Router (the same infrastructure PancakeSwap&apos;s Tokenized
        Stocks Terminal uses) — BRIX never hand-picks a pool. Demo cap: ${DEMO_MAX_INPUT_AMOUNT} per purchase.
      </p>

      {!wallet.address && <p className="mt-2 text-xs text-muted-2">Connect a wallet to buy.</p>}
      {wallet.address && onWrongChain && <p className="mt-2 text-xs text-amber-400">Switch your wallet to BSC mainnet to buy.</p>}

      {wallet.address && !onWrongChain && (
        <>
          {(phase === "need-amount" || phase === "failed" || phase === "fetching-quote") && (
            <div className="mt-2 flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                Amount ({QUOTE_ASSET.symbol})
                <input
                  value={amountRaw}
                  disabled={phase === "fetching-quote"}
                  onChange={(e) => {
                    setAmountRaw(e.target.value);
                    resetFlow();
                  }}
                  className="w-20 rounded border border-border-subtle bg-transparent px-2 py-1 text-foreground disabled:opacity-50"
                />
              </label>
              <button
                type="button"
                disabled={!amountValid || phase === "fetching-quote"}
                onClick={getQuote}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-40"
              >
                {phase === "fetching-quote" ? "Fetching live quote…" : "Get buy quote"}
              </button>
              {!amountValid && phase !== "fetching-quote" && <span className="text-xs text-amber-400">Enter &gt; 0 and ≤ ${DEMO_MAX_INPUT_AMOUNT}.</span>}
              {phase === "fetching-quote" && (
                <span className="text-xs text-muted-2">Asking PancakeSwap&apos;s Smart Router for a live route — this can take several seconds.</span>
              )}
            </div>
          )}

          {quote && phase !== "need-amount" && (
            <div className="mt-3 rounded-xl border border-border-subtle bg-surface p-3 text-xs text-foreground/90">
              <p className="font-medium">Buy {quote.outputAsset.symbol}</p>
              <dl className="mt-1 grid grid-cols-2 gap-y-1">
                <dt className="text-muted-2">Pay</dt>
                <dd className="text-right tabular-nums">
                  {amountRaw} {quote.inputAsset.symbol}
                </dd>
                <dt className="text-muted-2">Estimated received</dt>
                <dd className="text-right tabular-nums">
                  ≈ {(Number(quote.expectedAmountOut) / 10 ** quote.outputAsset.decimals).toFixed(6)} {quote.outputAsset.symbol}
                </dd>
                <dt className="text-muted-2">Route</dt>
                <dd className="text-right">{quote.routeDescription}</dd>
                <dt className="text-muted-2">Slippage tolerance</dt>
                <dd className="text-right tabular-nums">{(quote.slippageBps / 100).toFixed(2)}%</dd>
                <dt className="text-muted-2">Minimum received</dt>
                <dd className="text-right tabular-nums">
                  {(Number(quote.minAmountOut) / 10 ** quote.outputAsset.decimals).toFixed(6)} {quote.outputAsset.symbol}
                </dd>
                <dt className="text-muted-2">Price impact</dt>
                <dd className="text-right tabular-nums">{(quote.priceImpactBps / 100).toFixed(2)}%</dd>
                <dt className="text-muted-2">Quote expires</dt>
                <dd className={`text-right tabular-nums ${quoteExpired ? "text-red-400" : ""}`}>
                  {quoteExpired ? "expired" : `in ${remainingSec}s`}
                </dd>
              </dl>

              {quoteExpired && phase !== "complete" && phase !== "refreshing-quote" && (
                <button type="button" onClick={getQuote} className="mt-2 rounded-lg border border-border-subtle px-2 py-1 text-xs font-medium text-foreground/90 transition-colors hover:border-border-strong">
                  Refresh quote
                </button>
              )}

              {(!quoteExpired || phase === "refreshing-quote") && (
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
                    <button type="button" onClick={doBuy} className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-brand-foreground transition-colors hover:bg-brand/90">
                      Buy spot {quote.outputAsset.symbol}
                    </button>
                  )}
                  {phase === "refreshing-quote" && (
                    <span className="text-muted-2">Getting a fresh live quote before you sign anything — this can take several seconds…</span>
                  )}
                  {phase === "swap-pending" && <span className="text-muted-2">Waiting for wallet…</span>}
                  {phase === "swap-confirming" && <span className="text-muted-2">Purchase submitted — confirming…</span>}
                  {phase === "verifying-position" && <span className="text-muted-2">Confirmed — verifying your real on-chain position…</span>}
                </div>
              )}
            </div>
          )}

          {phase === "complete" && verifiedPosition && (
            <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
              <p className="font-medium text-emerald-400">Purchase complete</p>
              <dl className="mt-1 grid grid-cols-2 gap-y-1 text-foreground/90">
                <dt className="text-muted-2">{stock.underlying} ({stock.wrapper})</dt>
                <dd className="text-right tabular-nums">{verifiedPosition.positionAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} tokens</dd>
                <dt className="text-muted-2">Current value</dt>
                <dd className="text-right tabular-nums">${verifiedPosition.positionValueUsd.toFixed(2)}</dd>
                <dt className="text-muted-2">Purchase price</dt>
                <dd className="text-right text-muted-2">available after transaction indexing</dd>
                <dt className="text-muted-2">Transaction</dt>
                <dd className="text-right">Confirmed</dd>
              </dl>
              <p className="mt-2 text-muted">Verified directly from your real on-chain balance — not the swap&apos;s estimated output.</p>
              <button type="button" onClick={resetFlow} className="mt-2 rounded-lg border border-border-subtle px-2 py-1 font-medium text-foreground/90 transition-colors hover:border-border-strong">
                Buy more
              </button>
            </div>
          )}

          {(approveTxHash || swapTxHash) && phase !== "complete" && (
            <p className="mt-2 text-xs text-muted-2">Last transaction: {swapTxHash ?? approveTxHash}</p>
          )}

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
