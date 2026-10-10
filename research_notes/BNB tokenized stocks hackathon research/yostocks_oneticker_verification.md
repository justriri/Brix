# yostocks and OneTicker Verification

**Headline finding: BOTH projects are CONFIRMED REAL.** They are two separate, currently-active GitHub repositories, built by two different individuals/teams, both submitted (or being prepared for submission) to the **same hackathon**: "BNB Hack: Tokenized Stocks Edition," with a stated submission deadline of October 11, 2026. As of this research (September 29, 2026), neither project has a published npm/PyPI package, neither has any GitHub stars, and **neither repository carries a LICENSE file** (see originality/reuse section — this has direct legal implications for a hackathon submission).

This is an important flag for the requester: these are not established, battle-tested open-source projects — they are two other teams' in-progress hackathon entries for what appears to be the *same competition* the user is researching for. Treat any reuse of their code or claims as a live IP/plagiarism risk, not as "borrowing from a mature open-source library."

---

## Key Question 1: Is "yostocks" a real, findable project?

### Takeaway
Yes — CONFIRMED REAL. `yostocks` is a GitHub repository at **https://github.com/yostocks-protocol/yostocks**, a Telegram-agent/CLI tool that compares tokenized-stock quotes across three BSC issuers (Ondo, xStocks, bStocks) before executing a trade, built explicitly for "BNB Hack: Tokenized Stocks." It has no published npm package, no stars, and no explicit license.

