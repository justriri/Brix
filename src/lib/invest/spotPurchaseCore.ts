import { parseUnits, type Address } from "viem";

/**
 * Pure, dependency-free purchase-quote math for the real spot-purchase flow
 * (a PancakeSwap Smart-Router-routed swap on BSC mainnet, across V2/V3 —
 * see spotPurchaseClient.ts for the execution side). Zero `@/`-alias
 * imports, directly unit-testable with Node's test runner.
 *
 * EXECUTION-VENUE-AGNOSTIC BY DESIGN: this module has no notion of "a
 * pool" or "a dexId" — only `routerAmountOut` (whatever the chosen
 * execution infrastructure says it can deliver) and `routeDescription` (a
 * human-readable label for display). It therefore did not need to change
 * when execution moved from a single hand-picked V2 pool to PancakeSwap's
 * official Smart Router (multi-pool, multi-venue) — only the caller
 * supplying `routerAmountOut` changed.
 *
 * NO JAVASCRIPT FLOATING-POINT ARITHMETIC DETERMINES ANY TRANSACTION AMOUNT
 * HERE — re-audited and fixed from an earlier version of this file that
 * multiplied a JS `number` amount by `10^decimals` directly (a real
 * precision bug: floating-point multiplication of a human amount, not just
 * an input price, would have silently drifted for some values). Fixed by:
 *   - `quoteAmountIn` is now a STRING (exactly what the user typed, e.g.
 *     "10" or "10.50") parsed via viem's `parseUnits`, which does exact
 *     string-based decimal parsing — no float ever touches the input
 *     amount.
 *   - `stockPriceUsd`/`quoteAssetPriceUsd` are the ONE place a JS `number`
 *     is unavoidable (prices arrive as floats from upstream APIs/Safety
 *     Gate data) — each is converted to a fixed-point bigint EXACTLY ONCE,
 *     at a 1e8 scale (matching the same convention already used for
 *     Pyth-sourced prices in settlementAuthorizationCore.ts), and every
 *     subsequent step is plain BigInt arithmetic. This isolates floating
 *     point to "the externally-reported price itself has finite float
 *     precision" (an input-data limitation, unavoidable at the source) —
 *     not to any calculation performed in this file.
 *   - All BigInt division here floors (JS BigInt division truncates toward
 *     zero, which is floor for the non-negative values used throughout) —
 *     the SAFE rounding direction for both an expected-output ESTIMATE
 *     (never overpromise what the swap will produce) and a MINIMUM-received
 *     floor (never silently require slightly more than the slippage
 *     tolerance implies).
 *
 * EXECUTABLE-LIQUIDITY FIX (TSLAB INSUFFICIENT_OUTPUT_AMOUNT revert, second
 * half): `expectedAmountOut`/`minAmountOut` used to be derived ENTIRELY from
 * `quoteAssetPriceUsd`/`stockPriceUsd` (an independent price-feed estimate)
 * — never from the pool that actually executes the swap. Live-verified
 * during the TSLAB diagnosis: even against the CORRECT V2 pool, that
 * price-based estimate diverged from the pool's real `getAmountsOut` output
 * by ~4.6% for a representative trade, which alone is enough to trigger
 * PancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT. `buildPurchaseQuote` now takes
 * `routerAmountOut` — a live quote from the actual execution infrastructure
 * for the exact route that will execute (see spotPurchaseClient.ts's
 * getSmartRouterTrade) — as the authoritative `expectedAmountOut`, and
 * keeps the price-based figure only as a fair-value baseline to detect and
 * reject (BEFORE ever producing a quote) a trade size the pool is too thin
 * to execute without excessive price impact. This is a pre-trade safety
 * gate, distinct from `slippageBps` (which protects against ordinary
 * reserve movement between quoting and broadcasting).
 */

/** Matches the 1e8 fixed-point scale already used for Pyth-sourced prices in settlementAuthorizationCore.ts — not a new convention. */
const PRICE_SCALE = BigInt(100_000_000);

/**
 * The ONE float->bigint conversion point for a USD price. `Math.round` at
 * this scale (1e8) stays comfortably within JS's safe-integer range for any
 * realistic equity/stablecoin price (even a $1,000,000/share price scaled
 * by 1e8 is 1e14, well under Number.MAX_SAFE_INTEGER ≈ 9.007e15) — chosen
 * deliberately smaller than a naive 1e18 scale specifically to avoid
 * silently exceeding safe-integer precision during the multiplication.
 */
function priceToFixedPoint(priceUsd: number): bigint {
  if (!(priceUsd > 0)) throw new Error("price must be a positive number");
  return BigInt(Math.round(priceUsd * Number(PRICE_SCALE)));
}

export interface AssetRef {
  address: Address;
  symbol: string;
  decimals: number;
}

