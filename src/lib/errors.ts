/**
 * Typed errors for realistic failure modes, plus a mapping to plain-language
 * messages for the UI. Per the build brief: never surface a raw
 * "TypeError: Cannot read properties of undefined" to the user — that goes
 * to the developer console only.
 */

export type WeekendGuardErrorCode =
  | "API_UNAVAILABLE"
  | "STALE_PRICE"
  | "MISSING_REFERENCE_PRICE"
  | "TOKEN_NOT_RECOGNIZED"
  | "WRAPPER_PAUSED"
  | "LIQUIDITY_UNAVAILABLE"
  | "CONFLICTING_WRAPPER_PRICES"
  | "WALLET_DISCONNECTED"
  | "UNSUPPORTED_TOKEN"
  | "RATE_LIMITED"
  | "RPC_FAILURE"
  | "MISSING_CREDENTIALS"
  | "RWA_API_ERROR"
  | "UNKNOWN";

export class WeekendGuardError extends Error {
  readonly code: WeekendGuardErrorCode;
  /** Optional extra context for developer logs only — never shown to the user. */
  readonly context?: Record<string, unknown>;

  constructor(code: WeekendGuardErrorCode, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "WeekendGuardError";
    this.code = code;
    this.context = context;
  }
}

const PLAIN_LANGUAGE_MESSAGES: Record<WeekendGuardErrorCode, string> = {
  API_UNAVAILABLE:
    "We couldn't reach one of our data providers right now. This usually clears up in a minute — try again shortly.",
  STALE_PRICE:
    "The latest price we have for this asset is older than we're comfortable using. We won't act on stale data.",
  MISSING_REFERENCE_PRICE:
    "We don't have an independent reference price for this asset right now, so we can't safely evaluate it.",
  TOKEN_NOT_RECOGNIZED:
    "This token isn't one BRIX currently recognizes as a supported tokenized stock.",
  WRAPPER_PAUSED:
    "This tokenized-stock wrapper appears to be paused or frozen, so we're treating it as unavailable.",
  LIQUIDITY_UNAVAILABLE:
    "We couldn't confirm there's enough on-chain liquidity for this asset to price it safely.",
  CONFLICTING_WRAPPER_PRICES:
    "The wrappers we checked for this stock currently disagree by more than our safety threshold.",
  WALLET_DISCONNECTED: "Your wallet isn't connected. Connect a BSC wallet to see your positions.",
  UNSUPPORTED_TOKEN: "BRIX doesn't yet support this token in the MVP asset list.",
  RATE_LIMITED: "We're being rate-limited by a data provider. Please wait a moment and try again.",
  RPC_FAILURE: "We couldn't read from the BNB Smart Chain network just now. Please try again.",
  MISSING_CREDENTIALS:
    "This data source needs an API key that hasn't been configured yet, so we're showing it as unavailable rather than guessing.",
  RWA_API_ERROR:
    "Binance's data API accepted our request but reported an internal error for it, so we're treating this data as unavailable rather than guessing.",
  UNKNOWN: "Something went wrong. Please try again, or check the developer console for details.",
};

/** Turns any thrown value into a safe, plain-language string for the UI. */
export function toUserMessage(err: unknown): string {
  if (err instanceof WeekendGuardError) {
    return PLAIN_LANGUAGE_MESSAGES[err.code];
  }
  // Unknown/unexpected error: log full detail for developers, show a generic message to the user.
  console.error("[WeekendGuard] Unhandled error:", err);
  return PLAIN_LANGUAGE_MESSAGES.UNKNOWN;
}

export function isWeekendGuardError(err: unknown): err is WeekendGuardError {
  return err instanceof WeekendGuardError;
}
