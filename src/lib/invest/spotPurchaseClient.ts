"use client";

import { createPublicClient, createWalletClient, custom, http, hexToBigInt, erc20Abi, type Address } from "viem";
import { bsc } from "viem/chains";
import { ChainId, CurrencyAmount, ERC20Token, Percent, TradeType } from "@pancakeswap/sdk";
import { SmartRouter, SwapRouter, SMART_ROUTER_ADDRESSES, type SmartRouterTrade } from "@pancakeswap/smart-router";
import { BSC_PUBLIC_RPC_URLS } from "../config/assets.ts";

/**
 * Real, on-chain spot-purchase execution on BSC MAINNET (never testnet: the
 * tokenized-stock positions this whole app detects/protects only exist on
 * BSC mainnet, same chain chain.ts already reads balances from — unlike the
 * settlement contract, which is configurably testnet-first).
 *
 * EXECUTION-VENUE FIX (replaces the earlier hand-rolled, V2-only router
 * call): a controlled investigation (official PancakeSwap docs/source,
 * live-verified) found that BOTH bStocks and Ondo tokenized stocks on BSC
 * are actually traded, in production, through PancakeSwap's own official
 * "Tokenized Stocks Terminal" — which is built on PancakeSwap's Smart
 * Router (`@pancakeswap/smart-router`), the SAME open-source SDK
 * PancakeSwap's own frontend uses, not a hand-picked single pool. Smart
 * Router finds the best route across V2 + V3 (+ Stable) pools and returns
 * BOTH the quote and the exact calldata for that same route — a venue
 * mismatch between "what we quoted" and "what we execute" (the root cause
 * of the earlier TSLAB INSUFFICIENT_OUTPUT_AMOUNT bug) is structurally
 * impossible here, since both come from the same trade object.
 *
 * Pool discovery is done PURELY ON-CHAIN (getV2CandidatePools/
 * getV3CandidatePools with no subgraph provider) — live-verified during
 * this integration that this still finds bridge-token routes (e.g. via
 * WBNB) via PancakeSwap's own on-chain `BASES_TO_CHECK_TRADES_AGAINST`
 * list, so this does not depend on PancakeSwap's hosted subgraph (which
 * requires a thegraph.com/NodeReal API key this project does not have).
 *
 * PancakeSwapX (PancakeSwap's RFQ protocol) is deliberately NOT integrated:
 * it has no documented third-party API, settles via an off-chain-signed
 * order rather than a normal transaction, and fills asynchronously (up to
 * ~2 minutes, by a market maker, with no execution guarantee) — a
 * fundamentally different, materially riskier flow than Smart Router's
 * synchronous, deterministic AMM routing. Smart Router itself never routes
 * through PancakeSwapX (confirmed: its candidate-pool providers only ever
 * return V2/V3 AMM pools).
 *
 * The swap's `recipient` is always the connected wallet's OWN address —
 * acquired tokens land directly in the user's wallet; nothing in this app
 * ever takes custody of the tokenized stock.
 */

/** PancakeSwap's own canonical SmartRouter contract on BSC mainnet — exported by the official SDK, not hand-typed. This is the single contract users approve and sign a swap transaction to, for both the quote's route and its execution. */
export const SMART_ROUTER_ADDRESS: Address = SMART_ROUTER_ADDRESSES[ChainId.BSC] as Address;

/** BRIX always buys with USDT — a fixed, BRIX-chosen input asset (never "whichever pool happened to exist," which is what caused the earlier TSLAB bug). Address independently verified elsewhere in this codebase (trustedQuoteLiquidity.ts's allowlist); decimals is BSC USDT's well-known, immutable constant. Shared by BuySpotPanel.tsx and the assistant's quote-preview path so they can never quote a different asset than what actually executes. */
export const DEFAULT_QUOTE_ASSET = {
  address: "0x55d398326f99059fF775485246999027B3197955" as Address,
  symbol: "USDT",
  decimals: 18,
};

function walletClient() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet provider found.");
  }
  return createWalletClient({ chain: bsc, transport: custom(window.ethereum) });
}

/**
 * Plain HTTP-transport public client for READS (allowance checks, pool
 * discovery, quoting, receipt polling) — deliberately NOT routed through
 * window.ethereum like settlementContractClient.ts's publicClient() does,
 * because some injected wallets rate-limit or are slow for read-heavy
 * polling. A single module-level instance (not re-created per call, and
 * not behind a `ReturnType<typeof createPublicClient>`-annotated wrapper,
 * which widens/erases the chain-specific generics Smart Router's
 * `OnChainProvider` type expects) so Smart Router's multicall batching
 * actually batches across the many reads pool discovery/quoting needs.
 *
 * RPC URL FIX (root cause of unreliable "Get Buy Quote" live-diagnosed):
 * passing no URL to `http()` makes viem fall back to ITS OWN bundled
 * default for the `bsc` chain — confirmed live by inspecting
 * `viem/chains`'s `bsc.rpcUrls.default.http`, which is
 * `https://56.rpc.thirdweb.com`, a free-tier endpoint observed returning
 * HTTP 429 repeatedly under Smart Router's pool-discovery/quoting load
 * during this investigation. chain.ts (this app's OTHER public client)
 * already avoids this by passing an explicit URL — mirrored here for the
 * same reason, using the same already-vetted endpoint list
 * (lib/config/assets.ts's BSC_PUBLIC_RPC_URLS) rather than introducing a
 * new RPC source.
 */
const publicClient = createPublicClient({
  chain: bsc,
  transport: http(BSC_PUBLIC_RPC_URLS[0], { timeout: 10_000, retryCount: 2 }),
  batch: { multicall: { batchSize: 1024 * 200 } },
});
function readClient() {
  return publicClient;
}

