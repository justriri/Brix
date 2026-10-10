# WeekendGuard Settlement — Audit and Deployment Readiness

This is an independent audit of the settlement layer built in the previous
task (`contracts/WeekendGuardSettlement.sol` and its off-chain bridge). It
re-examines the previous implementation's own claims rather than trusting
them, re-checks the official hackathon rules against a fresh fetch, and
researches the Pyth on-chain alternative on its current merits. **No
product code was changed as part of this audit** except the test
additions section 16 explicitly calls for; this is a read-and-report task.

Note on repo state: this project is not a git repository (`git status`
confirms `fatal: not a git repository`), so there is no diff/history to
inspect — the previous task's own final report is the only record of what
changed, and this audit re-reads the resulting files directly rather than
a diff.

---

## A. Official hackathon rules

Freshly re-fetched from the live page (not re-used from the earlier
research pass) at `https://www.bnbchain.org/en/hackathons/tokenized-stocks`:

- **"Spot only. Perps are out."** — stated plainly, names perpetuals
  specifically.
- **"BSC mainnet only."** — and, critically, two sentences that materially
  change the deployment plan:
  - **"Dry-run with the Transaction API while you build, then demo with
    small live amounts."** — testnet is explicitly framed as a *build-time*
    step, not a substitute for the real demo.
  - **"fund their own wallets, and a few dollars is enough to prove the
    flow works."** — the organizers themselves set the expected stakes at
    a few dollars, not a meaningfully-funded reserve.
- At least one of bStocks/Ondo/xStocks must be "central" to the submission
  (unchanged from the original research, "central" still undefined).
- Judging: Technical 30% / Creativity 25% / Developer Experience Report
  25% / Product & UX 20%.
- Standard jurisdictional eligibility exclusions (US, Canada, NL, Iran,
  Cuba, North Korea, Crimea, others) — unrelated to the mechanism question.

**What the rules do NOT say**: no FAQ, GitBook, or clarification anywhere
addresses fixed-term contingent payouts, pre-funded protection pools,
binary price-conditional claims, or any insurance/parametric product by
name — positively or negatively. This was true in the original research
pass and remains true on this fresh check.

**Conclusion**: nothing has changed since the original research. The
ambiguity is real and unresolved. **This audit does not claim
compliance.** It does newly confirm, with official language, that (1)
testnet does not satisfy "BSC mainnet only," and (2) the organizers
consider "a few dollars" sufficient proof — which materially shapes the
recommended reserve/cap sizing for any live demo (section K).

---

## B. Mechanism classification — independently challenged

Re-examined from first principles, not accepted from the prior report.

**Structurally unlike a perpetual/future:**
| Perp/futures characteristic | WeekendGuardSettlement |
|---|---|
| Margin / leverage | None — the contract only ever moves USDC it already holds; there is no concept of borrowed exposure |
| Funding-rate payments | None |
| Liquidation | None — there is no position that can be liquidated; a policy either pays its fixed `maxPayoutAmount` or nothing |
| Open-ended/rolling expiry | None — `expiryTime` is fixed at purchase, the policy resolves once and is done |
| Trades/shorts the underlying | Never — confirmed by code inspection: no function references `tokenizedStockContract` except to store and return it; no `call`/`transfer`/`approve` is ever made to it |
| Ongoing position the holder actively manages | None — single-shot, non-renewable |

**What could make an evaluator read it as derivative-like (stated plainly,
not minimized):**
- It is, in plain economic terms, a **binary option on a price threshold**
  — pay a premium now, receive a fixed payout if a price condition holds at
  a fixed future time, otherwise lose the premium. That is a textbook
  derivative payoff structure, even though it has none of perpetuals'
  specific named characteristics (margin, leverage, funding, liquidation).
- The payout is **contingent on a condition**, not a direct 1:1 spot
  transfer — an evaluator applying "is this a derivative" rather than "is
  this specifically a perpetual/future" could reasonably flag it.