export interface BuildPurchaseQuoteParams {
  /** Exactly what the user typed, e.g. "10" or "10.50" — NEVER a pre-converted float. */
  quoteAmountInRaw: string;
  inputAsset: AssetRef;
  outputAsset: AssetRef;
  /** The input asset's own USD price — 1.0 for a USD stablecoin. Used ONLY as the fair-value baseline for the executable-liquidity check below, never as the source of expectedAmountOut. */
  quoteAssetPriceUsd: number;
  /** The output (tokenized stock) asset's current USD price (already Safety-Gate-checked). Used ONLY as the fair-value baseline for the executable-liquidity check below, never as the source of expectedAmountOut. */
  stockPriceUsd: number;
  /** A live quote from the actual execution infrastructure (PancakeSwap Smart Router) for this exact route — the authoritative, executable output for `amountIn` (see spotPurchaseClient.ts's getSmartRouterTrade). This becomes `expectedAmountOut` directly; it is NEVER estimated from price feeds. */
  routerAmountOut: bigint;
  /** Maximum acceptable slippage, in basis points (e.g. 50 = 0.50%). */
  slippageBps: number;
  /** Human-readable route summary (e.g. "100% V2" or "66% V3 + 34% V2") — informational only, never used to decide execution. See spotPurchaseClient.ts's describeRoute(). */
  routeDescription: string;
  routerAddress: Address;
  /** Ms epoch "now" — defaults to Date.now(); explicit for deterministic tests. */
  now?: number;
  /** How long this quote stays valid, in ms — defaults to 30 seconds, matching the UI's own countdown. */
  validityMs?: number;
}

export interface PurchaseQuote {
  inputAsset: AssetRef;
  outputAsset: AssetRef;
  amountIn: bigint;
  expectedAmountOut: bigint;
  minAmountOut: bigint;
  /** How far `expectedAmountOut` (the real, router-sourced output) falls short of the price-feed fair-value baseline, in basis points, floored at 0. A real, reserve-derived price-impact figure — not an estimate. */
  priceImpactBps: number;
  slippageBps: number;
  routeDescription: string;
  routerAddress: Address;
  quotedAt: number;
  expiresAt: number;
}

const MAX_SLIPPAGE_BPS = 10_000;
const DEFAULT_QUOTE_VALIDITY_MS = 30_000;

/**
 * Maximum tolerated divergence between the price-feed fair-value estimate
 * and the pool's real, router-sourced output before a trade is rejected as
 * having insufficient executable liquidity (distinct from `slippageBps`,
 * which tolerates ordinary reserve movement AFTER a trade is already
 * judged safe to attempt). 3% is deliberately much tighter than the
 * ~4.6% gap measured live against TSLAB's real, nearly-empty V2 pool
 * during diagnosis — chosen so that exact bug case is caught, not just
 * narrowly missed, while remaining loose enough not to reject ordinary
 * trades against genuinely deep pools.
 */
export const MAX_PRICE_IMPACT_BPS = 300;

/**
 * Builds a full, displayable purchase quote. Every field a user should see
 * BEFORE signing anything (build brief section 2) is present — nothing is
 * computed later, at click time, that wasn't already shown here. Throws on
 * any input that can't produce a safe quote (zero/negative amount, bad
 * slippage) rather than returning a degenerate quote silently.
 */
export function buildPurchaseQuote(params: BuildPurchaseQuoteParams): PurchaseQuote {
  if (params.slippageBps < 0 || params.slippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error(`slippageBps must be between 0 and ${MAX_SLIPPAGE_BPS}`);
  }

  const amountIn = parseUnits(params.quoteAmountInRaw, params.inputAsset.decimals);
  if (amountIn <= BigInt(0)) {
    throw new Error("quoteAmountInRaw must parse to a positive amount");
  }

  const quotePriceFixed = priceToFixedPoint(params.quoteAssetPriceUsd);
  const stockPriceFixed = priceToFixedPoint(params.stockPriceUsd);

  // Fair-value BASELINE ONLY (never the source of expectedAmountOut — see
  // module doc). See module doc for the dimensional derivation: the
  // PRICE_SCALE and 10^inputAsset.decimals terms cancel exactly, leaving an
  // exact (USD value of input / stock price) in the output asset's base
  // units.
  const numerator = amountIn * quotePriceFixed * BigInt(10) ** BigInt(params.outputAsset.decimals);
  const denominator = stockPriceFixed * BigInt(10) ** BigInt(params.inputAsset.decimals);
  const fairAmountOut = numerator / denominator; // floors — never overpromises

  if (params.routerAmountOut < BigInt(0)) {
    throw new Error("routerAmountOut must not be negative");
  }

  // Executable-liquidity gate: reject BEFORE producing a quote (so nothing
  // downstream can reach a wallet signature) if the pool that will actually
  // execute this trade would deliver meaningfully less than fair value
  // implies. Skipped only when the fair-value baseline itself floors to
  // zero (a genuinely negligible input amount, not a liquidity problem).
  let priceImpactBps = 0;
  if (fairAmountOut > BigInt(0)) {
    const shortfall = fairAmountOut > params.routerAmountOut ? fairAmountOut - params.routerAmountOut : BigInt(0);
    const shortfallBps = (shortfall * BigInt(10_000)) / fairAmountOut;
    priceImpactBps = Number(shortfallBps);
    if (shortfallBps > BigInt(MAX_PRICE_IMPACT_BPS)) {
      throw new Error(
        `This pool does not have enough executable liquidity for a trade this size (estimated price impact ${(priceImpactBps / 100).toFixed(2)}%, which is above the ${(MAX_PRICE_IMPACT_BPS / 100).toFixed(2)}% safety limit). Try a smaller amount, or wait for deeper liquidity.`
      );
    }
  }

  const expectedAmountOut = params.routerAmountOut;
  const minAmountOut = (expectedAmountOut * BigInt(MAX_SLIPPAGE_BPS - params.slippageBps)) / BigInt(MAX_SLIPPAGE_BPS);

  const quotedAt = params.now ?? Date.now();
  const expiresAt = quotedAt + (params.validityMs ?? DEFAULT_QUOTE_VALIDITY_MS);

  return {
    inputAsset: params.inputAsset,
    outputAsset: params.outputAsset,
    amountIn,
    expectedAmountOut,
    minAmountOut,
    priceImpactBps,
    slippageBps: params.slippageBps,
    routeDescription: params.routeDescription,
    routerAddress: params.routerAddress,
    quotedAt,
    expiresAt,
  };
}

