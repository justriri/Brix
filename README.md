# BRIX

BRIX is a BNB Chain tokenized-stock investment platform that connects on-chain stock ownership with fixed-term protection, continuous monitoring, and settlement — built for **BNB Hack: Tokenized Stocks Edition, with Binance Web3 Wallet**.

The product lifecycle is **Invest → Protect → Monitor → Settle**: buy a real tokenized-stock position on BSC, attach a fixed-term downside-protection policy to it, continuously verify the conditions that policy depends on through a deterministic **Safety Gate** (liquidity, price freshness, reference-price deviation, market status, cross-wrapper consistency), and resolve the outcome at the end of the protection period. The underlying asset purchase is the entry point, not the product — protection, monitoring, and settlement are what BRIX actually is. See [Settlement status](#settlement-status-implemented-not-currently-enabled) below for exactly what's real versus what's enabled in a given environment.

Full research and design rationale: [`reports/BNB tokenized stocks hackathon research.md`](reports/BNB%20tokenized%20stocks%20hackathon%20research.md) and [`reports/Weekend protection strategy memo.md`](reports/Weekend%20protection%20strategy%20memo.md).

Deploying this somewhere, or wiring up the monitoring scheduler? See [`DEPLOYMENT.md`](DEPLOYMENT.md) — Node version requirement, SQLite persistence compatibility by platform shape, required environment variables, and exactly how to trigger `/api/protection-scheduler` from an external cron.

## What's real vs. what's implemented-but-not-enabled

| Piece | Status |
|---|---|
| bStocks / Ondo price + liquidity on BSC | **Real.** Live PancakeSwap data via DexScreener's public API. |
| BSC wallet balances, spot purchase (approve + swap) | **Real.** Real PancakeSwap V2 transactions, real on-chain balance verification after every purchase. |
| Independent reference price (Chainlink/Pyth) | **Real when `PYTH_API_KEY` is set** (Pyth Hermes requires a key since the Aug 2026 "Pyth Core" upgrade). Without a key, this is reported as `unavailable` with a clear note — never faked. |
| Market open/closed status | **Real.** Self-computed from NYSE's published 2026 hours/holiday calendar. |
| xStocks | **Reference-only.** Confirmed *not* live on BSC (no BSC DEX pair exists) — shown as a Pyth cross-chain price, never as a holdable BSC position. |
| Safety Gate (5 checks, PASS/WARNING/FAIL) | **Real, deterministic, no LLM.** |
| Settlement contract, EIP-712 authorization, claim/payout | **Implemented and tested** (`contracts/src/WeekendGuardSettlement.sol`, 26 passing tests) — **not currently enabled** unless a contract address is configured for this environment. See below — this is a deployment/configuration state, not a missing feature. |
| Legacy dev-quote → real policy path (`lib/protection/policy.ts`) | **Intentionally disabled**, separately from the above — see below. |

## Settlement status (implemented, not currently enabled)

Distinguish two separate things that are easy to conflate:

1. **The real on-chain settlement system** — `contracts/src/WeekendGuardSettlement.sol` (policy creation, reserve accounting, EIP-712 authorization, eligibility, resolution, claim/payout, replay protection, reserve limits), the signing bridge (`lib/protection/settlementAuthorizationCore.ts` / `settlementSigner.ts`), and a real on-chain demo UI (`SettlementDemo.tsx`) that transacts for real once configured. This is **built and tested**, not a stub — it is simply not deployed in every environment. The app reads `NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS` / `NEXT_PUBLIC_USDT_ADDRESS` and shows "Settlement engine: Enabled" or "Implemented · Not enabled on this environment" accordingly — never claims "live" when no contract is configured. The reserve asset is USDT, not USDC (see SETTLEMENT.md "reserve asset") — a deliberate choice so BRIX's economic flow is one stablecoin end to end: USDT buys the tokenized stock and funds/pays the protection reserve.
2. **The legacy dev-quote → real-policy path** (`lib/protection/policy.ts`) — genuinely, deliberately disabled, independent of deployment. The hackathon's only trading-scope rule is *"Spot only. Perps are out."* Whether a fixed-term, pre-funded, non-leveraged contingent payout satisfies that rule is **unresolved** (see the research report's "Open Questions" section). Until BNB clarifies: every real financial function in `policy.ts` (`fundReservePool`, `purchasePolicy`, `executeSettlement`, `getReservePoolStatus`) **throws** `ProtectionMechanismDisabledError` instead of acting, and `lib/protection/quote.ts` returns a clearly-labelled **development-only** quote (illustrative premium tiers, no real pricing model).

Do not remove the `policy.ts` throws to "make a demo look live" without raising it explicitly — see the comment block at the top of that file.

## Getting started

```bash
npm install
cp .env.example .env.local   # optional — see below
npm run dev
```

Open http://localhost:3000. The market overview loads real BSC data with no configuration. Connecting a wallet requires a BSC-compatible injected wallet (MetaMask, Binance Wallet extension, Trust Wallet).

