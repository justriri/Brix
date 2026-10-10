#!/usr/bin/env node
/**
 * ONE-OFF VERIFICATION SCRIPT — not part of the app, not imported anywhere.
 *
 * Purpose: capture real, raw JSON from the Binance Web3 RWA Data API so we
 * can build lib/providers/binanceRwa.ts against a CONFIRMED schema instead
 * of the paraphrased/secondhand one from competitor repos.
 *
 * I (the agent) cannot run this myself — web3.binance.com is unreachable
 * from my network environment (confirmed via repeated DNS-resolution
 * failures, including with the sandbox fully disabled). You have working
 * access, so please run this and paste back the full stdout.
 *
 * Signing implemented per the OFFICIAL docs at
 * https://web3.binance.com/en/dev-docs/authentication (fetched directly,
 * not reconstructed from a competitor repo):
 *   - X-OC-TIMESTAMP is ISO 8601 with milliseconds, e.g. "2026-05-11T10:08:57.715Z"
 *     (NOT a Unix epoch — this was the bug in the first version of this script).
 *   - preHash = timestamp + METHOD + requestPath + body, with NO separators.
 *   - requestPath is the full path AS SENT ON THE WIRE, including the
 *     "/build" prefix and the raw-encoded query string — e.g.
 *     "/build/api/v1/dex/market/rwa/platforms". Omitting "/build" from the
 *     signed path (as the first version of this script did) was the other
 *     likely cause of the 401s.
 *   - signature = Base64(HMAC-SHA256(preHash, secretKey)), UTF-8 encoded.
 *   - body is "" for GET/HEAD requests.
 *
 * Usage:
 *   node --env-file=.env.local scripts/verify-rwa-api.mjs
 *
 * Requires BINANCE_WEB3_API_KEY and BINANCE_WEB3_SECRET in .env.local
 * (already present — never commit this file's output if it's redirected to
 * a file, since request/response logging could include your API key in
 * headers if you modify this script to log request headers).
 */

import { createHmac } from "node:crypto";

const BASE_URL = "https://web3.binance.com/build";
const API_KEY = process.env.BINANCE_WEB3_API_KEY;
const SECRET = process.env.BINANCE_WEB3_SECRET;

if (!API_KEY || !SECRET) {
  console.error("Missing BINANCE_WEB3_API_KEY / BINANCE_WEB3_SECRET. Run with: node --env-file=.env.local scripts/verify-rwa-api.mjs");
  process.exit(1);
}

/**
 * SAFE diagnostics only — never logs the full key, the secret, or any
 * signature. Shows just enough to rule out (or confirm) env-loading and
 * whitespace problems without exposing credential material.
 */
function printSafeDiagnostics() {
  console.log("=".repeat(80));
  console.log("SAFE DIAGNOSTICS (no secret material below)");
  console.log("=".repeat(80));

  const mask = (v) => (v.length <= 8 ? "(too short to mask safely)" : `${v.slice(0, 4)}...${v.slice(-4)}`);

  console.log(`BINANCE_WEB3_API_KEY present: ${Boolean(API_KEY)}`);
  console.log(`BINANCE_WEB3_API_KEY length: ${API_KEY.length}`);
  console.log(`BINANCE_WEB3_API_KEY (first4...last4): ${mask(API_KEY)}`);
  console.log(`BINANCE_WEB3_API_KEY has leading/trailing whitespace or CR/LF: ${API_KEY !== API_KEY.trim() || /[\r\n]/.test(API_KEY)}`);

  console.log(`BINANCE_WEB3_SECRET present: ${Boolean(SECRET)}`);
  console.log(`BINANCE_WEB3_SECRET length: ${SECRET.length}`);
  console.log(`BINANCE_WEB3_SECRET has leading/trailing whitespace or CR/LF: ${SECRET !== SECRET.trim() || /[\r\n]/.test(SECRET)}`);

  // Catches the classic gotcha: a variable already set in the parent shell
  // (e.g. a leftover `$env:BINANCE_WEB3_API_KEY = "..."` from an earlier
  // debugging session) silently wins over --env-file, because Node's
  // --env-file does NOT override a variable that already exists in
  // process.env when the process starts. We can't directly detect "this
  // came from the shell vs the file" from inside Node, but we CAN tell you
  // whether PowerShell/cmd currently has these set in the *current* shell
  // session as an env var the OS process inherited — which is the same
  // thing --env-file would silently lose to. Re-run
  // `echo $env:BINANCE_WEB3_API_KEY` (PowerShell) or `echo %BINANCE_WEB3_API_KEY%`
  // (cmd) in a FRESH terminal (not this one) to check for a stale export if
  // the masked key above doesn't match what you expect from .env.local.
  console.log("\nIf the masked key above doesn't match what's in .env.local, a stale shell-exported");
  console.log("variable may be shadowing the file — check with a fresh terminal (see comment in script).");
  console.log("=".repeat(80) + "\n");
}

