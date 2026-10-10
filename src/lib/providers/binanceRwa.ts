import { createHmac } from "node:crypto";
import dns from "node:dns";
// Relative, with an explicit extension — keeps this module resolvable by
// Node's test runner directly (via issuerReference.ts, see its own
// comment) rather than requiring the "@/" path alias.
import { WeekendGuardError } from "../errors.ts";
import type { Wrapper } from "@/lib/types";

/**
 * Binance Web3 RWA Data API client.
 *
 * SERVER-SIDE ONLY. This module signs every request with
 * BINANCE_WEB3_SECRET via node:crypto — it must never be imported into a
 * "use client" component or any code path that could end up in a browser
 * bundle. Next.js will already fail to bundle `node:crypto` for the
 * client, but the explicit throw below is a second, cheap guard against a
 * future refactor accidentally importing this from client code.
 *
 * ALL TYPES AND ENDPOINT BEHAVIORS BELOW ARE LIVE-VERIFIED, not inferred
 * from docs paraphrasing or competitor repos. An earlier version of this
 * file guessed at several of these (wrong param names, wrong response
 * shapes) before live testing became possible — see git history. Specific
 * corrections made after live verification:
 *   - GET .../rwa/price takes a PLURAL, comma-separated
 *     `tokenContractAddresses` param (not singular `tokenContractAddress`)
 *     and returns a BATCH array, even for one address.
 *   - GET .../rwa/search returns an array of { ticker, companyName, assets }
 *     where `assets` (not the top-level entries) carries platformId/
 *     binanceChainId/tokenContractAddress — NOT a flat token list.
 *   - GET .../rwa/underlying-market nests most fields under `data.marketData`,
 *     not flat on `data`, and does NOT include tokenPrice at all.
 *   - GET .../rwa/underlying-profile is keyed by `tokenContractAddress` +
 *     `binanceChainId` (a specific token/platform), NOT by `underlyingTicker`.
 *   - `tokenPriceUpdatedAt` (ms epoch) exists on /price's response, but is
 *     ABSENT from /tokens and /underlying-market.
 *   - bStocks' `statusInfo.marketStatus` is consistently `null` in practice
 *     (confirmed live for TSLAB) — independently corroborating an earlier
 *     secondhand finding from a competitor's testing, not just repeating it.
 *   - Binance's `referencePrice` is sometimes IDENTICAL to `tokenPrice`
 *     (observed live for bStocks) and sometimes meaningfully different
 *     (observed live for some Ondo tokens) — consistent with the official
 *     docs' own description of it as "derived from the on-chain token
 *     price," not an independently-sourced market quote. See
 *     providers/binanceRwaStock.ts for why this means it is never wired
 *     into the Safety Gate's independent-reference check.
 *
 * Signing spec, live-verified end-to-end (HTTP 200, code 0) against
 * /platforms, /search, /price, /underlying-market, and /underlying-profile
 * during this build, per https://web3.binance.com/en/dev-docs/authentication:
 *   X-OC-TIMESTAMP = ISO 8601 with milliseconds (new Date().toISOString())
 *   preHash        = timestamp + METHOD + requestPath + body
 *   requestPath    = full wire path INCLUDING the "/build" prefix and the
 *                    raw-encoded query string
 *   X-OC-SIGN      = Base64(HMAC-SHA256(preHash, secretKey)), UTF-8
 *   body           = "" for GET
 * Do not modify this signing logic without re-verifying against a live
 * call first.
 *
 * X-OC-RECV-WINDOW (added after a live diagnosis, not part of the signed
 * preHash — confirmed against the official docs that this header is
 * excluded from signature computation): default recv_window is 5000ms;
 * over a slower network path (e.g. a VPN tunnel), round trips to
 * web3.binance.com were observed taking 3.5-7.7s, intermittently exceeding
 * that default and producing a genuine, correctly-functioning Binance
 * anti-replay rejection (`{"code":40103,"msg":"Timestamp outside
 * recv_window"}`) even with fully valid credentials — not an auth/IP/key
 * problem. Set to 60000 (the documented maximum) so normal network
 * latency variance no longer causes spurious rejections.
 *
 * Node DNS fix (intermittent `getaddrinfo ENOTFOUND web3.binance.com`,
 * live-reproduced): a direct dns.lookup() test (20 calls each) showed
 * web3.binance.com has NO working IPv6 (AAAA) resolution on this network —
 * family:6 failed 20/20 instantly, family:4 succeeded 20/20. With Node's
 * default (unspecified-family) lookup — what global fetch()/undici uses —
 * the OS's dual-stack getaddrinfo call intermittently failed outright
 * rather than cleanly falling back to the working A record. Setting
 * Node's default DNS result order to ipv4-first (a built-in Node API, no
 * new dependency, no hardcoded IP, process-wide but harmless since it only
 * changes ordering preference, never disables IPv6 resolution itself)
 * eliminated the failures: 20/20 default lookups then succeeded. Scoped
 * here since this module is the one making the affected calls.
 */
