/**
 * Converts every `bigint` anywhere in `value` to its decimal string form,
 * recursively, via a JSON.stringify replacer. Needed because
 * `NextResponse.json()`/`JSON.stringify` cannot serialize a `bigint`
 * natively — found live while verifying /api/assistant's quote-preview
 * response, which carries a real PurchaseQuote (spotPurchaseCore.ts,
 * amountIn/expectedAmountOut/minAmountOut are all bigint by design, for
 * exact integer arithmetic). Values are only re-typed for transport, never
 * rounded or altered — the exact decimal string round-trips back to the
 * identical bigint via `BigInt(str)` on the receiving side.
 */
export function serializeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));
}
