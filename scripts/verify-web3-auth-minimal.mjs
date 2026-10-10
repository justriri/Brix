#!/usr/bin/env node
/**
 * MINIMAL auth smoke test — ONE signed POST call against the confirmed
 * Web3 DeFi Data endpoint (POST /api/v1/defi/data/position/list, per the
 * official docs you read directly). Separate from verify-rwa-api.mjs so
 * that multi-call RWA flow stays untouched.
 *
 * Signing logic is copied verbatim (unchanged) from verify-rwa-api.mjs —
 * official spec: https://web3.binance.com/en/dev-docs/authentication
 *   preHash   = timestamp + METHOD + requestPath + body
 *   requestPath = "/build" + <endpoint path> (no query string for this call)
 *   body      = the EXACT raw JSON string sent on the wire (for POST) —
 *               the same string variable is reused for both signing and
 *               the actual fetch body below, so they can never drift.
 *   signature = Base64(HMAC-SHA256(preHash, secretKey))
 *
 * Usage:
 *   node --env-file=.env.local scripts/verify-web3-auth-minimal.mjs
 */

import { createHmac } from "node:crypto";

const BASE_URL = "https://web3.binance.com/build";
const DEFI_ENDPOINT_PATH = "/api/v1/defi/data/position/list";

// Well-known EVM zero address — constructed programmatically to avoid any
// transcription error, not anyone's real wallet. A position-list query for
// this address will legitimately return an empty/zero positions list; we
// only care whether the call authenticates (200) vs. rejects (401), not
// about the actual position data.
const PLACEHOLDER_WALLET_ADDRESS = "0x" + "0".repeat(40);

const API_KEY = process.env.BINANCE_WEB3_API_KEY;
const SECRET = process.env.BINANCE_WEB3_SECRET;

if (!API_KEY || !SECRET) {
  console.error("Missing BINANCE_WEB3_API_KEY / BINANCE_WEB3_SECRET in .env.local.");
  process.exit(1);
}

function sign(method, requestPathWithBuildPrefix, body = "") {
  const timestamp = new Date().toISOString();
  const preHash = timestamp + method + requestPathWithBuildPrefix + body;
  const signature = createHmac("sha256", SECRET).update(preHash, "utf8").digest("base64");
  return { timestamp, signature, preHash };
}

const mask = (v) => (v.length <= 8 ? "(too short to mask safely)" : `${v.slice(0, 4)}...${v.slice(-4)}`);

async function getPublicIp() {
  try {
    const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(8_000) });
    return (await res.json()).ip;
  } catch (err) {
    return `(could not determine: ${err.message})`;
  }
}

async function main() {
  console.log("=".repeat(80));
  console.log("MINIMAL AUTH TEST (POST) — no secret material printed below");
  console.log("=".repeat(80));
  console.log(`API key length: ${API_KEY.length}`);
  console.log(`API key (first4...last4): ${mask(API_KEY)}`);
  console.log(`Secret length: ${SECRET.length}`);
  console.log(`Public IP: ${await getPublicIp()}`);
  console.log(`Placeholder wallet address used: ${PLACEHOLDER_WALLET_ADDRESS}`);
  console.log("=".repeat(80) + "\n");

  // Computed ONCE, used identically for both signing and the actual request
  // body — guarantees the signed bytes and the sent bytes are the same string.
  const bodyString = JSON.stringify({
    addresses: [PLACEHOLDER_WALLET_ADDRESS],
    binanceChainIds: ["56"],
  });

  const requestPath = "/build" + DEFI_ENDPOINT_PATH;
  const { timestamp, signature, preHash } = sign("POST", requestPath, bodyString);
  const url = `${BASE_URL}${DEFI_ENDPOINT_PATH}`;

  console.log(`URL:     POST ${url}`);
  console.log(`BODY:    ${bodyString}`);
  console.log(`(pre-hash: ${JSON.stringify(preHash)})`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-OC-APIKEY": API_KEY,
        "X-OC-TIMESTAMP": timestamp,
        "X-OC-SIGN": signature,
        "Content-Type": "application/json",
      },
      body: bodyString,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    console.log(`STATUS:  ${res.status}`);
    try {
      console.log(`RESPONSE: ${JSON.stringify(JSON.parse(text), null, 2)}`);
    } catch {
      console.log(`RESPONSE (non-JSON): ${text}`);
    }

    if (res.status === 200) {
      console.log("\n=> 200: the new Web3 API key IS being accepted.");
    } else if (res.status === 401) {
      console.log(
        "\n=> Still 401 with a freshly-issued Web3-portal key on a DeFi-scoped endpoint: this now " +
          "points away from 'wrong key type' (ruled out) and toward either an IP restriction on " +
          "this specific key, or the signing/body-encoding still being subtly off. Compare the " +
          "printed pre-hash string above character-for-character against what the docs' example " +
          "shows for a POST request, if one is given."
      );
    }
  } catch (err) {
    console.log(`REQUEST FAILED: ${err.message}`);
  }
}

main();
