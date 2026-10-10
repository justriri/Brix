# WeekendGuard Settlement Layer

This document covers the on-chain settlement mechanism added on top of the
existing (unmodified) Safety Gate / Weekend Trust Monitor / Protection
Monitoring Session / Scheduler pipeline. Read `DEPLOYMENT.md` first for the
general runtime/deployment story — this document is specifically about the
new `contracts/` subproject and its off-chain counterpart.

## 1. Product boundary (read this first)

WeekendGuard protects a user's existing **spot** tokenized-stock position
(e.g. TSLAB/bStocks, Ondo, xStocks). The settlement contract:

- **Never** receives, holds, buys, sells, or trades the tokenized stock.
- **Never** opens margin, leverage, a perpetual, a future, or a short.
- Only ever moves **USDT**, in fixed amounts agreed at policy purchase time.
- Records `tokenizedStockContract` on each policy for traceability only —
  the contract never calls that address.

The user's spot position lives entirely outside this contract, untouched,
for the whole lifetime of a policy.

## 2. Official rule-boundary research

The hackathon's only trading-scope rule, quoted verbatim from BNB Chain's
own sources (already researched and cited in
`reports/BNB tokenized stocks hackathon research.md`, section on "The
trading-scope sentence"):

> "Spot only. Perps are out. BSC mainnet only" — [BNB Chain Blog](https://www.bnbchain.org/en/blog/bnb-hack-tokenized-stocks-edition-with-binance-web3-wallet), [BNB Chain hackathon page](https://www.bnbchain.org/en/hackathons/tokenized-stocks)

That sentence names perpetual futures specifically and never uses the words
"leverage," "derivative," "option," "contingent," or "insurance" in any
primary source found. **No FAQ, GitBook, or organizer clarification exists**
that classifies a fixed-term, pre-funded, binary, non-leveraged contingent
payout one way or the other — this was true at the time of the original
research pass and a fresh check for this task found no newer rules text,
FAQ, or clarification addressing it.

### This task's classification (an interpretation, not a ruling)

The settlement mechanism implemented here has every characteristic a narrow
reading of "no perps" would exclude from scrutiny, and none of the
characteristics the rule names:

| Perpetual/futures characteristic | This mechanism |
|---|---|
| Margin / leverage | None — fully pre-funded, 1:1 reserve-backed |
| Funding-rate mechanics | None |
| Open-ended liability | None — hard-capped at `maxPayoutAmount` per policy, further capped in aggregate by `maxExposureCap` |
| Ongoing position the user must actively manage | None — single-shot, non-renewable, resolves once at a fixed expiry |
| Trades/shorts the underlying | Never — the contract never touches the tokenized stock |

Read strictly, a payout contingent on a triggering condition is, in
traditional-finance terms, a contingent claim — and a screener applying "is
this a derivative" rather than "is this leveraged" could still flag it. This
determination happens at a pre-judging eligibility screen whose standard of
proof is unknown. **This remains genuinely unresolved** — this task does not
claim guaranteed hackathon eligibility, only that the implementation stays
as far as possible from every characteristic the rule explicitly names, and
documents the gap honestly rather than asserting compliance.

## 3. Architecture

```
Off-chain (unmodified)                          On-chain (new, this task)
───────────────────────                         ──────────────────────────
Safety Gate (5 checks)
   -> Weekend Trust Monitor
        -> Trust continuity across Fri/Sat/Sun/Mon
             -> decideSettlement() -> SettlementDecision
                  (SETTLEMENT_ELIGIBLE / SETTLEMENT_BLOCKED / NO_PAYOUT)
                        |
                        v
          settlementAuthorizationCore.ts (pure)
          builds an EIP-712 SettlementAuthorization message
          from the SettlementDecision — eligible = (outcome === ELIGIBLE)
                        |
                        v
          settlementSigner.ts (server-only)
          signs it with SETTLEMENT_SIGNER_PRIVATE_KEY
                        |                              |
                        v                              v
          /api/dev/settlement-authorization  --->  WeekendGuardSettlement.sol
          (returns {authorization, signature})      .resolveSettlement(...)
                                                     verifies signature,
                                                     fails closed on anything
                                                     wrong, transitions the
                                                     policy to ELIGIBLE or
                                                     CLOSED_NO_PAYOUT
                                                             |
                                                             v
                                                     .claimPayout(...)
                                                     pulls USDT to the
                                                     policy owner
```

**Everything left of the vertical line is completely unchanged** by this
task — the contract never recomputes a Safety Gate check, never evaluates
trust continuity, never decides whether a threshold was crossed. It trusts
exactly one thing: a correctly-signed EIP-712 message asserting the
already-computed outcome.

### Why a signed message instead of reading Pyth on-chain directly (Task 7)

Evaluated and rejected: Pyth's on-chain contracts (`updatePriceFeeds` /
`getPriceNoOlderThan`) can only attest "a price was published at time T
within confidence interval C" — a single point-in-time fact. They know
nothing about:
- liquidity/freshness/cross-wrapper-consistency checks,
- multi-day trust continuity across Friday→Monday,
- the "a missed checkpoint breaks trust and a later PASS never resets it"
  rule that is WeekendGuard's actual product logic.

Re-deriving that entire state machine in Solidity would duplicate
already-tested off-chain logic and reintroduce exactly the "should the
settlement layer make its own judgment calls" problem this project has
avoided throughout (see `weekendTrustMonitor.ts`'s own module doc on why a
WARNING counts as a trust failure during monitoring, for example — a
policy decision, not a price fact). A signed attestation bridging an
already-correct off-chain decision to an on-chain claim is the smallest
correct architecture. The signed message *does* carry `finalReferencePrice`
(Pyth-sourced, scaled 1e8) for on-chain transparency/audit via the
`PolicyResolved` event — it just isn't re-verified against Pyth on-chain,
since the eligibility decision was already made correctly off-chain.

## 4. Contract: `contracts/src/WeekendGuardSettlement.sol`

**Isolated subproject** (`contracts/`) with its own `package.json`/
`node_modules`/Hardhat toolchain — never imported by the Next.js app, so the
main app's build/lint/test pipeline is completely unaffected (confirmed:
102+ existing tests, build, and lint all still pass unchanged).