- The mechanism exists **independently of whether the user still holds the
  spot position at settlement** — nothing in the contract re-checks that
  `policy.owner` still holds the tokenized stock when claiming. It is
  possible to buy a policy, immediately sell the underlying spot position,
  and still collect a payout if the price condition resolves favorably.
  This makes it closer to a pure price bet than "protection tightly bound
  to an existing position" — worth being honest about, since it slightly
  undercuts the "this merely protects an existing spot holding" framing.

This is a product-mechanism analysis, not a legal opinion, per the task's
own instruction — it does not resolve the ambiguity, it sharpens it.

---

## C. Current end-to-end architecture

Unchanged from the previous report, re-verified by direct code reading
(not re-described from memory):

```
Safety Gate (5 checks, unmodified)
  -> Weekend Trust Monitor (trust continuity Fri->Mon, unmodified)
       -> decideSettlement() -> SettlementDecision (unmodified)
            -> settlementAuthorizationCore.ts (pure; builds EIP-712 message)
                 -> settlementSigner.ts (server-only; signs with SETTLEMENT_SIGNER_PRIVATE_KEY)
                      -> /api/dev/settlement-authorization (HTTP; dev-only, UNAUTHENTICATED — see E)
                           -> WeekendGuardSettlement.sol.resolveSettlement()
                                -> .claimPayout()
```

Confirmed unchanged in this audit: Safety Gate, Trust Monitor,
`protectionMonitoringSession.ts`, `protectionMonitoringRunner.ts`,
`protectionScheduler.ts`, `trustSnapshot.ts`, Pyth provider, Binance RWA
provider, `useWallet.ts`, SQLite persistence. `policy.ts` remains fully
disabled (every function still throws `ProtectionMechanismDisabledError`).

---

## D. Pyth decision — re-challenged, not re-confirmed by default

**Research performed for this audit** (not re-used from memory):
Pyth's EVM contract-address page was fetched directly. Finding: a **BSC
TESTNET** Pyth contract address is documented
(`0x5744Cbf430D99456a0A8771208b674F27f8EF0Fb`); a **BSC MAINNET** address
was **not clearly confirmed** from the specific page fetched during this
audit (the page's "upgraded networks" table did not list BSC mainnet, in
the context of Pyth's newer "Pyth Core" API-key-gated upgrade — this is
about Hermes/off-chain delivery, not necessarily the on-chain contract's
existence, so treat this as "not independently confirmed this session,"
not "confirmed absent"). **This should be directly re-verified against
`docs.pyth.network`'s current EVM contract list before any decision
depends on it** — it was not treated as settled either way here.

**Option A — off-chain Pyth → off-chain trust → signed authorization →
contract (current implementation).** Unchanged recommendation: **keep it.**
Reasoning re-verified independently: Pyth's on-chain contract, even where
available, only ever attests "a price was published at time T within
confidence C" — a single point-in-time fact. It has no concept of
WeekendGuard's actual product logic (liquidity checks, cross-wrapper
consistency, multi-day trust continuity, missed-checkpoint handling). Nothing
about putting Pyth on-chain would let the CONTRACT verify any of that — the
backend would still need to attest the trust decision somehow, so Option A's
signed-authorization bridge is not avoidable, only potentially supplemented.