### Cited Findings
- Repository exists at `github.com/yostocks-protocol/yostocks`, owner org "yostocks-protocol." — [GitHub repo](https://github.com/yostocks-protocol/yostocks)
- GitHub description: "Telegram agent for tokenized US stocks on BNB Chain that refuses to trade a bad quote. BNB Hack: Tokenized Stocks." — [GitHub API](https://api.github.com/repos/yostocks-protocol/yostocks)
- Repo metadata (via GitHub API): created September 24, 2026; last commit (pushed_at) September 27, 2026; 0 stars; 0 forks; 23 open issues; 0 open PRs merged into main visible; no license field set; default branch `main`; ~204 commits on main. — [GitHub API](https://api.github.com/repos/yostocks-protocol/yostocks)
- Root of repo contains: `.dockerignore`, `.env.example`, `Dockerfile`, `DX_LOG.md`, `README.md`, `package.json`, `package-lock.json`, `skills-lock.json`, plus directories `apps/`, `docs/`, `probe/`. No `LICENSE` file present. — [GitHub repo contents](https://github.com/yostocks-protocol/yostocks)
- Landing site referenced in docs: `yostocks.xyz`. — [PR #39 "docs: link yostocks.xyz"](https://github.com/yostocks-protocol/yostocks/pull/39)
- Primary contributor visible in PR history is GitHub user "FjrREPO" (e.g., PR #38 landing page, PR #33 "README for judges," PR #7/#8 core quote/buy logic). — [PR #33](https://github.com/yostocks-protocol/yostocks/pull/33), [PR #7](https://github.com/yostocks-protocol/yostocks/pull/7), [PR #8](https://github.com/yostocks-protocol/yostocks/pull/8)
- No listing found on npmjs.com or pypi.org under the name "yostocks"; it is described only as a CLI (`yo`) run from source, requiring Node ≥ 22 and a "Binance Agentic Wallet CLI." — [WebSearch: yostocks npm package](https://github.com/yostocks-protocol/yostocks)

### Inferences
- The "23 open issues / 0 merged PRs" pattern alongside ~204 commits and a 3-day-old repo (created Sept 24, last push Sept 27) is consistent with a fast-moving hackathon sprint, not a mature/maintained open-source project.
- Absence of a LICENSE file means the code is, by default, "all rights reserved" under copyright law — no implicit permission to copy, fork-and-resubmit, or reuse substantial code exists.

### Gaps
- Could not confirm an exact current star/fork count beyond the snapshot pulled (0/0); this could change before the hackathon deadline.
- Could not verify whether `yostocks.xyz` is live/functional (not fetched directly in this pass).
- Full commit-by-commit history and full test suite contents were not exhaustively reviewed (see Key Question 4).

---

## Key Question 2: Is "OneTicker" a real, findable project related to tokenized stocks? (with disambiguation)

### Takeaway
Yes — CONFIRMED REAL, but the name is highly generic and produced multiple unrelated false positives that must be kept separate. The tokenized-stocks-relevant "OneTicker" is **https://github.com/JemIIahh/oneticker**, "Routing and safety layer for tokenized stocks on BNB Chain (bStocks, Ondo, xStocks)," also built for "BNB Hack: Tokenized Stocks Edition."

### Cited Findings
- Repository exists at `github.com/JemIIahh/oneticker`. Description: "Routing and safety layer for tokenized stocks on BNB Chain (bStocks, Ondo, xStocks). BNB Hack: Tokenized Stocks Edition." — [GitHub repo](https://github.com/JemIIahh/oneticker)
- Repo metadata (GitHub API): created September 21, 2026; last commit (pushed_at) September 23, 2026; 0 stars; 1 fork; 0 open issues; no license field; default branch `main`; ~41 commits; TypeScript monorepo (pnpm workspaces). — [GitHub API](https://api.github.com/repos/JemIIahh/oneticker)
- Root of repo contains: `CLAUDE.md`, `HANDOFF.md`, `PLAN.md`, `SPEC.md`, `README.md`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, plus directories `apps/`, `docs/`, `dx/`, `fixtures/`, `packages/`, `scripts/`, `skills/`. No `LICENSE` file present. — [GitHub repo contents](https://github.com/JemIIahh/oneticker)
- Explicit statement of hackathon target: "Submission for 'BNB Hack: Tokenized Stocks Edition' with target date October 11, 2026," core library and MCP server "operational in preview mode," funded mainnet trades and Agent Studio deployment "pending." — [README via WebFetch](https://github.com/JemIIahh/oneticker)
- Disclaimer in README: "Tokenized stocks are not available to US persons or residents of several other jurisdictions. OneTicker is research software, not investment advice." — [README via WebFetch](https://github.com/JemIIahh/oneticker)
- Installable as an MCP server (`claude mcp add`) or run locally via `pnpm i && pnpm -r build`; no npm/PyPI package published under "oneticker" or "OneTicker." — [WebSearch results](https://github.com/JemIIahh/oneticker)

### False positives / name collisions (explicitly NOT the same project)
- **`github.com/nek7u/OneTicker`** — a Rainmeter skin for Microsoft Windows (desktop widget showing date/time, weather, web feeds). Completely unrelated to tokenized stocks or finance. — [GitHub](https://github.com/nek7u/OneTicker)
- **`onetick-py` (PyPI)** and **OneTick / OneTick Cloud** (onemarketdata / KX) — a long-established, unrelated commercial tick-data analytics platform ("High-level Python API for OneTick") used in traditional market-data analytics. Name similarity ("OneTick" vs "OneTicker") but no connection to tokenized stocks, BNB Chain, or this hackathon. — [PyPI: onetick-py](https://pypi.org/project/onetick-py/), [GitHub: onemarketdata/onetick-py](https://github.com/onemarketdata/onetick-py), [OneTick Cloud](https://kx.com/products/onetick-cloud/)

### Inferences
- Given the generic name, any future search for "OneTicker" should expect continued collisions with the Rainmeter skin and the OneTick tick-data brand; the tokenized-stocks project should always be identified by its specific repo URL (`JemIIahh/oneticker`) rather than the name alone.
- Like yostocks, this is an active, unstarred, unlicensed hackathon-stage repo, not an established product or company.

### Gaps
- Could not find any DoraHacks, Devpost, or ETHGlobal gallery page for either "yostocks" or "OneTicker" — general web/GitHub search surfaced only the GitHub repos and their own docs, not a hackathon platform listing page. It's possible the hackathon ("BNB Hack: Tokenized Stocks Edition") is organized outside those three platforms, or the listing hasn't been indexed yet given the Oct 11, 2026 deadline is still ahead.
- No company/entity name or team roster beyond the GitHub username `JemIIahh` was found.

---

## Key Question 3: What do they actually do — comparison logic, liquidity determination, stale-price detection, reference-price comparison?

### Takeaway
Both projects independently address the same core problem — the same underlying stock (e.g., NVDA) trades as multiple separate tokens on BNB Chain (Ondo's "…on" tokens, xStocks' "…x" tokens, bStocks' "…B"/"…AB" tokens) with different liquidity, staleness, and pricing behavior — but they differ in framing: yostocks is a trade-execution "quote guard" (reject-and-pick-best), while OneTicker is a broader "routing and safety layer" with a formal GO/CAUTION/BLOCK gate and a longer-running off-hours data-logging component.

### Cited Findings — yostocks
- Core mechanism, quoted from README: **"Every quote → per-share price → must be within ±1% of the reference"** (the reference being the live US stock price, or Ondo's oracle price per share when US markets are closed). — [README via WebFetch](https://github.com/yostocks-protocol/yostocks)
- Three-wrapper comparison for NVIDIA specifically: **bStocks (NVDAB)** has real PancakeSwap depth (~$3.5M) and quotes 24/7 both ways; **Ondo (NVDAon)** fills near-reference via a Binance router but "refuses sells outside US market hours" even while its asset status shows `TRADING`; **xStocks (NVDAx)** "mostly has no BSC liquidity," with one documented case of a displayed price being **21% stale (METAx)**. — [README via WebFetch](https://github.com/yostocks-protocol/yostocks)
- Documented failure case (liquidity/stale-price danger): a market-order quote returned `success: true` for MSTRx while paying out "0.000000024 tokens for 100 USDT, an effective $4.16B per share" — i.e., a technically "successful" quote that was actually a near-total loss of funds, which is exactly the kind of bad fill the guard exists to catch. — [README via WebFetch](https://github.com/yostocks-protocol/yostocks)
- Liquidity is treated as binary/gating: quotes from routes "with no liquidity" are rejected outright, alongside quotes from paused assets (earnings, split, dividend events). — [WebSearch summary of README](https://github.com/yostocks-protocol/yostocks)
- After filtering, the system "picks the best one" among safe, in-tolerance quotes — i.e., liquidity/staleness/deviation act as a pass/fail gate first, then price ranks the survivors. — [README via WebFetch](https://github.com/yostocks-protocol/yostocks)

### Cited Findings — OneTicker
- Framing, quoted from README: given a ticker and amount, OneTicker "resolves every issuer's token, normalizes prices to one share, quotes every execution path, tells you which venues cannot fill and why in plain English, and runs a deterministic safety gate that returns GO, CAUTION or BLOCK with reasons." — [README via WebFetch](https://github.com/JemIIahh/oneticker)
- Price normalization: **"Dividend reinvestment and BEP-677 multipliers mean a token's price is not the price of one share"** — the system applies issuer-specific share ratios/multipliers before comparing venues, and explicitly **excludes** (rather than estimates) venues with unknown share ratios "preventing incorrect comparisons." — [README via WebFetch](https://github.com/JemIIahh/oneticker)
- Stale-price / market-hours detection: a `get_market_state` tool reports "how old the last real reference price is" and whether US equity markets are open, noting markets trade only "roughly 32 of 168 hours" per week, so "most of the week" has no fresh on-chain reference data. — [README via WebFetch](https://github.com/JemIIahh/oneticker)
- Liquidity determination: aggregates **executable quotes** (not just displayed/oracle prices) across venues via "Binance Web3 API aggregator endpoints," at three standardized trade sizes ($100 / $1,000 / $10,000), evaluated per issuer and per route — i.e., liquidity is measured empirically by how much you can actually fill at each size, not just a static TVL number. — [WebFetch summary](https://github.com/JemIIahh/oneticker)
- Safety gate logic (deterministic, not LLM-driven), from `packages/core/policy/default.json`: `execute_route` **refuses BLOCK verdicts outright**, **requires explicit user acceptance for CAUTION**, **rejects quotes older than 60 seconds**, and **enforces a per-trade cap ($25 default)**. Every verdict has a `routeId` (a SHA-256 hash of the gate inputs) enabling deterministic replay/verification of why a given verdict was reached. — [README via WebFetch](https://github.com/JemIIahh/oneticker)
- Research notes (`docs/RESEARCH.md`, `dx/LOG.md`) document observed anomalies: collateral-index values moving even outside US market hours, and geo-blocking behavior surfaced via an undocumented compliance error code ("40304"). — [WebFetch summary](https://github.com/JemIIahh/oneticker)

### Inferences
- Both projects converge on the same three real-world root causes of wrapper divergence: (1) each issuer (Ondo/xStocks/bStocks) has materially different on-chain liquidity depth, (2) "successful" quotes can still be economically catastrophic (near-zero payout) if liquidity is too thin, and (3) US market-hours closure (~32/168 hours per week) is the primary driver of stale reference prices — this convergence across two independently-built teams is itself a form of corroboration that these are genuine, observed phenomena on BNB Chain tokenized-stock markets, not fabricated hackathon claims.
- OneTicker's approach is more formally engineered (explicit deterministic policy file, hashed replayable verdicts, three-tier GO/CAUTION/BLOCK) while yostocks' approach is simpler (single ±1% tolerance threshold plus binary liquidity/pause checks) — a report writer should not treat these as equivalent in rigor, only in problem scope.

### Gaps
- Neither project's actual source code for the comparison/gate logic (e.g., the literal TypeScript/JS implementing the ±1% check or the `policy/default.json` rules) was read directly file-by-file in this pass — findings above are drawn from README/doc text as summarized by fetch tools, not from inspecting raw source line-by-line. A report writer needing exact code snippets (not paraphrase) should have someone fetch the raw file contents directly (e.g., `raw.githubusercontent.com/.../packages/core/policy/default.json`).
- Could not verify with certainty whether "xStocks mostly has no BSC liquidity" and the "21% stale METAx" and "$4.16B per share" figures are yostocks' own live-observed measurements versus illustrative/documentation examples — the README presents them as documented findings, but no independent third-party corroboration (e.g., a block explorer transaction hash) was located in this pass.

---

## Key Question 4: Is there a real test suite / benchmark data / published analysis of wrapper differences?

### Takeaway
Yes for both, though yostocks' claim is more quantified (117 offline tests) while OneTicker's is more about longitudinal data collection (an ongoing 5-minute-interval price-logging dataset) than unit testing.

### Cited Findings
- yostocks: **"117 offline unit/regression/integration tests,"** plus a "live test suite" covering the RWA API, OpenAI parsing, and A2A interactions; regression tests specifically "replay recorded mainnet responses covering documented failures" (i.e., the near-zero-payout MSTRx-type incidents are captured as regression fixtures). A PR titled "test: unit, integration and regression suites (+ SESSION_EXPIRED …)" exists in the repo's PR history. — [WebFetch summary](https://github.com/yostocks-protocol/yostocks); [PR #18](https://github.com/yostocks-protocol/yostocks/pull/18)
- OneTicker: an **"Off-Hours Tape"** has been running "since September 22, 2026," logging "every price surface for five tokenized stocks across three issuers every five minutes" — capturing reference prices, on-chain prices, executable quotes at three sizes, oracle data, pool depths, and collateral index values. This is a real, dated, ongoing benchmark dataset rather than a synthetic example. — [WebFetch summary / README](https://github.com/JemIIahh/oneticker)
- OneTicker also logs "every Binance call... with its latency and error code" for monitoring data-source freshness/reliability. — [WebFetch summary](https://github.com/JemIIahh/oneticker)

### Inferences
- OneTicker's Off-Hours Tape (started Sept 22, 2026, per README, one week before this research date) would by now (Sept 29, 2026) contain roughly a week of 5-minute-interval data across 5 tokens/3 issuers — a genuinely useful empirical dataset for anyone studying wrapper price/liquidity divergence, if it can be obtained (e.g., via the repo's `fixtures/` or `dx/` folders) with proper attribution/permission.
- yostocks' "117 tests" and regression fixtures suggest its team has captured real problematic on-chain responses (not just designed hypothetical edge cases), which is valuable but also unlicensed material.

### Gaps
- The raw test files, the raw Off-Hours Tape dataset files, and their exact formats were not directly opened/verified in this pass (only described via summarized fetches). A follow-up direct read of `github.com/JemIIahh/oneticker/tree/main/fixtures` and `github.com/yostocks-protocol/yostocks` test directories (likely under `apps/`) would be needed before treating specific numbers as independently verified rather than "as claimed by the project's own README."
- No independent, third-party (non-project) published analysis of tokenized-stock wrapper divergence was found in general web search results in this pass — both bodies of evidence are self-reported by the project authors.

---

## Key Question 5: What could legitimately be reused vs. what must be original, for a hackathon submission?

### Takeaway
Because **neither repository has a LICENSE file**, both are "all rights reserved" by default under copyright law — meaning no code, text, or substantial structure from either may legally be copied, forked-and-resubmitted, or reused in another hackathon submission without the authors' explicit permission, regardless of how good the ideas are. The *problem framing and publicly-observable facts* (e.g., "NVDA trades as NVDAon/NVDAx/NVDAB," "US markets are open ~32/168 hours/week," "tokenized-stock liquidity varies by issuer") are not copyrightable and may be independently stated, but the specific prose, code, policy files, test fixtures, and data need to be independently (re)built.

### Cited Findings
- Neither `github.com/yostocks-protocol/yostocks` nor `github.com/JemIIahh/oneticker` has a LICENSE file in its repo root, and neither repo's GitHub API `license` field is populated. — [GitHub API: yostocks](https://api.github.com/repos/yostocks-protocol/yostocks), [GitHub API: oneticker](https://api.github.com/repos/JemIIahh/oneticker)
- GitHub's own documentation is unambiguous on this point (general web knowledge, not from this project's docs): a public repository without a license file means the default is full copyright reservation by the author — others may view and fork on GitHub, but have no legal right to use, modify, or distribute the code beyond that, absent separate permission.
- Both repos explicitly identify themselves as submissions to "BNB Hack: Tokenized Stocks Edition," the same hackathon name referenced in this research request's context (folder name "BNB tokenized stocks hackathon research") — meaning these are most plausibly **competing entries in the same competition** the user is preparing for. — [yostocks GitHub description](https://github.com/yostocks-protocol/yostocks), [OneTicker GitHub description](https://github.com/JemIIahh/oneticker)

### Inferences
- **What can legitimately be reused (as general, non-copyrightable facts/ideas, independently re-expressed):** the *problem statement itself* — that a single underlying stock (e.g., NVDA, MSTR, META) exists as multiple separately-issued BSC tokens (Ondo/xStocks/bStocks-style) with independently varying liquidity and staleness; that US equity markets are open only ~32 of 168 hours/week, creating stale-price windows off-hours; that a "success: true" DEX quote can still represent a near-total-loss fill when liquidity is too thin. These are observable market facts, not original expression, and a hackathon team could legitimately re-derive and re-state them from their own on-chain research (e.g., by querying the same DEXes/aggregators themselves) without copying either repo.
- **What would need to be built as original work:** the actual comparison/normalization code (per-share price conversion, dividend/split multiplier handling), any specific tolerance thresholds or gate policy logic (e.g., a project should not literally copy `packages/core/policy/default.json`'s specific rules/JSON structure, or yostocks' "±1%" threshold implementation verbatim), the specific prose/README wording, any specific test fixtures or regression data, and specifically OneTicker's GO/CAUTION/BLOCK naming/hash-replay (`routeId` = SHA-256 of gate inputs) mechanism if copied structurally, not just conceptually.
- Given that both are apparent rival submissions to the *same* hackathon, using their code or even closely paraphrasing their README framing/wording carries not just a copyright/license risk but a direct plagiarism-against-a-competitor risk that hackathon judges could easily detect (both repos are public and discoverable via the same searches performed here).
- Recommended safe path: treat this research as confirming the *problem is real and worth solving* (validated independently by two teams), then design and implement one's own data-fetching, normalization, liquidity-scoring, and staleness-detection logic from scratch, sourced directly from the relevant chains/APIs (PancakeSwap, Ondo, xStocks, bStocks, Binance Web3 API, etc.) rather than from either repo's code.

### Gaps
- No explicit statement from either project's authors (in README or elsewhere found) addressing reuse/licensing intent going forward — it's possible a license could be added before the Oct 11, 2026 deadline; this should be re-checked closer to that date if reuse is being considered.
- Could not determine whether either team has any relationship with the hackathon organizers that might affect how "originality" is judged (e.g., whether convergent problem-framing across submissions is expected/acceptable in this specific hackathon's rules).

---

## Key Question 6: If not found — explicit statement

### Takeaway
Not applicable in the negative sense: **both "yostocks" and "OneTicker" WERE found and confirmed as real, specific, linkable GitHub repositories** matching the description (comparing tokenized-stock wrappers of the same underlying stock, liquidity determination, stale-price detection, reference-price comparison). This section documents the searches performed to rule out "not found," and flags the one important disambiguation caveat.

### Cited Findings
- Searches performed and their outcomes: `site:github.com`-style and plain-text GitHub searches for "yostocks" → resolved directly to `github.com/yostocks-protocol/yostocks` with multiple corroborating PR/issue pages. — [GitHub search results]
- Searches for "OneTicker" + "tokenized stocks" / "hackathon" → resolved directly to `github.com/JemIIahh/oneticker`, with the *only* competing hits being clearly unrelated (Rainmeter skin `nek7u/OneTicker`; `onetick-py`/OneTick Cloud tick-data platform). No DoraHacks, Devpost, or ETHGlobal gallery page was found for either name in this pass (see Gaps under Key Question 2). — [WebSearch results]
- No npm package named "yostocks" or "oneticker"/"OneTicker" was found on npmjs.com; no PyPI package matching either name related to tokenized stocks was found on pypi.org (the only PyPI hits for "oneticker"-like terms were the unrelated `onetick-py`). — [WebSearch results]

### Inferences
- Since both names are confirmed real and specific (unlike a typical "could not find" outcome), the primary caveat for the report writer is not existence but **maturity and legal status**: these are days-old, zero-star, unlicensed hackathon-in-progress repositories, not established/vetted open-source projects or companies — any claims from their own docs (price-discrepancy figures, staleness percentages) should be attributed as "self-reported by the project" rather than independently audited fact.

### Gaps
- None beyond those already listed above (hackathon-gallery listing not found; raw source/data not directly line-by-line verified).

---

## Source List (all URLs cited above)
- https://github.com/yostocks-protocol/yostocks
- https://api.github.com/repos/yostocks-protocol/yostocks
- https://github.com/yostocks-protocol/yostocks/pull/7
- https://github.com/yostocks-protocol/yostocks/pull/8
- https://github.com/yostocks-protocol/yostocks/pull/18
- https://github.com/yostocks-protocol/yostocks/pull/33
- https://github.com/yostocks-protocol/yostocks/pull/38
- https://github.com/yostocks-protocol/yostocks/pull/39
- https://github.com/JemIIahh/oneticker
- https://api.github.com/repos/JemIIahh/oneticker
- https://github.com/nek7u/OneTicker
- https://pypi.org/project/onetick-py/
- https://github.com/onemarketdata/onetick-py
- https://kx.com/products/onetick-cloud/