### Responsibilities (and explicit non-responsibilities)

Does: hold a USDT reserve, create policies, verify a signed settlement
authorization, let an eligible policy owner claim their payout once.

Does NOT: trade/buy/sell/hold the tokenized stock, create leverage, compute
a Safety Gate, compute trust continuity, or decide a threshold.

### Policy model

```solidity
struct Policy {
  address owner;
  string underlyingTicker;
  address tokenizedStockContract;   // traceability only, never called
  Wrapper wrapper;                  // BSTOCKS | ONDO | XSTOCKS
  uint256 coveredPositionValue;     // USDT base units
  uint256 thresholdBps;             // basis points, integer — no float on-chain
  uint256 premiumAmount;            // USDT base units, already collected
  uint256 maxPayoutAmount;          // USDT base units — fixed, binary payout
  uint64 startTime;
  uint64 expiryTime;
  bytes32 protectionSessionId;      // keccak256(off-chain sessionId) — see below
  PolicyStatus status;              // ACTIVE | ELIGIBLE | CLAIMED | CLOSED_NO_PAYOUT
  bool settled;
}
```

### Off-chain session <-> on-chain policy linkage (Task 11)

`ProtectionMonitoringSession` (unchanged shape otherwise) gained one new
optional field: `onChainPolicyId?: string`, set via a new pure function
`linkOnChainPolicy(session, policyId)` in `protectionMonitoringSession.ts`.
The contract stores the REVERSE direction as `protectionSessionId: bytes32`
— `keccak256(sessionId)`, not the session's full history. This was the
cleanest direction given the existing data model: the off-chain session
already has a well-known string id; the contract only ever needs a fixed-size
value to prove linkage, never needs to read the session itself, and no
session history is stored on-chain at all.

### Reserve model (Task 5)

- `totalReserve`: every USDT ever funded (via `fundReserve`, callable by
  anyone — a demo wallet pre-funding the pool) or collected as premium.
- `totalLockedForActivePolicies`: sum of `maxPayoutAmount` across every
  policy that might still need to pay out — **ACTIVE and ELIGIBLE-but-not-
  yet-claimed policies both count** (see the security-review fix below for
  why this matters).
- `purchaseProtection` rejects (reverts, never silently degrades) if the new
  policy's `maxPayoutAmount` would push `totalLockedForActivePolicies` past
  either `totalReserve` or the separately-configured `maxExposureCap`.
- `perUserCap`: per-wallet cap on simultaneously-active coverage.
- `withdrawReserve` (owner-only) cannot withdraw below what's currently
  obligated to active/eligible policies.