dns.setDefaultResultOrder("ipv4first");

if (typeof window !== "undefined") {
  throw new Error(
    "lib/providers/binanceRwa.ts must never be imported client-side — it signs requests with BINANCE_WEB3_SECRET."
  );
}

const BASE_URL = "https://web3.binance.com/build";

function getCredentials(): { apiKey: string; secret: string } | null {
  const apiKey = process.env.BINANCE_WEB3_API_KEY;
  const secret = process.env.BINANCE_WEB3_SECRET;
  if (!apiKey || !secret) return null;
  return { apiKey, secret };
}

export function isBinanceRwaConfigured(): boolean {
  return getCredentials() !== null;
}

function sign(
  secret: string,
  method: string,
  requestPathWithBuildPrefix: string,
  body = ""
): { timestamp: string; signature: string } {
  const timestamp = new Date().toISOString();
  const preHash = timestamp + method + requestPathWithBuildPrefix + body;
  const signature = createHmac("sha256", secret).update(preHash, "utf8").digest("base64");
  return { timestamp, signature };
}

interface BinanceEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

/**
 * Low-level signed call. Throws a typed WeekendGuardError for every failure
 * mode — transport failure, 401, 429, non-2xx, and the Binance-specific
 * "HTTP 200 but code !== 0" application-level error (observed live:
 * `{"code":50000,"msg":"Internal server error"}` and
 * `{"code":40001,"msg":"Parameter ... is required"}`, both with HTTP 200).
 * Never returns partial/guessed data on any of these paths.
 */
