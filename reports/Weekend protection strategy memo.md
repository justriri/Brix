# Weekend Downside-Protection Concept — Strategy Memo (parts 5–10)

*Builds directly on [`BNB tokenized stocks hackathon research.md`](./BNB%20tokenized%20stocks%20hackathon%20research.md). That report is the factual foundation; every claim below either cites it or is explicitly marked as this memo's own judgment/design, not a new fact.*

---

## 5. Pressure-testing "the three wrappers can cross-check each other"

**The claim is conditionally true, not universally true.** The research turned up one real, sourced case where it clearly failed (SpaceX: $122–$176 per share across three venues within 10 days of IPO, a documented $76M cross-venue divergence) and one case where it held up well once normalized (Statera's finding that NVDA/SPY tracked an independent exchange mark within ~2bp after dividing out each wrapper's multiplier). So the mechanism works, but only inside a fairly narrow set of preconditions — outside them it actively produces false signals. Going through your specific stress cases:

- **All three derive price from the same underlying source.** Not confirmed either way for any pair, which is itself the finding: nobody has shown independence, and the two existing tools (Nett, Statera) both sidestep the question entirely by refusing to trust any wrapper's own oracle, instead benchmarking against an external CEX order book (Binance, OKX). That's a strong tell from people who've already tried — treat wrapper-vs-wrapper agreement as *corroborating*, never as your sole reference, until you've confirmed the oracles are actually distinct.
- **One wrapper has much lower liquidity.** This is the documented common case, not the edge case. xStocks is reported at ~0% of RWA-category TVL on DefiLlama vs. bStocks' $30B+ cumulative volume — a three-way "average" or "median" across wrappers would be dominated by noise from the thin one. Liquidity must gate participation in the reference calculation, not just get logged as a caveat.
- **Two wrappers are stale.** Plausible and not a corner case: yostocks documents catching a 21%-stale price on xStocks' METAx directly. If your gate requires "≥2 of 3 fresh" to form a reference, a systemic event (e.g., all wrappers rely on the same off-hours fallback source) could fail all three simultaneously — the gate needs a defined behavior for "0 or 1 fresh sources," not just "≥2."
- **Tokenized prices legitimately differ because of market structure.** Real and expected, not a bug: bStocks trades 24/7, xStocks separates 24/7 secondary trading from 24/5 issuer redemption, and Ondo exposes a `tradableSessions` concept — so a "spread" between wrappers over a weekend is often *structurally correct* (one is arbitraged to a live AMM price, another is anchored to Friday's last NAV) rather than a mispricing. A safety gate that flags any deviation as an error will constantly false-positive on weekends — deviation *widening specifically on weekends* should be treated as expected baseline, not anomaly.
- **The traditional market is closed.** This is the default state ~136 of every 168 hours (per OneTicker's own framing: US equities trade only ~32/168 hours a week). No wrapper exposes a clean on-chain "market open" boolean; all downstream tools compute it from a self-built calendar. Design for "closed" as the normal case, not the exception.
- **The stock itself has halted trading** (circuit breaker, regulatory halt, delisting). No wrapper's documentation describes how it would behave in this scenario, and none was found to expose a halt flag distinct from ordinary "market closed." This is a genuine blind spot in all three wrappers, not just in your design — assume you cannot detect a halt directly and must infer it from anomalous *combined* signals (reference feed frozen well past expected reopen + no wrapper DEX activity).
- **One wrapper trades while another is paused.** xStocks is the only wrapper with a *documented* issuer-level pause ("Pausable Config"); bStocks and Ondo have no confirmed pause mechanism either way (an unresolved gap, not a confirmed absence). Practically: build the gate to treat "cannot confirm this wrapper is unpaused" the same as "paused" — absence of evidence is not evidence of liveness for a financial trigger.
- **No trustworthy fallback exists.** This is the failure mode the design must be honest about. If the reference oracle is stale, all three wrappers disagree, and liquidity is thin everywhere, there is no valid price to trigger a payout against — the only safe behavior is to **refuse to resolve** (hold state, extend the check window, or void the policy under a pre-disclosed force-majeure clause) rather than resolve on a guess. This must be a designed, documented state, not an unhandled edge case.

**Bottom line:** cross-checking is a legitimate *filter* (reject a price nothing else corroborates) but not a legitimate *price source* — you still need one independent, named reference (Chainlink or Pyth's equity feed) as the actual number a payout is computed against, with the wrappers' mutual agreement used only to gate whether you trust that reference and whether the wrapper itself is even tradable.

---

## 6. Safety Gate design (conceptual — no code, no LLM in the payout path)

Note up front: OneTicker has already built a deterministic GO/CAUTION/BLOCK gate with a 60-second freshness cutoff, a $25 trade cap, and SHA-256'd verdict replay ([`BNB tokenized stocks hackathon research.md`](./BNB%20tokenized%20stocks%20hackathon%20research.md)). The pattern below is a standard, non-proprietary engineering approach to this class of problem (deterministic risk gating ahead of a financial action) — but the specific thresholds and structure should be independently derived and clearly differentiated from OneTicker's, both for originality scoring and to avoid the license/plagiarism exposure flagged in the research report, since it is unlicensed public code from a direct competitor in the same event.

**Hard requirements (must-pass, deterministic, binary — any one failing blocks the action, full stop):**
- **Freshness check** — reference oracle's `updatedAt`/`publishTime` within an allowed staleness window *given current market status* (e.g., "must have updated within the last live trading session," not "within the last N seconds," since weekends are expected staleness).
- **Wrapper health check** — the wrapper contract must not be paused/frozen where a pause flag is checkable; where it isn't checkable (bStocks, Ondo today), fall back to "has this wrapper produced an on-chain swap in the trailing window" as a liveness proxy.
- **Liquidity check** — DEX pool depth for the wrapper above an absolute floor (not a relative one), sized so that the *maximum policy payout* could plausibly be settled without moving price by more than the spread check allows.
- **Market-status check** — is the underlying market in the state the policy logic expects (closed-for-weekend at issuance, open-at-resolution)? A mismatch here means the whole premise of "weekend protection" doesn't apply to this instant and the action should be refused, not adjusted.

**Soft signals (inform confidence/sizing, don't unilaterally block):**
- **Spread check** — bid/ask or quoted-vs-mid spread on the wrapper's DEX pool; wide spread lowers confidence in that wrapper's price without necessarily blocking, since it may just reflect normal thin off-hours liquidity rather than danger.
- **Reference-deviation check** — how far the wrapper's own AMM price sits from the independent reference; used to flag "wrapper looks mispriced" for monitoring/alerting, not as a payout trigger by itself (the payout trigger should be computed from the independent reference, per §5).
- **Cross-wrapper agreement** — if multiple wrappers of the same stock exist and are individually healthy, their mutual agreement raises confidence; disagreement lowers it but, per §5, should not be read as "the reference must be wrong."

**Why hard vs. soft, and why no LLM decides payout validity:** the hard checks are the ones where a false negative (letting a bad state through) directly creates unbounded or mispriced financial liability — those must be simple, auditable, and boringly deterministic (a human or auditor should be able to re-derive the same verdict from the same inputs by hand). The soft checks are about *confidence and pricing*, where a wrong call costs you conservatism or a slightly worse quote, not solvency. An LLM/agent's proper role is orchestration and communication — deciding *when* to check, explaining a CAUTION/BLOCK to the user, negotiating gas/timing — never evaluating whether the hard gate's own boolean conditions were satisfied. That evaluation should be pure, testable, versioned logic, ideally with every verdict's inputs hashed for replayability (a technique already validated by OneTicker's `routeId` approach, worth reproducing conceptually as your own implementation).

---

## 7. Protection mechanism design (conceptual — keep it simple)

**Policy structure:** a single-shot, non-renewable contract — pay premium *P* now, get payout *X* if trigger condition *T* is true at a fixed resolution time *R*, else nothing. No secondary market, no partial exercise, no adjustable terms mid-policy. This is closer to a binary weekend weather bet than an insurance company, deliberately.

- **Coverage amount:** fixed, small, denominated in stablecoin (not in the tokenized stock itself, to avoid the payout leg reintroducing the same wrapper-price risk it's meant to protect against). Cap per-policy coverage well below the DEX liquidity floor established in the safety gate, so the reserve pool never needs to move the underlying wrapper's market to settle.
- **Threshold:** expressed as a percentage drop from the Friday reference close (e.g., "pays out if Monday's reopen reference price is ≥5% below Friday's close"), not an absolute price — this survives the actual stock's price drifting between hackathon build and demo day.
- **Premium:** fixed, quoted at policy purchase from the current reference price and a pre-set, simple pricing table (not a live actuarial/vol-surface model — that's out of scope for an MVP and arguably overengineering for a 3.5-week build). A flat or tiered premium (e.g., function of threshold tightness only) is defensible and auditable; a "fair" market-clearing premium is a v2 problem.
- **Expiry:** hard-coded to the weekend gap specifically — opens for purchase before Friday close, resolves at (or shortly after) confirmed Monday market open. This is intentionally narrower than general-purpose insurance and matches the actual, evidenced problem (the ~32/168-hour trading window) rather than inventing a broader mandate.
- **Payout formula:** binary, not proportional, for the MVP — either the fixed *X* pays in full if *T* holds at *R*, or nothing pays. A proportional formula (payout scales with how far below threshold) is a reasonable v2 refinement but adds a second axis of "what price exactly resolves the formula," which is exactly the fragile part (§5) you want to minimize in v1.
- **Reserve pool:** pre-funded before any policy is sold — total outstanding potential payout obligation must never exceed pool balance. This is what makes it "non-leveraged": the pool cannot promise more than it holds, full stop, enforced on-chain at issuance time (reject a new policy sale if it would push aggregate exposure over the pool balance).
- **Maximum exposure:** a hard contract-level cap on total outstanding payout obligation across all open policies, set conservatively below the reserve pool balance (leave a buffer — don't size exposure to exactly 100% of the pool).
- **Per-user limits:** a small fixed cap on coverage per wallet per weekend, mainly to keep the MVP's risk surface (and any single failure's blast radius) small and demonstrable, and secondarily to blunt the most obvious griefing/wash-trading vector (one actor buying maximal coverage against a position they don't actually hold).
- **Per-ticker limits:** since only one or a few tickers will realistically be supported in an MVP (§10-F), this mostly collapses into the overall exposure cap; if multiple tickers are supported, each should have its own sub-cap so one asset's crash can't exhaust the pool for the others.
- **Huge market crash (correlated payout event):** the entire design must assume this is the modal *failure* case, not a tail case — a genuine market-wide weekend gap-down would trigger many policies on the same asset simultaneously. This is exactly why the reserve-pool-never-exceeds-obligations rule (not a fractional-reserve, not an assumption of diversification across uncorrelated risks) is the only sound approach for an MVP; do not design as if payouts are independent events the way a real insurer would across many uncorrelated policyholders.
- **Reference price disappears (oracle goes dark, no fallback quorum):** per §5, define an explicit "cannot resolve" state — do not default to "no trigger, no payout" (that silently favors the pool over the user in exactly the situation where users most need protection) or to "assume worst case, always pay" (open to gaming and could bankrupt the pool on an oracle outage, not a real crash). The defensible MVP answer is a disclosed grace/extension window, and if still unresolved after that, a full premium refund rather than either extreme.
- **Market does not reopen normally (extended halt, exchange holiday you didn't account for, delisting):** same "cannot resolve → extend, then refund premium" logic applies; never let an inability to observe a price silently resolve into either "user always loses premium" or "pool always pays."
- **Tokenized wrapper is paused:** since payout is computed from the independent reference (§5), a paused *wrapper* shouldn't block resolution of the *policy* at all — pausing only matters for the separate question of whether a user can still buy/sell the underlying wrapper token itself, which is a UX/availability concern, not a payout-resolution concern. Keep those two failure domains cleanly separated in the design.

**Scope discipline:** no adjustable/renewable policies, no secondary market for policies, no partial/proportional payouts in v1, no actuarial premium curve, no multi-week or open-ended terms, no leverage anywhere in the pool. If it starts to need a risk committee, it's out of scope.

---

## 8. Is this actually useful? (checked against the hackathon's stated goal)

- **Who is the user?** Someone who already holds (or is about to buy and hold through a weekend) a tokenized stock on BSC via bStocks/Ondo/xStocks — i.e., someone with real directional exposure they can't easily exit or hedge before Friday close without giving up the position entirely.
- **What problem are they experiencing?** The weekend gap: the underlying equity market is closed ~136 of every 168 hours, so a holder has no options market, no stop-loss, and (per yostocks/OneTicker's own independent findings) often no *reliable* live price at all to even judge their risk — they're carrying uncompensated tail risk purely because of a trading-calendar artifact, not because of anything about the company.
- **Why would they pay for this?** A small fixed premium is a known, bounded cost versus an unknown, unbounded weekend-gap loss — the same logic that makes any small-premium/fixed-payout product (travel insurance, a hedge) attractive when the alternative is "do nothing and hope." It's also cheaper and faster than the realistic alternative (sell out of the position Friday and rebuy Monday), which costs spread, slippage, and — per §5 — is executed against exactly the kind of thin, possibly-stale wrapper price this product exists to be skeptical of.
- **Why does it need to be onchain?** The premium, the reserve pool, the exposure cap, and the payout condition can all be publicly verifiable in real time — a user can check *before* paying that the pool is actually solvent for their coverage amount, something a traditional over-the-counter weekend-hedge product (if one even existed) could never prove without trusting an intermediary's balance sheet.
- **Why does it need BSC specifically?** Because that's where the actual asset being protected lives — bStocks, Ondo Global Markets, and (with the caveat in the research report about its BSC status) xStocks are the real, present-day BSC-native tokenized-equity venues; there's no version of "protect my weekend-held tokenized TSLA position" that doesn't start from wherever that position actually sits on-chain.
- **Why do bStocks/Ondo/xStocks matter?** They're not incidental integrations — the entire premise (a real user with real weekend-held exposure) only exists because these protocols made tokenized, always-transferable equity exposure possible in the first place. They also directly satisfy the hackathon's "one of these three must be central" requirement, though see §9/§10-C on the unresolved definition of "central."
- **Why does an autonomous agent make sense here, rather than a plain smart contract?** The problem is inherently time- and state-driven across a period when no human is expected to be watching (a weekend) — selling policies before a moving Friday close, watching multiple data sources for the safety gate continuously, and resolving precisely at Monday's confirmed reopen (not a fixed clock time, since "market open" is itself a computed, calendar-dependent event) is a genuinely better fit for an always-on agent than for a contract that only acts when called, or a human who has to be online at a specific moment over the weekend.
- **What is the minimum useful version?** One ticker, one wrapper, one fixed threshold, one fixed coverage amount, one weekend — a user can buy exactly one kind of policy before Friday close and either gets paid a fixed amount Monday or doesn't, with the whole reserve pool, exposure cap, and resolution visible on-chain. That is a complete, demonstrable, honestly-scoped product; everything past that (multiple tickers, proportional payouts, multiple thresholds) is expansion, not the MVP.

---

## 9. How this stacks up against what actually wins BNB Chain hackathons

Pulled from recent, real results (BNB Hack: AI Trading Agents, July 2026; the September 2025 batch) rather than generic advice:

- Judges explicitly rewarded **live on-chain execution over demos** — "Neural Alpha" won the top Autonomous Trading Agents prize for onchain performance, not a pitch. The September batch's language leans the same way: past winners are cited by wallet counts, trading volume, and mainnet deployment, not concept quality ([BNB Hack AI Trading Agents coverage](https://en.cryptonomist.ch/2026/07/08/bnb-hack-winners/); [September 10 batch](https://www.bnbchain.org/en/blog/congratulations-to-the-latest-bnb-hack-winners-september-10-batch)).
- Judges rewarded **deep, specific use of the provided ecosystem tooling** — CoinMarketCap's data hub, Trust Wallet's agent kit, and BNB's native SDK each had their own "best use" recognition, mirroring this hackathon's own "Best Use of Agentic Wallet" and "Best Use of BNB Agent Studio" special prizes.
- Judges explicitly valued **modularity/reusability** ("Strategy Skills" track rewarded components *other agents* could plug into) — a signal that a narrowly self-contained product without a reusable interface may score lower on originality/technical-depth than one that exposes something composable.
- Winning teams demonstrated **real financial utility with measurable outcomes**, not just working code.

**Aggressive weaknesses against this pattern, not hedged:**
1. **"Live on-chain execution" is the hardest bar for this specific concept.** A reserve pool that actually pays out real money in a 3.5-week build, against a real weekend crash, is close to impossible to demonstrate honestly on demo day unless the team gets lucky with timing (or fakes urgency with a trivially small threshold) — the strongest recent winners showed real trading volume; this product's core "moment of truth" only occurs once every seven days and can't be manufactured for a judge on request.
2. **Direct, dated originality collision.** Two other teams (yostocks, OneTicker) are already building comparator/safety-gate infrastructure for this exact hackathon, with OneTicker explicitly citing the same ~32/168-hour weekend framing. If judges see three submissions independently converge on cross-wrapper safety checking, this project's Creativity & Originality score (25% weight) is directly exposed unless the payout mechanism, not the gate, is what's showcased.
3. **The eligibility-screening risk is existential, not a scoring deduction.** Per the research report, "spot only, perps are out" screening happens *before* the four weighted judging criteria — a strict reading that treats any contingent/triggered payout as a disqualified derivative-like structure would zero the project out regardless of how well everything else scores. This is a materially higher-stakes risk than a typical "does the idea fit the theme" concern.
4. **Reserve-pool economics undercut the "real onchain, real money" pattern judges reward.** Winners are cited by real trading volume with real capital; a pool sized safely enough to be responsible (per §7) will necessarily be small, and a small pool paired with a rare trigger event risks looking more like a toy simulation than "live" financial infrastructure by the September-batch standard of judging (wallet counts, volume, mainnet deployment).
5. **"Central" wrapper requirement is genuinely ambiguous for this shape of product** (flagged in the research report) — if the star of the demo is the payout/policy contract and the tokenized-stock wrapper is just the thing being protected rather than the thing being traded, a screener could reasonably decide the wrapper isn't "central" to the submission.
6. **Trust is hard to demonstrate in a 4-minute video.** An insurance-shaped product's core value proposition ("the pool will actually pay you") is inherently a claim about solvency and correctness under stress — exactly the kind of thing a short demo video structurally struggles to prove, versus a trading agent whose PnL is simply visible on a block explorer.

---

## 10. Final recommendation

**A. What is strong**
- The underlying problem (weekend gap risk on tokenized stocks) is not speculative — it's independently corroborated by two unrelated competing teams building for the same hackathon, which is unusually strong validation that this is a real, observed phenomenon on BSC tokenized-stock markets, not an invented narrative.
- The data-availability picture is genuinely solved: real Chainlink/Pyth equity feeds live on BSC mainnet, real BEP-20 contracts for at least bStocks and Ondo confirmed, free liquidity/historical-price APIs cover the rest — a non-mocked MVP is realistic.
- A pre-funded, capped, non-leveraged payout structure is a defensible, differentiated angle *if* the team commits to building the payout mechanism as the product, rather than re-deriving the comparator two rivals have already shipped.

**B. What is weak**
- The premise depends on a rules interpretation ("spot only") that no organizer text resolves either way.
- The comparator/safety-gate layer, if built as originally scoped, duplicates existing (unlicensed, competing) work rather than differentiating.
- A responsibly-sized reserve pool is likely too small to look like "real financial infrastructure" by this hackathon's own demonstrated judging pattern (traction, volume, live execution).
- Several load-bearing facts (xStocks' actual live status on BSC, whether any wrapper's pause mechanism exists in verified contract code, whether Chainlink/Pyth BSC feeds are truly independent of wrapper-internal pricing) are unverified, not just unfavorable.

**C. What could get us disqualified**
- A strict eligibility-screening reading of "spot only" against a contingent/triggered payout, applied *before* scoring — the single highest-stakes risk identified.
- Building "central" reliance on xStocks-on-BSC if it turns out not to be a live, current production deployment there.
- Missing or perfunctory Developer Experience Report — explicitly called out by organizers as unacceptable and worth 25% of the score on its own.
- Deploying only to testnet, or a demo that never touches BSC mainnet with real (even if small) amounts.

**D. What technical assumptions need verification before building**
- Whether xStocks is currently live and has real BEP-20 contracts on BSC mainnet (conflicting evidence in the research report).
- Whether Chainlink's/Pyth's BSC equity feeds are independent of, or internally reused by, bStocks/Ondo/xStocks' own pricing — this determines whether "cross-checking against the oracle" is a real independence check or circular.
- Whether bStocks and Ondo have any pause/freeze mechanism at the contract level (currently an open gap, not a confirmed absence, in both directions).
- The exact, current, byte-for-byte contract addresses and oracle feed addresses you intend to hard-code (several in the research report came from search summaries or blocked fetches, not direct verification).

**E. What we need to know or decide before building**
- An organizer ruling (or, failing that, a documented, defensible internal interpretation) on whether a fixed-term, pre-funded, non-leveraged contingent payout satisfies "spot only" and what "central" means for the required protocol.
- Which single ticker and single wrapper you will build against, with its contract address and oracle feed independently confirmed by your own team (not taken on faith from this research).
- How much real capital the team is actually willing and able to put at risk in the demo pool, since that number drives every exposure/coverage limit in §7.

**F. What the MVP should contain**
- One ticker, one wrapper, one fixed weekend policy (fixed premium, fixed threshold, fixed payout, hard-capped pre-funded pool), the deterministic safety gate from §6 gating both policy sale and resolution, an agent (ideally via BNB Agent Studio / Agentic Wallet, for the special-prize eligibility) that autonomously times the Friday sale window and the Monday resolution, and a demo that executes on BSC mainnet with small real amounts — plus a substantive, specific Developer Experience Report written iteratively during the build, not bolted on at the end.

**G. What we should NOT build**
- A general cross-wrapper price comparator/routing layer as the main deliverable — that ground is already occupied by yostocks and OneTicker.
- Any proportional/actuarial payout curve, multi-week or renewable policies, a secondary market for policies, multi-asset diversification logic, or anything that starts to resemble "a small insurance company" rather than a single fixed-term contract.
- Any LLM in the actual payout-decision path — the agent should orchestrate and communicate, never adjudicate whether the hard safety-gate conditions were met.
- Reliance on a wrapper (xStocks-on-BSC in particular) whose live status you have not personally, directly confirmed.

**H. The clearest one-sentence description**
An autonomous BNB agent that sells a small, fully pre-funded, fixed-price weekend crash-protection policy on a single tokenized stock, then independently watches the market itself and pays out automatically — with no human, no leverage, and no LLM involved in deciding whether the payout is owed.

**I. Proposed architecture**
1. **Reserve/Policy Vault contract** (BSC mainnet): holds pre-funded stablecoin reserve, tracks outstanding exposure vs. hard cap, sells fixed-term policies (premium in, terms fixed), executes binary payout on a resolved trigger, refunds premium on a "cannot resolve" state.
2. **Deterministic Safety Gate module** (off-chain, called by the agent, with critical checks re-verified on-chain at contract-call time where feasible): reads the independent oracle (Chainlink/Pyth), reads wrapper DEX liquidity (DexScreener/PancakeSwap), computes market-open/closed from a self-built NYSE calendar, evaluates the hard/soft checks from §6, returns a verdict + hashed inputs for replay.
3. **Orchestrating Agent** (BNB Agent Studio-hosted, ERC-8004 identity, Agentic Wallet/Wallet Skills for user-facing purchase/claim flows): times the Friday pre-close sale window, monitors continuously over the weekend, computes and submits the Monday resolution call, and produces user-facing status/explanations (never overriding the gate's verdict).
4. **User-facing surface**: a minimal interface (chat/agent-skill or simple web front end) to buy a policy and view live pool solvency/exposure and policy status — a public, checkable "is this pool actually solvent for my coverage" view is itself part of the product's core trust proposition (§8).

**J. Recommended build order**
1. Get (or make a documented, defensible internal decision about) the spot-only/"central" ambiguity before writing contract code — this gates everything downstream.
2. Independently confirm your one chosen ticker + wrapper's live contract address and oracle feed address; do not proceed on unverified addresses from any secondary source, including this research.
3. Build and unit-test the deterministic Safety Gate in isolation first — it's valuable and demoable even if the go/no-go on the protection concept later changes, and it's the piece most exposed to competitor overlap, so get your own independent version working early.
4. Build the minimal Policy Vault contract with hard exposure caps and the refund/cannot-resolve state machine from §7; test the full sell → monitor → resolve → payout/refund cycle on testnet with simulated Friday/Monday timing before touching mainnet.
5. Wire the orchestrating agent through Agent Studio/Agentic Wallet, aiming explicitly at the two $2,000 special-prize criteria alongside the main track.
6. Deploy to BSC mainnet with a small, real, pre-funded pool; run at least one real weekend cycle before the submission deadline if the timeline allows, so the demo shows an actual resolved policy, not just a simulated one.
7. Write the Developer Experience Report continuously through steps 1–6, not after — it's 25% of the score and organizers explicitly reject anything that reads as an afterthought.