### Environment variables (all optional — see `.env.example`)

- `PYTH_API_KEY` — enables live independent reference prices (Chainlink/Pyth equity feeds). Without it, freshness/deviation checks report "unavailable" rather than a fabricated number, and the Safety Gate correctly fails closed (see `lib/safety/thresholds.ts`).
- `BSC_RPC_URL` — override the default public `bsc-dataseed.binance.org` endpoint.

### A note on the public BSC RPC endpoint

`bsc-dataseed.binance.org` was observed during development to be slow (multi-second responses) under load. `lib/chain.ts` sets an 8s timeout on all RPC calls specifically so one slow public node fails fast into the app's typed error/notes path instead of hanging a request — this is real, observed behavior, not defensive-programming theater. If you hit repeated `RPC_FAILURE` errors, set `BSC_RPC_URL` to a dedicated provider (e.g. a personal QuickNode/Ankr/NodeReal endpoint).

## Architecture

```
src/lib/
  types.ts                 Normalized TokenizedStock / SafetyGateResult / ProtectionQuote types
  config/assets.ts          Verified BSC contract addresses + Pyth feed IDs (see file header for provenance)
  chain.ts                  Shared viem BSC client (balances, decimals)
  marketCalendar.ts         Self-computed NYSE open/closed status + next-open calculation
  errors.ts                 Typed errors -> plain-language UI messages

  providers/
    dexscreener.ts           Shared DexScreener client (price/liquidity)
    pyth.ts                  Pyth Hermes client (needs PYTH_API_KEY for live prices)
    reference.ts             Primary/fallback reference-price resolution
    wrapperCommon.ts          Shared BSC-wrapper assembly (DexScreener + reference + decimals)
    bstocks.ts / ondo.ts      Wrapper-specific providers (both BSC-native)
    xstocks.ts                Reference-only (not a BSC position source — see file header)
    index.ts                  Aggregates all wrappers for a ticker

  safety/
    thresholds.ts             Documented, sourced numeric thresholds
    liquidity.ts / freshness.ts / referenceDeviation.ts / marketStatus.ts / wrapperConsistency.ts
    safetyGate.ts              Combines the 5 checks into PASS/WARNING/FAIL, deterministically

  agent/
    positionScanner.ts         Wallet -> on-chain balances -> Position[]
    riskMonitor.ts              Runs the Safety Gate for a position (with cross-wrapper data)
    settlementMonitor.ts        Settlement re-validation PREVIEW only (see protection/policy.ts)
    orchestrator.ts              Coordinates scan -> assess -> offer-eligibility (deterministic, no LLM)

  protection/
    quote.ts                   Development-only quote generator
    policy.ts                  DISABLED real settlement functions (see above)
    weekendTrustMonitor.ts      Deterministic Friday->Monday trust-continuity state machine
    protectionMonitoringSession.ts / protectionMonitoringRunner.ts / protectionScheduler.ts
                                Stateful session lifecycle + the external-cron-driven scheduler (see DEPLOYMENT.md)
    settlementAuthorizationCore.ts / settlementSigner.ts
                                Builds + signs the EIP-712 message the settlement contract verifies (see SETTLEMENT.md)

  invest/
    spotPurchaseCore.ts / spotPurchaseClient.ts
                                Real PancakeSwap V2 spot-purchase quote math + execution (exact integer arithmetic, no floats)
    intelligence/               Investment Intelligence Engine — deterministic, reuses the Safety Gate, never ranks assets
    assistant/                  Deterministic AI Investment Assistant — works with zero AI credentials; an optional
                                ANTHROPIC_API_KEY only rephrases wording, never computes a financial fact

contracts/         Isolated Hardhat subproject — WeekendGuardSettlement.sol (see SETTLEMENT.md)
src/components/    Dashboard UI — see "Primary user journey" below
src/app/api/       Server routes (keep API keys/RPC URLs server-side)
```

## Primary user journey

Discover (Investment Intelligence) → Analyze (Safety Gate) → Compare wrappers → Buy Spot (real
PancakeSwap swap) → Verify real on-chain balance → Protect (Weekend Protection quote) → Monitor
(trust continuity demo) → Settlement (scenario demo / signed-authorization flow, settlement itself
disabled). All of this lives in one `InvestmentIntelligencePanel` on the dashboard. The separate
"Positions already in your wallet" section below it is an independent, DexScreener-based path for
detecting tokenized-stock positions acquired *outside* WeekendGuard — it intentionally uses a
different data source than Investment Intelligence, not a second copy of the same feature.

## What's intentionally out of scope for this MVP

Per the build brief: no real insurance/payout contract, no reserve pool, no leverage/perps/futures/shorts/derivatives, no actuarial pricing model, no governance/DAO/token, and no LLM in the financial *decision* path — the optional AI assistant (`lib/invest/assistant/`) only rephrases already-computed, deterministic facts into natural language; it never computes a price, Safety Gate result, or quote itself. See `reports/Weekend protection strategy memo.md` section 10-G for the full rationale.