async function callRwa<T>(routePath: string): Promise<T> {
  const creds = getCredentials();
  if (!creds) {
    throw new WeekendGuardError(
      "MISSING_CREDENTIALS",
      "BINANCE_WEB3_API_KEY/BINANCE_WEB3_SECRET are not configured",
      { routePath }
    );
  }

  const requestPath = "/build" + routePath;
  const { timestamp, signature } = sign(creds.secret, "GET", requestPath, "");
  const url = `${BASE_URL}${routePath}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "X-OC-APIKEY": creds.apiKey,
        "X-OC-TIMESTAMP": timestamp,
        "X-OC-SIGN": signature,
        "X-OC-RECV-WINDOW": "60000",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // The underlying transport error (DNS failure, TCP connect timeout, TLS
    // error, etc.) was previously discarded here — stored on the thrown
    // error's `context` but never actually logged anywhere, so every
    // transport-level failure surfaced identically as "request failed" with
    // no way to tell a DNS failure from a connect timeout from a TLS error
    // without a one-off standalone script. Logged here, server-side only
    // (never sent to the client — toUserMessage() still returns the same
    // generic, safe message it always has).
    const cause = err instanceof Error ? err.cause : undefined;
    console.error(`[binanceRwa] Transport failure calling ${routePath}:`, err instanceof Error ? err.message : err, cause ? `\n  cause: ${String(cause)}` : "");
    throw new WeekendGuardError("API_UNAVAILABLE", "Binance Web3 RWA API request failed", {
      routePath,
      err,
    });
  }

  if (res.status === 401) {
    throw new WeekendGuardError(
      "MISSING_CREDENTIALS",
      "Binance Web3 API rejected the configured credentials (401)",
      { routePath }
    );
  }
  if (res.status === 429) {
    throw new WeekendGuardError("RATE_LIMITED", "Binance Web3 RWA API rate limit hit", { routePath });
  }
  if (!res.ok) {
    throw new WeekendGuardError("API_UNAVAILABLE", `Binance Web3 RWA API returned HTTP ${res.status}`, {
      routePath,
    });
  }

  const envelope = (await res.json()) as BinanceEnvelope<T>;
  if (envelope.code !== 0) {
    throw new WeekendGuardError(
      "RWA_API_ERROR",
      `Binance RWA API application-level error ${envelope.code}: ${envelope.msg}`,
      { routePath, code: envelope.code, msg: envelope.msg }
    );
  }

  return envelope.data;
}

// ---------------------------------------------------------------------------
// Types — all confirmed via live calls during this build (see header).
// ---------------------------------------------------------------------------

/** Confirmed live: "ondo" and "bstock". xStocks is confirmed NOT present. */
export type BinanceRwaPlatformId = "ondo" | "bstock" | (string & {});

export interface BinanceRwaStatusInfo {
  openState: boolean;
  marketStatus: string | null;
  reasonCode: string | null;
  reasonMsg: string | null;
  nextOpenTime: number | null;
  nextCloseTime: number | null;
}

/** GET /api/v1/dex/market/rwa/tokens response entry. */
export interface BinanceRwaToken {
  binanceChainId: string;
  tokenContractAddress: string;
  platformId: BinanceRwaPlatformId;
  assetType?: number;
  tokenName?: string;
  tokenSymbol?: string;
  tokenLogoUrl?: string;
  decimals?: string;
  underlyingTicker?: string;
  underlyingName?: string;
  underlyingNameZh?: string;
  tokenToShareRatio?: string;
  tags?: string[] | null;
  statusInfo?: BinanceRwaStatusInfo;
  tokenPrice?: string;
  referencePrice?: string;
  volume24H?: string;
  marketCap?: string;
  peRatioTTM?: number | null;
}

/** One entry inside a GET /rwa/search result's `assets` array. */
export interface BinanceRwaSearchAsset {
  platformId: BinanceRwaPlatformId;
  binanceChainId: string;
  tokenContractAddress: string;
  tokenSymbol?: string;
  assetType?: number;
}

/** GET /api/v1/dex/market/rwa/search response entry (one per matched company/ticker). */
export interface BinanceRwaSearchResult {
  ticker: string;
  companyName?: string;
  assets: BinanceRwaSearchAsset[];
}

/** GET /api/v1/dex/market/rwa/price response entry (the endpoint returns an array, even for one address). */
export interface BinanceRwaPriceEntry {
  binanceChainId: string;
  tokenContractAddress: string;
  platformId: BinanceRwaPlatformId;
  tokenPrice?: string;
  referencePrice?: string;
  tokenPriceUpdatedAt?: number;
}

export interface BinanceRwaUnderlyingMarketData {
  referencePrice: string | null;
  high52W?: string;
  low52W?: string;
  volumeShares24H?: string;
  avgDailyVolume1Y?: string | null;
  totalShares?: string | null;
  marketCap?: string;
  turnoverRate?: string | null;
  amplitude?: string | null;
  dividendYield?: string;
  latestDividend?: string;
  peRatioTTM?: string | null;
  pbRatio?: string | null;
}

/** GET /api/v1/dex/market/rwa/underlying-market response. No tokenPrice field at all — this endpoint is about the underlying, not the on-chain token. */
export interface BinanceRwaUnderlyingMarket {
  binanceChainId: string;
  tokenContractAddress: string;
  platformId: BinanceRwaPlatformId;
  assetType?: number;
  statusInfo: BinanceRwaStatusInfo;
  marketData: BinanceRwaUnderlyingMarketData;
}

/** GET /api/v1/dex/market/rwa/underlying-profile response — keyed by tokenContractAddress+binanceChainId, not by ticker. */
export interface BinanceRwaUnderlyingProfile {
  binanceChainId: string;
  tokenContractAddress: string;
  platformId: BinanceRwaPlatformId;
  underlyingTicker?: string;
  underlyingFullName?: string;
  assetType?: number;
  tokenToShareRatio?: string;
  protections?: {
    collateralReport?: { supported: boolean; description: string | null; url: string | null };
  };
  companyInfo?: {
    ceo?: string;
    website?: string;
    industry?: string;
    description?: string;
    descriptionZh?: string;
    conceptsEn?: string[];
    conceptsCn?: string[];
  };
}

interface ListWrapper<T> {
  list?: T[];
}

/**
 * Defensive extraction for the two endpoints confirmed to return a bare
 * array (/tokens, /search) — kept defensive (also accepting `{ list }`)
 * in case a future response adds pagination wrapping, rather than
 * hard-assuming the array-shape forever.
 */
function extractList<T>(data: T[] | ListWrapper<T> | null | undefined): T[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray((data as ListWrapper<T>).list)) {
    return (data as ListWrapper<T>).list as T[];
  }
  return [];
}

/** Parses a value that may be a JSON number or a numeric string. Never fabricates a value — returns undefined if unparseable or absent. */
export function toNumber(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Maps a Binance RWA platformId to WeekendGuard's internal Wrapper type.
 * Deliberately has NO "xstocks" branch: xStocks is confirmed absent from
 * this API as of live verification — adding a speculative mapping here
 * would risk silently fabricating xStocks support later.
 */
export function mapRwaPlatformIdToWrapper(platformId: string): Wrapper {
  if (platformId === "bstock") return "bstocks";
  if (platformId === "ondo") return "ondo";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** GET /api/v1/dex/market/rwa/search?keyword=... — LIVE-VERIFIED for keyword=TSLA. */
export async function searchRwaTicker(keyword: string): Promise<BinanceRwaSearchResult[]> {
  const data = await callRwa<BinanceRwaSearchResult[] | ListWrapper<BinanceRwaSearchResult>>(
    `/api/v1/dex/market/rwa/search?keyword=${encodeURIComponent(keyword)}`
  );
  return extractList(data);
}

/** GET /api/v1/dex/market/rwa/tokens?binanceChainId=... — LIVE-VERIFIED. Returns the full unfiltered list for that chain (no ticker filter param was found/tested) — callers filter client-side by underlyingTicker if needed. */
export async function getRwaTokens(params: { binanceChainId?: number | string } = {}): Promise<BinanceRwaToken[]> {
  const qs = params.binanceChainId !== undefined ? `?binanceChainId=${params.binanceChainId}` : "";
  const data = await callRwa<BinanceRwaToken[] | ListWrapper<BinanceRwaToken>>(
    `/api/v1/dex/market/rwa/tokens${qs}`
  );
  return extractList(data);
}

/**
 * GET /api/v1/dex/market/rwa/price?tokenContractAddresses=...&binanceChainId=...
 * LIVE-VERIFIED. Note the PLURAL, comma-separated param name — a singular
 * `tokenContractAddress` returns `{code:40001,msg:"Parameter
 * tokenContractAddresses is required"}` (observed live). Always returns an
 * array, even for one address.
 */
export async function getRwaPrice(params: {
  tokenContractAddresses: string[];
  binanceChainId: number | string;
}): Promise<BinanceRwaPriceEntry[]> {
  const qs = `?tokenContractAddresses=${params.tokenContractAddresses.map(encodeURIComponent).join(",")}&binanceChainId=${params.binanceChainId}`;
  const data = await callRwa<BinanceRwaPriceEntry[] | ListWrapper<BinanceRwaPriceEntry>>(
    `/api/v1/dex/market/rwa/price${qs}`
  );
  return extractList(data);
}

/**
 * GET /api/v1/dex/market/rwa/underlying-market?tokenContractAddress=...&binanceChainId=...
 * LIVE-VERIFIED. Singular `tokenContractAddress` (unlike /price). Returns a
 * single object, not an array. Has NO tokenPrice field — status/market
 * context only (statusInfo + marketData).
 */
export async function getUnderlyingMarket(params: {
  tokenContractAddress: string;
  binanceChainId: number | string;
}): Promise<BinanceRwaUnderlyingMarket> {
  const qs = `?tokenContractAddress=${encodeURIComponent(params.tokenContractAddress)}&binanceChainId=${params.binanceChainId}`;
  return callRwa(`/api/v1/dex/market/rwa/underlying-market${qs}`);
}

/**
 * GET /api/v1/dex/market/rwa/underlying-profile?tokenContractAddress=...&binanceChainId=...
 * LIVE-VERIFIED. Keyed by a SPECIFIC token/platform (tokenContractAddress +
 * binanceChainId), not by underlyingTicker — an earlier version of this
 * function guessed `underlyingTicker` as the param, which 400'd live
 * (`{"code":40001,"msg":"Parameter tokenContractAddress is required"}`).
 */
export async function getUnderlyingProfile(params: {
  tokenContractAddress: string;
  binanceChainId: number | string;
}): Promise<BinanceRwaUnderlyingProfile> {
  const qs = `?tokenContractAddress=${encodeURIComponent(params.tokenContractAddress)}&binanceChainId=${params.binanceChainId}`;
  return callRwa(`/api/v1/dex/market/rwa/underlying-profile${qs}`);
}