export interface BuildSellQuoteParams {
  /** Exactly what the user typed, e.g. "1.5" — the amount of the STOCK TOKEN being sold, never a pre-converted float. */
  quoteAmountInRaw: string;
  /** The stock token being sold. */
  inputAsset: AssetRef;
  /** The proceeds asset (USDT). */
  outputAsset: AssetRef;
  /** USD price of the stock token being sold (the input). */
  stockPriceUsd: number;
  /** USD price of the proceeds asset (1.0 for USDT). */
  quoteAssetPriceUsd: number;
  routerAmountOut: bigint;
  slippageBps: number;
  routeDescription: string;
  routerAddress: Address;
  now?: number;
  validityMs?: number;
}

/**
 * The sell direction of the exact same swap (stock -> USDT, instead of
 * USDT -> stock). `buildPurchaseQuote()`'s math only ever cares about "the
 * USD price of whichever asset is the input" and "the USD price of
 * whichever asset is the output" — it has no notion of "buy" vs "sell"
 * baked in, so a sell reuses it directly rather than re-implementing the
 * same fixed-point fair-value/price-impact/slippage math a second time.
 * This wrapper exists only so SellSpotPanel.tsx's call site reads with
 * sell-shaped parameter names instead of the confusingly-buy-flavored ones
 * (`quoteAssetPriceUsd`/`stockPriceUsd`) `buildPurchaseQuote` itself uses.
 */
export function buildSellQuote(params: BuildSellQuoteParams): PurchaseQuote {
  return buildPurchaseQuote({
    quoteAmountInRaw: params.quoteAmountInRaw,
    inputAsset: params.inputAsset,
    outputAsset: params.outputAsset,
    quoteAssetPriceUsd: params.stockPriceUsd, // price of the INPUT (the stock being sold)
    stockPriceUsd: params.quoteAssetPriceUsd, // price of the OUTPUT (USDT = 1.0)
    routerAmountOut: params.routerAmountOut,
    slippageBps: params.slippageBps,
    routeDescription: params.routeDescription,
    routerAddress: params.routerAddress,
    now: params.now,
    validityMs: params.validityMs,
  });
}

/** Pure check — never trust wall-clock time implicitly inside this module; the caller supplies `now`. */
export function isQuoteExpired(quote: PurchaseQuote, now: number = Date.now()): boolean {
  return now >= quote.expiresAt;
}

/**
 * Re-validates a quote against freshly-fetched live data before letting the
 * user actually sign anything (build brief section 10 — "fail safely if the
 * original assumptions are no longer valid"). Returns a reason string if
 * anything material has changed; `null` means it's still safe to proceed.
 *
 * No longer compares a single `poolAddress`: a Smart-Router-routed trade
 * can legitimately span a different split of pools between two quotes
 * (e.g. 100% V2 one second, 60/40 V2+V3 the next) without that being
 * unsafe — what actually matters is caught more strongly elsewhere:
 * BuySpotPanel.tsx always fetches a BRAND NEW trade and re-runs the full
 * executable-liquidity gate (buildPurchaseQuote) immediately before
 * signing, rather than reusing a possibly-stale route. This function keeps
 * only the checks that remain meaningful on their own: expiry, and that
 * the router/token identities haven't changed.
 */
export function revalidatePurchaseQuote(
  quote: PurchaseQuote,
  current: { routerAddress: Address; inputAssetAddress: Address; outputAssetAddress: Address },
  now: number = Date.now()
): string | null {
  if (isQuoteExpired(quote, now)) return "Quote has expired — refresh before buying.";
  if (quote.routerAddress.toLowerCase() !== current.routerAddress.toLowerCase()) {
    return "The router address has changed since this quote was generated — refresh before buying.";
  }
  if (quote.inputAsset.address.toLowerCase() !== current.inputAssetAddress.toLowerCase()) {
    return "The input asset has changed since this quote was generated — refresh before buying.";
  }
  if (quote.outputAsset.address.toLowerCase() !== current.outputAssetAddress.toLowerCase()) {
    return "The output asset has changed since this quote was generated — refresh before buying.";
  }
  return null;
}