const quoteProvider = SmartRouter.createQuoteProvider({ onChainProvider: () => readClient() });

/**
 * Reads the CURRENT on-chain allowance `spenderAddress` has from `owner` for
 * `tokenAddress` (build brief section 4 — "read current allowance... skip
 * approval if sufficient"). A plain read, no wallet interaction. Spender is
 * explicit (not hardcoded) since a Smart-Router-routed swap approves the
 * SmartRouter contract, not a fixed single router.
 */
export async function readAllowance(owner: Address, tokenAddress: Address, spenderAddress: Address): Promise<bigint> {
  return readClient().readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spenderAddress],
  });
}

/** Reads `owner`'s current balance of `tokenAddress` — used to pre-check "insufficient balance" (build brief section 4/11) before ever prompting a wallet signature. */
export async function readBalance(owner: Address, tokenAddress: Address): Promise<bigint> {
  return readClient().readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

/**
 * Approves EXACTLY `amount` (never an unlimited/MaxUint256 allowance) —
 * build brief section 4: "prefer the smallest practical allowance." Callers
 * should check readAllowance() first and skip this entirely if already
 * sufficient.
 */
export async function approveQuoteAsset(owner: Address, quoteAssetAddress: Address, spenderAddress: Address, amount: bigint): Promise<`0x${string}`> {
  return walletClient().writeContract({
    account: owner,
    address: quoteAssetAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [spenderAddress, amount],
  });
}

export interface SmartRouterTokenRef {
  address: Address;
  decimals: number;
  symbol: string;
}

/**
 * Asks PancakeSwap's own Smart Router for the best live route from
 * `inputToken` to `outputToken` for `amountIn`, across V2 + V3 pools,
 * discovered purely on-chain. Returns `null` if no executable route exists
 * at all (never fabricated) — the caller (spotPurchaseCore.ts's
 * executable-liquidity gate) decides what that means for safety.
 */
export async function getSmartRouterTrade(params: {
  amountIn: bigint;
  inputToken: SmartRouterTokenRef;
  outputToken: SmartRouterTokenRef;
}): Promise<SmartRouterTrade<TradeType> | null> {
  const client = readClient();
  const inputCurrency = new ERC20Token(ChainId.BSC, params.inputToken.address, params.inputToken.decimals, params.inputToken.symbol);
  const outputCurrency = new ERC20Token(ChainId.BSC, params.outputToken.address, params.outputToken.decimals, params.outputToken.symbol);
  const amount = CurrencyAmount.fromRawAmount(inputCurrency, params.amountIn);

  const [v2Pools, v3Pools] = await Promise.all([
    SmartRouter.getV2CandidatePools({ onChainProvider: () => client, currencyA: inputCurrency, currencyB: outputCurrency }),
    SmartRouter.getV3CandidatePools({ onChainProvider: () => client, currencyA: inputCurrency, currencyB: outputCurrency, subgraphFallback: false }),
  ]);
  const pools = [...v2Pools, ...v3Pools];
  if (pools.length === 0) return null;

  const trade = await SmartRouter.getBestTrade(amount, outputCurrency, TradeType.EXACT_INPUT, {
    gasPriceWei: () => client.getGasPrice(),
    maxHops: 2,
    maxSplits: 2,
    poolProvider: SmartRouter.createStaticPoolProvider(pools),
    quoteProvider,
    quoterOptimization: true,
  });
  return trade ?? null;
}

/** Human-readable summary of which pool types/shares a trade actually routes through — e.g. "100% V2" or "66% V3 + 34% V2" — shown to the user and used in BRIX's own purchase-safety messaging. Never used for execution itself (the trade object is). */
export function describeRoute(trade: SmartRouterTrade<TradeType>): string {
  const typeNames = ["V2", "V3", "Stable", "Mixed", "RFQ", "V4", "V4", "V4", "Bridge", "SVM"];
  return trade.routes
    .map((r) => `${Math.round(r.percent)}% ${typeNames[r.type] ?? `type${r.type}`}`)
    .join(" + ");
}

export interface SmartRouterSwapParams {
  owner: Address;
  trade: SmartRouterTrade<TradeType>;
  /** Maximum acceptable slippage, in basis points (e.g. 50 = 0.50%) — matches spotPurchaseCore.ts's own convention. */
  slippageBps: number;
}

/**
 * Executes the EXACT route `trade` describes via PancakeSwap's own
 * SwapRouter.swapCallParameters() — the same function PancakeSwap's
 * frontend uses, targeting the canonical SmartRouter contract. `recipient`
 * is always `params.owner` — the swap always delivers to the connected
 * wallet itself, never to this app or any intermediary contract.
 */
export async function swapViaSmartRouter(params: SmartRouterSwapParams): Promise<`0x${string}`> {
  const { value, calldata } = SwapRouter.swapCallParameters(params.trade, {
    recipient: params.owner,
    slippageTolerance: new Percent(params.slippageBps, 10_000),
  });
  return walletClient().sendTransaction({
    account: params.owner,
    to: SMART_ROUTER_ADDRESS,
    data: calldata,
    value: hexToBigInt(value),
  });
}

export type ReceiptOutcome = "success" | "reverted";

/**
 * Waits for a submitted transaction to actually be mined and reports its
 * REAL on-chain outcome (build brief section 6 — "do not show 'Purchased'
 * merely because the wallet accepted the transaction... only show a
 * completed purchase after confirmation"). Never fabricates a status —
 * if the receipt can't be fetched, this throws rather than guessing.
 */
export async function waitForTransaction(hash: `0x${string}`): Promise<ReceiptOutcome> {
  const receipt = await readClient().waitForTransactionReceipt({ hash });
  return receipt.status === "success" ? "success" : "reverted";
}
