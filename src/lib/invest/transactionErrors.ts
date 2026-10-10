/**
 * Pure mapping from a raw wallet/RPC error to a short, user-facing message
 * (build brief section 11 — "do not expose raw RPC errors as the primary
 * UI message... keep the raw technical error available for debugging").
 * Zero imports, directly unit-testable: pattern-matches on the kind of
 * `.name`/`.message`/`.shortMessage` strings viem and injected wallets
 * actually produce, without depending on viem's error classes themselves
 * (keeps this testable with plain mock objects, no live wallet needed).
 */

export interface TransactionErrorInfo {
  /** Short, friendly message safe to show as the primary UI text. */
  userMessage: string;
  /** The original error's message, kept for a "details"/debug affordance — never hidden, just not the primary message. */
  rawMessage: string;
}

interface ErrorLike {
  name?: string;
  message?: string;
  shortMessage?: string;
  details?: string;
  cause?: unknown;
}

function text(err: ErrorLike): string {
  return [err.name, err.shortMessage, err.message, err.details].filter(Boolean).join(" | ").toLowerCase();
}

/**
 * Transport/RPC-level failure classification — shared by mapTransactionError
 * (approve/buy stage) and mapQuoteError (quote stage), since both can
 * encounter the exact same underlying network failures. Added after live
 * diagnosis found Smart Router's on-chain reads returning HTTP 429
 * (observed repeatedly against a rate-limited RPC endpoint) with NO
 * specific handling before this — such errors fell through to the generic
 * "failed" message, giving no actionable signal that the issue was
 * transient network/rate-limiting, not an unsafe trade.
 */
function classifyTransportError(combined: string): string | null {
  if (combined.includes("429") || combined.includes("rate limit") || combined.includes("too many requests")) {
    return "The blockchain network is temporarily rate-limiting requests. Wait a few seconds and try again.";
  }
  if (combined.includes("timeout") || combined.includes("timed out")) {
    return "The network request timed out. Check your connection and try again.";
  }
  if (
    combined.includes("fetch failed") ||
    combined.includes("enotfound") ||
    combined.includes("econnrefused") ||
    combined.includes("network error") ||
    combined.includes("failed to fetch")
  ) {
    return "Could not reach the blockchain network. Check your connection and try again.";
  }
  return null;
}

/**
 * WeekendGuardSettlement.sol's own revert reasons (contracts/src/
 * WeekendGuardSettlement.sol) — distinct from generic wallet/RPC errors:
 * these are the contract DELIBERATELY rejecting the call, each for a
 * specific, named reason. Added after live-diagnosing a real "Transaction
 * failed. See details for the technical error." report: a read-only
 * simulateContract() dry run against the real deployed contract (no
 * signature, no funds moved) reproduced the exact failure — the contract's
 * reserve pool (totalReserve) is currently $0, so ANY purchaseProtection
 * call reverts with "WeekendGuard: insufficient reserve" regardless of
 * position size. That revert reason has nothing to do with the user's
 * wallet, network, or RPC — it is real on-chain contract state — but it
 * fell through to the generic fallback because mapTransactionError had no
 * pattern for it.
 */
function classifyWeekendGuardRevert(combined: string): string | null {
  if (combined.includes("weekendguard: insufficient reserve")) {
    return "This protection product's reserve pool does not currently have enough funds to cover this policy's payout. This is not an error in your wallet or network — the contract itself has insufficient reserve right now. Try again later.";
  }
  if (combined.includes("weekendguard: exceeds exposure cap")) {
    return "This protection product has reached its total exposure cap right now. Try again later, or with a smaller covered amount.";
  }
  if (combined.includes("weekendguard: exceeds per-user cap")) {
    return "This would exceed the maximum protection exposure allowed per wallet. Try a smaller covered amount.";
  }
  if (combined.includes("weekendguard: expiry in the past")) {
    return "The protection quote's expiry has already passed. Get a fresh quote and try again.";
  }
  if (combined.includes("weekendguard: would breach active obligations")) {
    return "This action would breach the contract's obligations to existing active policies.";
  }
  if (combined.includes("weekendguard:")) {
    // A WeekendGuard-specific revert this mapper doesn't have a dedicated
    // message for yet — still surfaced distinctly from a generic "failed"
    // fallback, since it IS a known, named, on-chain rejection reason, not
    // an unclassified error.
    const match = combined.match(/weekendguard:\s*([^|]+)/);
    return match ? `The settlement contract rejected this: ${match[1].trim()}.` : null;
  }
  return null;
}