- `forceCloseExpired`: a safety valve, callable by **anyone**, only reachable
  7 days after a policy's own expiry, that closes a never-resolved policy
  with **no payout** and releases its reserve lock — prevents a
  non-responsive backend from permanently stranding reserve capacity. Not a
  backdoor: it can never create a payout, only release one that was never
  going to happen.

### Reserve mechanics, in plain language

- **How it's funded**: anyone calls `fundReserve(amount)`, which pulls
  `amount` USDT from the caller's wallet (via `transferFrom`, so the caller
  must `approve` the contract first) and adds it to `totalReserve`. There is
  no separate "admin-only" funding path — this is deliberate, per the
  original build brief's "Developer/demo reserve → Protection contract"
  diagram — but in practice it's the deployer/owner who funds it, since
  nobody else has a reason to give the contract free money.
- **Who funds it**: whoever you decide — typically the deployer wallet,
  right after deployment, before any real user can buy protection. A
  policy's premium also adds to `totalReserve` automatically at purchase
  time (see `purchaseProtection`), so the reserve grows organically as
  policies are sold, on top of whatever was seeded manually.
- **What asset**: USDT only — `usdt` is set once, immutably, at
  construction (the `usdtAddress` constructor argument) and can never be
  changed afterward. There is no multi-asset reserve.
- **How exposure caps relate to the reserve**: `purchaseProtection` enforces
  TWO independent checks before issuing any policy — (1)
  `totalLockedForActivePolicies + maxPayoutAmount <= totalReserve` (there
  must be ACTUAL funded USDT to back the promise) and (2) the same sum
  `<= maxExposureCap` (a separate, owner-set policy limit that can be
  tighter than the reserve — e.g. to cap total risk even if the reserve
  happens to be larger). Both must pass. `maxExposureCap` being high does
  NOT let the contract promise more than it actually holds; `totalReserve`
  being high does NOT let it exceed the exposure cap either.
- **What happens if the reserve is insufficient**: `purchaseProtection`
  **reverts** with `"WeekendGuard: insufficient reserve"` — the whole
  transaction fails, no policy is created, no USDT moves, nothing is
  partially committed. Fails closed, exactly like every other guard in this
  contract; there is no degraded/partial-coverage fallback.

### Settlement authorization (EIP-712)

```solidity
struct SettlementAuthorization {
  uint256 policyId;
  bool eligible;
  int256 finalReferencePrice;   // 1e8-scaled, transparency only
  uint64 settlementTimestamp;
  uint64 authorizationExpiry;   // this SIGNED MESSAGE's own expiry
  uint256 nonce;
}
```