**Option B — Pyth on-chain for the final price, off-chain for Sat/Sun
continuity.** Re-evaluated on its own merits, not dismissed by default: this
would require `resolveSettlement` to also accept and verify a Pyth
`priceUpdateData` payload (calling `updatePriceFeeds` then
`getPriceNoOlderThan`), and recompute the threshold comparison on-chain
from that price plus a trusted Friday reference price (which itself would
still need to come from somewhere — either stored on-chain at purchase time,
or ALSO signed by the backend, since Friday's price isn't "the final price,"
it's a historical one Pyth's live oracle can't retroactively attest).
**This adds real contract complexity** (a Pyth SDK dependency, an `IPyth`
interface, update-fee handling in native currency, a second verification
path) **to verify only the LAST of several already-off-chain-verified
conditions** — trust continuity, missed checkpoints, and cross-wrapper
consistency would still be 100% off-chain and signed either way. The
marginal security gain is: an attacker who fully compromises
`SETTLEMENT_SIGNER_PRIVATE_KEY` could no longer fabricate an arbitrary
`finalReferencePrice` for a real, on-time settlement — but they could still
set `eligible` to whatever they want, since eligibility also depends on
trust continuity the on-chain Pyth check cannot see. **The marginal benefit
does not justify the added complexity for this MVP.**

**Option C — hybrid, lighter-weight**: have the contract **emit** the
Pyth-sourced `finalReferencePrice` (as today) for off-chain auditors to
independently cross-check against Hermes' historical price API after the
fact, without any on-chain verification call. This is what the current
implementation already does via the `PolicyResolved` event — so **Option C
is effectively already partially implemented**, just without a formal
verification step. No code change recommended here either.

**Recommendation: keep Option A, unchanged.** The real risk in this whole
chain is not "is the price right" (Pyth, off-chain, is reasonably trusted
infrastructure already used throughout this project) — it is "does the
signer correctly bind its signature to the right policy," which is a
software-logic question Option B does nothing to address. See section E.

---

## E. Signer security — the audit's most important finding

Audited deeply, per the brief's explicit checklist.

### What is solid, confirmed by direct code reading

- **EIP-712 domain**: name, version, `chainId`, `verifyingContract` are all
  part of the signed struct hash via OZ's `_hashTypedDataV4`, which
  recomputes the domain separator from the **live** `block.chainid` — a
  signature cannot be replayed on a different chain or against a different
  deployed contract instance. Confirmed by reading `EIP712.sol`'s own
  mechanism, not assumed.
- **Policy ID binding**: `resolveSettlement` requires `auth.policyId ==
  policyId` (the function argument) — confirmed by a new adversarial test
  (section 16) that a signature produced for policy A cannot be redirected
  to resolve policy B; it reverts with `"WeekendGuard: policy id mismatch"`.
- **Expiry**: `authorizationExpiry` (the signed message's own freshness
  window) and `policy.expiryTime` (the policy's own, separate deadline) are
  both enforced, confirmed by existing tests.
- **Settlement timestamp / final reference price**: carried in the signed
  struct for audit transparency; **not used in any on-chain comparison**
  (see D) — so there is nothing for a tampered value to corrupt on-chain;
  confirmed by a new test that flipping any signed field (e.g. `eligible`)
  after signing invalidates the signature entirely (the whole struct is
  hashed together — there is no way to tamper with one field in isolation).
- **Signature malleability**: OZ's `ECDSA.recover` rejects malleable
  (high-S) signatures by reverting, not by silently recovering a different
  address.
- **Can the signer authorize MORE than a policy's own `maxPayoutAmount`?
  No** — the signed message carries only a boolean `eligible`; the actual
  transferred amount is always read from `policy.maxPayoutAmount`, set
  immutably at purchase time and never present in the signed message at
  all. **The signer's cryptographic authority is scoped to a single
  binary decision per policy, never an amount.** This is a real strength,
  confirmed by code inspection — there is no code path where the signer's
  message influences the transferred amount.

### The critical finding: the signer SERVICE, not the contract, has no binding check — and no authentication

`src/app/api/dev/settlement-authorization/route.ts` takes **two entirely
independent, caller-supplied values**: `sessionId` (used to look up a real,
already-settled off-chain session) and `policyId` (used directly, verbatim,
as the policy id to sign for). **The route never reads the on-chain
contract to confirm that `policies[policyId].protectionSessionId ==
keccak256(sessionId)`, or that `policies[policyId].owner` is the caller, or
that `policies[policyId].underlyingTicker`/`thresholdBps` match the session
being vouched for.** It simply signs `(policyId, eligible-from-sessionId,
...)` for whatever `policyId` the HTTP caller asked for.

Compounding this: **the route has no authentication at all** — unlike
`/api/protection-scheduler`, which requires `SCHEDULER_TRIGGER_SECRET` in
production, this route is reachable by anyone who can send it a POST
request, as long as `SETTLEMENT_SIGNER_PRIVATE_KEY` is configured on the
server.

**Concretely exploitable scenario**: an attacker purchases their own policy
on-chain with an attacker-chosen `maxPayoutAmount` (bounded only by
`maxExposureCap`/`perUserCap`/available reserve — see section H for why
that number itself is also not verified against anything real). They then
find (or arrange) ANY session that reaches `SETTLEMENT_ELIGIBLE` — including
one from a completely unrelated, legitimate user's small policy, or even a
dev/test session with no real policy behind it — and POST that session's
`sessionId` alongside **their own fraudulent `policyId`** to this route. The
route has no way to know these two things don't belong together, and
returns a validly-signed `eligible: true` authorization for the attacker's
policy. The attacker submits it to `resolveSettlement` and later
`claimPayout`s a real USDC payout the off-chain trust pipeline never
actually evaluated for that policy at all.

**Direct answer to the brief's question**: *"Can a compromised settlement
signer steal reserve funds from unrelated policies, or is its authority
constrained to each individual policy and its maximum payout?"* — **The
contract's cryptographic design correctly constrains the signer to one
policy's own pre-set amount per signature (not a superuser at the contract
level).** However, **the signer SERVICE as currently built is effectively a
superuser oracle**: because it performs no on-chain binding check and has
no authentication, anyone who can reach it can obtain a validly-signed
`eligible: true` for *any* policyId of their choosing, without needing to
compromise the private key itself at all — just needing network access to
an unauthenticated HTTP endpoint. **This must be said explicitly: yes, as
currently wired, this is effectively a superuser hole, not a theoretical
one.**

This is **the single highest-priority finding of this audit** — see
section L.

### Signer rotation / compromise

`setTrustedSigner` (owner-only) allows rotating the signer if the key is
known to be compromised — a real mitigation, but reactive, not preventive;
it does nothing about the service-level gap above, which requires no key
compromise at all.

---

## F. Reserve accounting — re-audited from first principles

Modeled explicitly, not assumed correct because the previous task's own
regression test passed:

| State | Counted in `totalLockedForActivePolicies`? | Verified by |
|---|---|---|
| ACTIVE | Yes | `purchaseProtection` increments it |
| ELIGIBLE, unclaimed | **Yes** (fixed in the prior task after a real bug was found) | Existing regression test; re-confirmed by re-reading `resolveSettlement`'s `eligible` branch, which does NOT decrement the lock |
| CLAIMED | No — released at claim time | `claimPayout` decrements both `totalReserve` and the lock atomically, before the external transfer |
| CLOSED_NO_PAYOUT (resolved ineligible) | No — released immediately | `resolveSettlement`'s `else` branch |
| CLOSED_NO_PAYOUT (force-closed after grace period) | No — released | `forceCloseExpired` |

**Concurrent purchases/claims**: re-examined explicitly per the brief's
request, and an important distinction is worth stating plainly — **the EVM
has no concurrency**. Every transaction executes fully serialized, one at a
time, in whatever order they're mined. There is no data race at the
contract level the way there would be between multiple server processes
(which is what made the SQLite off-chain layer's earlier bug a real
concern in a previous task). Two "simultaneous" purchase transactions are
simply two transactions competing for the same block; whichever is mined
first sees correct, up-to-date reserve numbers, and a second one that would
breach a cap correctly reverts (confirmed by the new exact-boundary test in
section 16). This is normal, expected blockchain behavior (first valid
transaction wins), not a bug.

**Owner withdrawal**: re-confirmed `withdrawReserve`'s bound
(`amount <= totalReserve - totalLockedForActivePolicies`) correctly accounts
for ELIGIBLE-but-unclaimed obligations too, since those remain in the lock
per the fix above — the owner cannot strand a user's pending payout.

**No underflow/overflow risk**: all arithmetic is `uint256` under Solidity
≥0.8, which reverts on overflow/underflow by default; every subtraction in
this contract is preceded by a `require`/invariant that guarantees the
subtracted value cannot exceed the total (e.g. a policy's own
`maxPayoutAmount` was added to the lock at purchase and is the exact value
later subtracted).

**Conclusion: reserve accounting is sound**, now that the prior task's fix
is in place — re-confirmed independently, not just re-trusted.

---

## G. Policy immutability — confirmed structurally, not just by convention

Re-checked by reading every function in the contract: **no function exists
that can modify `underlyingTicker`, `tokenizedStockContract`, `wrapper`,
`coveredPositionValue`, `thresholdBps`, `premiumAmount`, `maxPayoutAmount`,
`expiryTime`, or `protectionSessionId` once a policy is created.** The only
fields any function ever writes after creation are `status` and `settled`.
**A user cannot pay for one protection condition and later have the
contract settle under another — this is impossible by construction, not
merely untested.** No fix needed here.

**Field-by-field categorization** (as requested):
| Field | Category |
|---|---|
| `owner` | Security-critical (claim authorization) |
| `maxPayoutAmount` | Security-critical (the amount transferred) |
| `expiryTime` | Security-critical (gates when resolution can occur) |
| `protectionSessionId` | Security-critical **in principle**, but currently unused for any actual verification (see E) — it is stored but nothing on-chain or off-chain cross-checks it before signing |
| `status`, `settled` | Security-critical (state machine) |
| `thresholdBps` | Informational on-chain — the threshold decision was already baked into the off-chain `eligible` boolean before signing; stored for audit/transparency only |
| `premiumAmount` | Informational for payout logic (not compared to `maxPayoutAmount` anywhere — see H) but security-relevant for reserve accounting (it does fund `totalReserve`) |
| `underlyingTicker`, `tokenizedStockContract`, `wrapper` | Purely informational/traceability — never read in any `require` or arithmetic |
| `coveredPositionValue` | **Currently decorative** — stored, emitted nowhere, never read by any function. Candidate for removal, or for actually being used to bound `maxPayoutAmount` (see H) |

---

## H. Covered position value — a second significant finding

Audited the exact question posed: **how is `coveredPositionValue`
established, and can a user overstate it?**

**Finding: `coveredPositionValue` and `maxPayoutAmount` are both plain
caller-supplied `uint256` parameters to `purchaseProtection`, with
ZERO on-chain verification against the user's actual tokenized-stock
balance, the quote the off-chain app computed, or any price oracle.** The
only constraints are the aggregate caps (`totalReserve`,
`maxExposureCap`, `perUserCap`) — there is **no relationship enforced
between `premiumAmount` and `maxPayoutAmount`** either. `premiumAmount` can
legally be **zero** (`if (p.premiumAmount > 0)` only conditionally
transfers — there is no `require(p.premiumAmount > 0)`), meaning a user
could, today, purchase a policy with `premiumAmount: 0` and
`maxPayoutAmount` equal to the entire available reserve (up to the
per-user/exposure caps), for free.

**Every way a user could overstate coverage, enumerated as requested:**
1. Set `coveredPositionValue` to any number — it is never checked against
   an actual balance.
2. Set `maxPayoutAmount` to any number up to the aggregate caps, regardless
   of `coveredPositionValue`, actual stock holdings, or premium paid.
3. Pay `premiumAmount: 0` and still receive a fully-valid ACTIVE policy.
4. Hold zero of the underlying tokenized stock at any point (purchase,
   monitoring, or claim) — the contract has no way to know or care.

**Can the current MVP cryptographically verify the user's actual spot
balance on-chain? Not today, and not cheaply**: the tokenized-stock
contracts (bStocks/Ondo/xStocks BEP-20s) are standard `balanceOf`-readable
ERC-20s, so a `require(IERC20(tokenizedStockContract).balanceOf(msg.sender)
>= someMinimum)` check IS technically straightforward to add — but it
immediately reopens exactly the questions this project worked hard to
avoid: rebase accounting (bStocks rebases on dividends), per-wrapper share
multipliers (Ondo), and which wrapper's balance even corresponds to
`coveredPositionValue` in USD terms (that still requires a live price,
reintroducing the same "which reference price" question the Safety Gate
already exists to answer carefully off-chain, not casually re-derive
on-chain).

**Comparing the three options the brief offered:**
- **Option 1 (verified position value via authorization)**: just moves the
  same trust problem into a SECOND signed message — doesn't eliminate the
  "trust a backend-asserted number" issue, adds complexity (two
  authorization types, two signatures) for no net reduction in trust
  surface.
- **Option 2 (cap to a small fixed amount)**: trivial to implement (already
  possible today, with zero code changes — the owner already controls
  `maxExposureCap` and `perUserCap`) and **directly matches the official
  hackathon guidance found in section A**: *"a few dollars is enough to
  prove the flow works."* At few-dollar stakes, the fact that a user could
  theoretically overstate their position is economically immaterial — there
  is nothing meaningful to gain by lying about a $5 policy.
- **Option 3 (on-chain balance check)**: real complexity (rebase/multiplier
  handling, a live price dependency for USD conversion) for a benefit that
  Option 2 already captures at demo stakes. Not justified for this MVP.

**Recommendation: Option 2.** Set `maxExposureCap` and `perUserCap` to
genuinely small values (e.g. low tens of dollars total) for any live
demo — this is a **deployment-time configuration decision, not a code
change** — and document `coveredPositionValue`/`maxPayoutAmount` as
trusted-input values appropriate only at hackathon-demo stakes, explicitly
NOT suitable for a deployment where the aggregate caps are raised to
anything meaningful. This is lower urgency than section E's finding: it is
bounded by owner-controlled caps today, whereas E is an active bypass
regardless of cap size.

---

## I. Off-chain ↔ on-chain binding (ties E and H together)

Per the brief's own framing — the contract does not need the entire
off-chain monitoring history, only enough cryptographic binding to know
"the trusted authority authorized THIS policy, under THIS policy's terms,
at THIS time, for THIS amount." **The contract's own binding is correct**
(policyId is part of the signed struct, amount is never part of it at all,
domain binds chain+contract). **The gap is entirely at the signer SERVICE
layer**, which currently performs none of this binding before it signs —
see section E for the full exploit path and section L for the fix.

---

## J. Wallet flow audit

Reviewed `SettlementDemo.tsx` state-by-state against the requested
distinction (quote / policy created / active / monitoring / eligible /
authorized / claimed):

- The component never shows a transaction hash, policy id, or "claimed"
  state unless the corresponding `writeContract` call actually returned a
  hash or the corresponding on-chain state actually changed — confirmed by
  reading the component: `lastTxHash` and `step` are only ever set inside
  the `run()` wrapper's try block, after an `await` on the real contract
  call resolves without throwing.
- When `NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS`/`NEXT_PUBLIC_USDC_ADDRESS`
  are unset, the component renders a plain "not deployed" message and
  **no buttons at all** — confirmed, not merely claimed.
- The settlement-authorization step surfaces `settlementOutcome` directly
  from the off-chain decision (`SETTLEMENT_ELIGIBLE`/`BLOCKED`/`NO_PAYOUT`)
  before the user submits it on-chain, so the UI never implies eligibility
  the backend didn't actually compute.
- **The dev route itself is labeled "DEV/DEMO ONLY" in its own doc comment**
  but, per section E, is not *functionally* restricted to development the
  way `/api/protection-scheduler` is (no secret gate). This is an honesty
  gap worth closing alongside the binding fix — labeling something
  dev-only in a comment doesn't prevent it from being hit in whatever
  environment the app happens to be running in.

No fake success states, transaction hashes, or contract addresses were
found — the UI honesty property holds. The SERVICE behind it does not.

---

## K. Deployment architecture — minimum needed

Re-confirmed the current stack is already minimal and sufficient; no
infrastructure should be added:

```
Next.js app (single long-lived process, `next start`)
  + SQLite (persistent local disk — see DEPLOYMENT.md for platform fit)
  + external HTTP scheduler trigger (/api/protection-scheduler)
  + WeekendGuardSettlement.sol + a small USDC reserve
  + Binance RWA API + Pyth Hermes (both already integrated, unchanged)
```

No Redis, Postgres, queues, or microservices are needed and none should be
added — nothing in this audit found a reason to deviate from
`DEPLOYMENT.md`'s existing architecture.

---

## L. Mainnet readiness — what is still missing

**Stage progression (confirmed safe ordering, re-derived independently):**
1. **Hardhat/local** (done — 26 passing tests against a local network).
2. **BSC testnet** — useful ONLY for contract debugging/gas-sanity-checking
   before mainnet; **does not satisfy "BSC mainnet only"** per section A's
   fresh fetch of the actual rule text. Not yet performed (no funded
   testnet wallet available in this environment, consistent with the prior
   task's own disclosure).
3. **BSC mainnet, tiny amounts** — what the hackathon actually requires for
   a real submission, per the organizers' own "a few dollars" framing.

**Blocking issues before even a tiny mainnet demo, in priority order:**
1. **(Critical, must fix)** The settlement-authorization service's missing
   on-chain binding check and missing authentication (section E). This is
   not a "harden it eventually" item — it means the demo, if shown publicly
   with the signer configured, is actively exploitable by anyone who finds
   the route, independent of fund size.
2. **(Should fix before mainnet, lower urgency)** Set `maxExposureCap` and
   `perUserCap` to genuinely tiny values at deployment time (section H) —
   a configuration step, not a code change, directly justified by the
   organizers' own "a few dollars" guidance.
3. **(Operational, not a vulnerability)** `SETTLEMENT_SIGNER_PRIVATE_KEY`
   must be a freshly-generated, mainnet-funded-with-nothing key (it only
   needs to sign messages, never hold funds or pay gas) — confirm this is
   understood before deployment, since a leaked signer key combined with
   finding #1 above would be doubly bad.
4. **Not performed, and correctly so per this task's constraints**: no
   mainnet deployment, no testnet deployment, no funded wallet was created
   or requested in this audit.

**Should the current contract be deployed as-is? No — not even to
testnet with a real signer configured**, until finding #1 is fixed. The
contract itself (`WeekendGuardSettlement.sol`) is sound; the service that
feeds it authorizations is not yet.

---

## Recommended next implementation step (exactly one, not yet built)

Per section 15's question — **do not build automatic settlement submission
yet.** Automating submission on top of an authorization service that has
no binding check or authentication would automate the vulnerability, not
just the convenience. Building automation now would be premature.

**The one recommended next step**: harden
`src/app/api/dev/settlement-authorization/route.ts` to:
1. Require the same shared-secret pattern already proven out for
   `/api/protection-scheduler` (`SCHEDULER_TRIGGER_SECRET`-style guard;
   likely a new, separate secret scoped to this route specifically, since
   signing authority is a different privilege than triggering monitoring).
2. **Before signing anything**, read the on-chain policy via the contract's
   existing `getPolicy(policyId)` and verify `policy.protectionSessionId ==
   keccak256(toBytes(sessionId))` — refusing to sign if they don't match.
   This single check closes the exploit path in section E completely,
   using data the contract already stores — no contract change needed.

This is deliberately scoped to ONE thing: closing the binding/auth gap.
Automatic submission, position-value verification (section H), and signer
rotation tooling are all reasonable later steps, but none of them should
be built before this one, and none are recommended as "the" next step.

---

## Summary

**What is solid**: the contract's state machine, replay protection,
reserve accounting (post-fix), policy immutability, EIP-712 domain
binding, and the spot/perps separation at the contract level. The Pyth
off-chain architecture decision holds up under re-challenge. The UI never
fabricates a success state.

**What is risky**: the settlement-authorization service's missing
policy↔session binding check and missing authentication (section E) — a
real, concretely exploitable gap, not a theoretical one. `coveredPositionValue`/
`maxPayoutAmount` are fully user-declared with no verification (section H),
acceptable only at the "a few dollars" stakes the hackathon itself endorses.

**What is unresolved**: hackathon eligibility for this mechanism class
remains genuinely ambiguous (section A/B); whether WeekendGuard reads as
"protection" or "a binary option" to an evaluator is a real open question,
not just a labeling choice (section B).

**Should the current contract be deployed? Not yet** — fix the one
finding in section E first; the contract itself does not need to change.

**The one recommended next step**: authenticate and add on-chain
policy-binding verification to `/api/dev/settlement-authorization`, before
building anything else on top of it.