export function mapTransactionError(err: unknown): TransactionErrorInfo {
  const errLike = (typeof err === "object" && err !== null ? (err as ErrorLike) : {}) as ErrorLike;
  const rawMessage = errLike.message ?? (typeof err === "string" ? err : "Unknown error.");
  const combined = text(errLike);

  if (combined.includes("user rejected") || combined.includes("user denied") || combined.includes("rejected the request")) {
    return { userMessage: "The transaction was cancelled in your wallet.", rawMessage };
  }
  if (combined.includes("insufficient funds") && combined.includes("gas")) {
    return { userMessage: "You need enough BNB in your wallet to pay for gas.", rawMessage };
  }
  if (
    combined.includes("transfer amount exceeds balance") ||
    (combined.includes("insufficient") && (combined.includes("allowance") || combined.includes("balance")))
  ) {
    return { userMessage: "Your wallet does not have enough of the input token for this purchase.", rawMessage };
  }
  if (combined.includes("insufficient_output_amount") || combined.includes("insufficient output amount")) {
    return { userMessage: "The market moved beyond your selected slippage tolerance. Refresh the quote and try again.", rawMessage };
  }
  if (combined.includes("expired") || combined.includes("deadline")) {
    return { userMessage: "The transaction deadline passed before it could be confirmed. Refresh the quote and try again.", rawMessage };
  }
  if (combined.includes("chain mismatch") || combined.includes("wrong network") || combined.includes("does not match the target chain")) {
    return { userMessage: "Your wallet is on the wrong network. Switch to BSC mainnet to continue.", rawMessage };
  }
  if (combined.includes("no wallet provider")) {
    return { userMessage: "No wallet is connected.", rawMessage };
  }

  const weekendGuardMessage = classifyWeekendGuardRevert(combined);
  if (weekendGuardMessage) {
    return { userMessage: weekendGuardMessage, rawMessage };
  }

  const transportMessage = classifyTransportError(combined);
  if (transportMessage) {
    return { userMessage: transportMessage, rawMessage };
  }

  return { userMessage: "The transaction failed. See details for the technical error.", rawMessage };
}

/**
 * Error mapping for the QUOTE stage specifically (spotPurchaseCore.ts's
 * buildPurchaseQuote() / spotPurchaseClient.ts's getSmartRouterTrade()),
 * used by BuySpotPanel.tsx's getQuote() and doBuy()'s pre-signing refresh.
 * DELIBERATELY SEPARATE from mapTransactionError: buildPurchaseQuote()
 * already throws clear, specific, correct messages for the real safety
 * conditions it checks ("No executable route was found...", "This pool
 * does not have enough executable liquidity..." — see spotPurchaseCore.ts)
 * — running those through mapTransactionError's generic pattern list would
 * REPLACE them with a vague "transaction failed" fallback, destroying the
 * exact clarity those messages exist to provide. This function passes
 * those through verbatim, and reserves classification for everything
 * else (transport/RPC failures a human never phrased).
 */
export function mapQuoteError(err: unknown): TransactionErrorInfo {
  if (err instanceof Error) {
    if (err.message.startsWith("No executable route was found") || err.message.includes("does not have enough executable liquidity")) {
      return { userMessage: err.message, rawMessage: err.message };
    }
  }

  const errLike = (typeof err === "object" && err !== null ? (err as ErrorLike) : {}) as ErrorLike;
  const rawMessage = errLike.message ?? (typeof err === "string" ? err : "Unknown error.");
  const combined = text(errLike);

  const transportMessage = classifyTransportError(combined);
  if (transportMessage) {
    return { userMessage: transportMessage, rawMessage };
  }

  return { userMessage: "Could not get a live quote right now. See details for the technical error.", rawMessage };
}