`resolveSettlement(policyId, auth, signature)` is **permissionless** (any
caller, typically the user's own wallet in this demo) — the security
property lives entirely in `ECDSA.recover(digest, signature) == trustedSigner`,
not in who submits the transaction.

### Fail-closed checklist (Task 8) — every condition reverts, none default to paying

| Condition | Result |
|---|---|
| Policy not ACTIVE (wrong policy / already settled) | Revert |
| Settlement attempted before `policy.expiryTime` | Revert |
| Authorization's own `authorizationExpiry` has passed | Revert |
| Authorization already used (replay) | Revert |
| Signature does not recover to `trustedSigner` | Revert |
| `eligible: false` | No payout — policy closes, no revert needed, this is a valid outcome |
| Claim amount would exceed `maxPayoutAmount` | Impossible by construction — `claimPayout` only ever transfers the policy's own fixed `maxPayoutAmount` |
| Reserve insufficient at claim time | Revert |
| Not the policy owner claiming | Revert |

### Replay / double-settlement protection (Task 9)

Two independent, overlapping guards:
1. **State machine**: a policy can only be ACTIVE once; `resolveSettlement`
   requires `status == ACTIVE`, so a second call for the same policy always
   reverts regardless of the signature.
2. **`usedAuthorizations` mapping**: keyed by the EIP-712 struct hash of the
   exact signed payload — belt-and-suspenders independent of (1).

`claimPayout` additionally requires `status == ELIGIBLE` and `!settled`,
and sets `settled = true` before the external transfer (checks-effects-
interactions) — a second claim attempt reverts with "not eligible."

## 5. Security review findings (Task 16)

A genuine bug was found and fixed during this review, not just a checklist
performed after the fact:

### Found & fixed: reserve double-counting while ELIGIBLE-but-unclaimed

**The bug**: the first implementation released `totalLockedForActivePolicies`
immediately inside `resolveSettlement`, for BOTH the eligible and
not-eligible branches. That meant the moment a policy became `ELIGIBLE` (but
before the owner actually called `claimPayout`), its reserved capacity was
already marked "available" again — a brand-new policy could then be
purchased against the SAME USDT that was still physically owed to the first,
unclaimed policy. Caught by applying the brief's own "reserve accounting
errors" checklist item seriously rather than trusting the happy-path tests.

**The fix**: capacity is now only released in `resolveSettlement` for the
`eligible: false` branch (no payout will ever happen, safe to free
immediately). For `eligible: true`, the lock is carried forward and released
inside `claimPayout`, at the same point `totalReserve` is decremented,
right before the external transfer.

**Regression test added**: `"a resolved-but-not-yet-claimed ELIGIBLE
policy's capacity stays locked, and cannot be double-committed to a new
purchase"` — funds a reserve with exactly enough for one policy, resolves it
eligible, and confirms a second purchase attempt (even for 1 wei of
payout) correctly reverts with `"WeekendGuard: insufficient reserve"` until
the first policy is actually claimed.

### Other items reviewed

| Item | Finding |
|---|---|
| Reentrancy | `claimPayout`/`resolveSettlement` follow checks-effects-interactions (state mutated before the external `usdt.safeTransfer`/before any external call); USDT itself has no callback hooks. Pull-payment pattern (claim is a separate tx from resolution) further minimizes surface. |
| Replay attacks | Covered above — two independent guards. |
| Signature malleability | Uses OpenZeppelin's `ECDSA.recover`, which rejects malleable (high-S) signatures and non-canonical `v` values by reverting, rather than silently recovering a different address. |
| Authorization expiry | `authorizationExpiry` is a field on the SIGNED message itself, independent of the policy's own expiry — enforced via `block.timestamp <= auth.authorizationExpiry`. |
| Incorrect chain ID | EIP-712 domain separator is computed live via OZ's `_hashTypedDataV4`, which rebuilds if `block.chainid` changes since construction — a signature for one chain cannot be replayed on another. |
| Incorrect contract address | `verifyingContract` is part of the EIP-712 domain the signature commits to — a signature for one deployed instance cannot be replayed against another. |
| USDT decimal assumptions | **Live-verified** against the real BSC Binance-Peg USDT contract (`0x55d398326f99059ff775485246999027b3197955`): **18 decimals, not 6** (confirmed via a direct on-chain `decimals()`/`symbol()` read during this task — a very easy wrong assumption to make, since USDT on most OTHER chains, including Ethereum mainnet, uses 6 decimals; BSC's Binance-Peg USDT does not). The contract itself never hardcodes a decimals assumption — it only ever moves raw `uint256` base units the caller supplies; `MockUSDT` in tests is deliberately also 18-decimal to match. |
| Integer rounding | No division happens on-chain anywhere in the contract — all amounts are raw base units computed off-chain (existing, unmodified `premiumTiers.ts`/quote logic) and passed through as-is. |
| Timestamp manipulation | All comparisons use day/hour-scale windows (policy expiry in days, authorization validity in ~1 hour); typical miner/validator timestamp drift (seconds) poses no practical exploitation path. |
| Policy ID collisions | `nextPolicyId` is a strictly-incrementing counter starting at 1, never reused. |
| Double claims | Covered above. |
| Reserve accounting errors | Found and fixed — see above. |
| Admin privilege abuse | `owner` is a **single EOA in this MVP** — a disclosed, intentional centralization risk, acceptable for a hackathon/testnet demo, NOT appropriate for a mainnet deployment holding meaningful funds (a multisig/timelock should replace it first). The owner's powers are bounded: can change `trustedSigner`/caps (a real risk if the owner key is compromised — document and rotate), but **cannot** withdraw reserve below what's obligated to active/eligible policies, and never touches individual policies directly. |
| EVM/chain compatibility | Compiles against OpenZeppelin 5.0.2 at the Paris EVM target (no MCOPY/transient-storage dependency) for maximum portability. Confirmed via research that BSC has supported Cancun opcodes (MCOPY, transient storage) since the Tycho hardfork (June 2024) anyway, so this was a conservative choice, not a workaround for an actual incompatibility. |

## 6. Off-chain changes

- `src/lib/protection/settlementAuthorizationCore.ts` (new, pure, zero
  value-level imports) — builds the exact EIP-712 message from an existing
  `SettlementDecision`. 5 tests.
- `src/lib/protection/settlementSigner.ts` (new, server-only) — the ONE
  place `SETTLEMENT_SIGNER_PRIVATE_KEY` is read; signs via viem (already a
  dependency, no new signing library).
- `src/app/api/dev/settlement-authorization/route.ts` (new, dev-only) —
  HTTP plumbing only; makes no eligibility decision itself, just signs
  whatever `session.settlement` (already computed) says.
- `src/lib/protection/protectionMonitoringSession.ts` — one new optional
  field (`onChainPolicyId`) and one new pure function (`linkOnChainPolicy`);
  zero changes to any existing trust/settlement logic.
- `src/lib/protection/db.ts` / `protectionSessionStore.ts` — idempotent
  column migration + persistence for the new field, plus two concurrency
  fixes discovered while building this (see "incidental fixes" below).
- `src/lib/protection/settlementContractAbi.ts` / `settlementContractClient.ts`
  (new, browser-only) — minimal hand-written ABI and viem wallet-client
  helpers (approve/purchase/resolve/claim), reusing the existing bare
  EIP-1193 wallet pattern from `useWallet.ts` — no new wallet library.
- `src/components/SettlementDemo.tsx` (new) — the Task 13 UI states, wired
  into the existing `BinanceRwaProtectionQuote.tsx` card alongside the other
  demos. Shows "not deployed" plainly (no fake buttons) when
  `NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS`/`NEXT_PUBLIC_USDT_ADDRESS` are
  unset.

### Incidental fixes found while building this (not scope creep — both block a correct production build)

1. **SQLite lock contention during `next build`**: Next's production build
   collects page data using multiple worker *processes*, each of which
   imports every API route (including this task's new ones) to inspect its
   config — meaning several separate `DatabaseSync` connections can open
   against the same file within milliseconds of each other. `node:sqlite`
   has no default busy-timeout (unlike e.g. `better-sqlite3`), so this
   reliably produced `"database is locked"` and failed the build. Fixed
   with one line: `db.exec("PRAGMA busy_timeout = 5000;")`.
2. **Migration race**: the first idempotent-migration approach
   (`PRAGMA table_info` check, then `ALTER TABLE ADD COLUMN` if missing) is
   itself racy under the same multi-process build — two workers can both see
   the column missing before either commits. SQLite has no
   `ADD COLUMN IF NOT EXISTS`, so this was fixed with try/catch around the
   `ALTER`, swallowing only the specific "duplicate column name" error.

Both were caught by actually running `npm run build` after adding the new
field/routes, not assumed away — confirming Task 9's "verify after a
production build, don't rely on dev behavior" instruction in practice.

## 7. Wallet flow

Extends the existing bare-EIP-1193 `useWallet.ts` (no wagmi/RainbowKit
introduced) with four new viem `writeContract` calls: `approve` (on the USDT
ERC-20), `purchaseProtection`, `resolveSettlement`, `claimPayout`, plus a
read (`getPolicy`). The user sees premium, max payout, and policy status
before signing anything (`SettlementDemo.tsx`), and the UI never shows an
enabled transaction button when the contract isn't configured for the
current environment.

## 8. Tests

- **Off-chain**: 5 new (`settlementAuthorizationCore.test.mts`) + 2 new
  (`linkOnChainPolicy`, persistence round-trip) = 109 total app tests, all
  passing (see final report for the exact count at completion).
- **On-chain** (`contracts/test/WeekendGuardSettlement.test.ts`, Hardhat):
  **22 passing** — policy creation (valid + malformed-rejection), USDT
  payment/reserve accounting, activation, settlement eligible/blocked,
  threshold boundary (3 cases: just-under/exact/just-over, confirming the
  contract behaves correctly for whatever boolean the off-chain decision
  produced), expiry (both "too early" and "authorization expired"), replay
  protection, double claim, max payout, reserve enforcement (both
  under-funded activation and owner-withdrawal-below-obligation), unauthorized
  settlement, the force-close safety valve, and the reserve-accounting
  regression test described above.

## 9. Deployment status

**UPDATE (2026-10-06): deployed to BNB Smart Chain MAINNET (chain id 56).**
The section below is kept as the historical record of the pre-deployment
state (this document originally described the contract as not yet
deployed anywhere); the facts that have changed since are called out
explicitly rather than silently rewritten.

- **Contract:** `WeekendGuardSettlement` at
  `0x045BB00c77dce598A63461934CDdF305be13Ae78`, BSC mainnet (chain id 56).
  Deployment tx: `0xc56fe35af89635377f099e3837ea25f16992e4f5f4d457d286c172c35dd8d656`.
- **USDT reserve asset:** `0x55d398326f99059fF775485246999027B3197955`
  (BSC Binance-Peg USDT, 18 decimals — live-verified, see section 5 above).
- **Owner:** the deployer's own wallet (a single EOA — see the
  centralization-risk note immediately below, still accurate and still
  unaddressed on this mainnet deployment).
- **Trusted signer:** a separate EOA, configured via `setTrustedSigner()`
  at/after deployment; its address is live-readable via the contract's own
  `trustedSigner()` getter, never printed as a private key anywhere in this
  repo or its docs.
- **Reserve:** has been funded (via `fundReserve`) and has backed at least
  one real, real-money policy purchase.
- **Active policy:** at least one real policy has been purchased and is
  outstanding against this reserve as of this update. Its specific terms
  (ticker, threshold, premium, expiry) are read live from the contract by
  the app, never hardcoded in this document, so they are not duplicated
  here where they could go stale.

**What this update does NOT claim:** that end-to-end settlement (a real
policy actually reaching `resolveSettlement` + `claimPayout` on mainnet)
has been exercised. It has not — see the project's own test/audit history
for exactly what has and has not been verified at any given point; this
document describes the contract's deployment and configuration, not a
settlement-correctness sign-off. Do not infer "production-verified" from
"deployed."

**Known blocker for a mainnet deployment specifically** (unchanged by the
above, and NOT resolved by deploying): this contract's `owner` is a single
EOA (see row 285 above) — disclosed in this file as "acceptable for a
hackathon/testnet demo, NOT appropriate for a mainnet deployment holding
meaningful funds (a multisig/timelock should replace it first)." That
assessment has not changed; it is now a live, real-money fact about this
exact deployment, not a hypothetical future risk.

### What deploying (testnet OR a SECOND/future mainnet instance) requires

The steps below remain accurate for deploying a NEW instance (e.g. to
testnet for further development, or a future replacement mainnet
contract) — they are not instructions for the already-deployed contract
above, which must not be redeployed or have its deployment repeated.

1. A funded wallet on the target chain (testnet BNB from a faucet, or real
   BNB for mainnet gas) — **use a dedicated wallet, never a primary
   personal one**, per this project's own security posture.
2. A separate "trusted signer" keypair (its PRIVATE key becomes the
   server-only `SETTLEMENT_SIGNER_PRIVATE_KEY`; only its PUBLIC address is
   a constructor argument, `TRUSTED_SIGNER_ADDRESS`).
3. Decide `INITIAL_MAX_EXPOSURE_CAP_USDT` / `INITIAL_PER_USER_CAP_USDT` —
   real risk-limit decisions, not a technical default.
4. Run `npm run deploy:testnet` or `npm run deploy:mainnet` from
   `contracts/` with the required env vars set (see `scripts/deploy.ts`'s
   doc comment for the full list) — it prints the deployed address (public,
   safe to record) and never prints any private key.
5. Call `fundReserve` from the deployer wallet with USDT — a freshly
   deployed contract's reserve is empty; no policy can be purchased until
   this happens.
6. Set `NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS`, `NEXT_PUBLIC_USDT_ADDRESS`,
   and `NEXT_PUBLIC_SETTLEMENT_CHAIN_ID` (97 or 56) in the app's production
   environment.
7. Walk through the real product flow end-to-end against the live
   contract: purchase (`PurchaseProtectionButton.tsx`), monitor (the
   scheduler, once a public deployment + external cron exist), resolve and
   claim (`PolicyClaimSection.tsx`, on `/app/portfolio`).

## 10. What's still out of scope

Everything the brief said not to build remains unbuilt: no reserve-pool
smart contract beyond this single pre-funded USDT pool, no premium
collection beyond the simple flat transfer already described, no automated
trading, no Friday-sell/Monday-rebuy, no new price feeds, no new Safety Gate
checks or trust rules, no Redis/Kafka/queues/microservices.

**UPDATE:** the scheduler (`protectionScheduler.ts`) now DOES automatically
generate and sign a settlement authorization (via
`settlementAuthorizationIssuer.ts`) once a monitored session reaches
`SETTLED` — this part of the "still out of scope" note above is no longer
accurate. What remains deliberately manual: actually SUBMITTING
`resolveSettlement`/`claimPayout` on-chain is still a one-click action taken
by the policy owner's own connected wallet (`PolicyClaimSection.tsx`), never
auto-submitted by a server-held relayer key — this is a product decision
(the owner, not the platform, authorizes the final on-chain step), not an
unfinished gap.