async function getPublicIp() {
  try {
    const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(8_000) });
    const data = await res.json();
    return data.ip;
  } catch (err) {
    return `(could not determine: ${err.message})`;
  }
}

/**
 * Official signing per https://web3.binance.com/en/dev-docs/authentication:
 *   X-OC-TIMESTAMP = ISO 8601 with milliseconds (new Date().toISOString())
 *   preHash        = timestamp + METHOD + requestPath + body
 *   requestPath    = full wire path INCLUDING the "/build" prefix and the
 *                    raw-encoded query string (no percent-decoding, no
 *                    param reordering)
 *   X-OC-SIGN      = Base64(HMAC-SHA256(preHash, secretKey))
 */
function sign(method, requestPathWithBuildPrefix, body = "") {
  const timestamp = new Date().toISOString();
  const preHash = timestamp + method + requestPathWithBuildPrefix + body;
  const signature = createHmac("sha256", SECRET).update(preHash, "utf8").digest("base64");
  return { timestamp, signature, preHash };
}

/**
 * Minimal per-call output, per instruction: URL / HTTP status / response
 * JSON only. No public-IP re-fetch, no pre-hash print, no diagnostics this
 * round — those already did their job in earlier runs. Signing call itself
 * (sign()) is completely untouched.
 */
async function callRwa(routePath) {
  // routePath is relative to BASE_URL (e.g. "/api/v1/dex/market/rwa/platforms?...").
  // The signed requestPath must be the FULL wire path, i.e. "/build" + routePath.
  const requestPath = "/build" + routePath;
  const { timestamp, signature } = sign("GET", requestPath);
  const url = `${BASE_URL}${routePath}`;

  console.log(`\nURL: GET ${url}`);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-OC-APIKEY": API_KEY,
        "X-OC-TIMESTAMP": timestamp,
        "X-OC-SIGN": signature,
      },
      signal: AbortSignal.timeout(10_000),
    });

    const text = await res.text();
    console.log(`STATUS: ${res.status}`);
    try {
      console.log(`RESPONSE: ${JSON.stringify(JSON.parse(text), null, 2)}`);
    } catch {
      console.log(`RESPONSE (non-JSON): ${text}`);
    }
    return { status: res.status, text };
  } catch (err) {
    console.log(`REQUEST FAILED: ${err.message}`);
    return null;
  }
}

/**
 * This run tests exactly the two documented RWA endpoints requested —
 * testing whether the NEW (DeFi-scoped, confirmed-authenticating) Web3 key
 * also has RWA Data access, nothing more:
 *   GET /api/v1/dex/market/rwa/platforms
 *   GET /api/v1/dex/market/rwa/search?keyword=TSLA
 * (the tokens?binanceChainId=56 call and the auto price/underlying-market
 * chain from earlier runs are intentionally skipped this time.)
 */
async function main() {
  await callRwa("/api/v1/dex/market/rwa/platforms");
  await callRwa("/api/v1/dex/market/rwa/search?keyword=TSLA");
}

main();
