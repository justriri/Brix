# bStocks (Tokenized US Equities on BNB Smart Chain)

## Disambiguation note (read first)
There is only **one** "bStocks" product found that matches the brief: the Binance-affiliated tokenized-securities product on BNB Smart Chain, issued by **BTECH Holdings Ltd**. No unrelated project using the exact name "bStocks" was found. However, two naming/verification issues surfaced during research and should be flagged to anyone building on top of this data:
- The apparent official marketing site is **`bstocks.finance`** (seen in Google/Bing search result titles as "bStocks — Tokenized Equity. Onchain. Always On." — https://www.bstocks.finance/en), but this tool's WebFetch could not resolve that domain (`getaddrinfo ENOTFOUND`) on two attempts, including with and without `www`. This could not be independently verified as reachable/content-confirmed in this research session — treat as **unconfirmed by direct fetch**, only by search snippets.
- The documentation site actually fetched successfully is **`docs.bstocker.finance`** — note the different domain spelling ("bstocker" vs "bstocks"). The site self-identifies its publisher as BTECH Holdings Ltd/Binance affiliate and looks like legitimate product documentation, but the domain mismatch relative to the primary marketing domain (`bstocks.finance`) is unusual and could not be cross-verified against an official Binance link-out in this session. One page on that docs site refers to itself in passing as "this documentation clone" when pointing readers to the prospectus for authoritative legal terms — language that reinforces treating it as a **mirror/secondary copy, not the canonical legal source**. Anyone integrating this for a financial product should independently verify `docs.bstocker.finance` is linked from Binance's own official channels before trusting it as authoritative, and should treat the official FSRA prospectus (referenced at `bstocks.finance/prospectus`) as the ground truth for legal/risk terms.

---

## What is bStocks, and who operates it?

### Takeaway
bStocks is a Binance-affiliated (not third-party/independent) tokenized-securities product: BEP-20 tokens issued by **BTECH Holdings Ltd**, an entity within the Binance corporate group, each representing 1:1 economic exposure to a real US-listed share held with a regulated custodian, admitted to an official list of securities under an FSRA-approved prospectus, and made tradable 24/7 via Binance Spot and, after withdrawal, self-custody on BNB Smart Chain.

### Cited Findings
- "bStocks are BEP-20 tokens issued by BTech Holdings Limited, a Binance group affiliate, and run on BNB Chain." — [BSCNews via WebSearch summary](https://x.com/BSCNews/article/2066893653985853917)
- "Issued by BTECH Holdings Ltd, a Binance group affiliate. The platform operates on BNB Smart Chain (BSC) for withdrawals and custody." — [bStocks Docs, "What is bStocks?"](https://docs.bstocker.finance/docs)
- bStocks holds an "FSRA-approved prospectus; admitted to the Official List of Securities," and the instruments are classified as "Certificates representing certain Financial Instruments" under FSMR regulations; listed "on Binance, described as a Recognised Investment Exchange with institutional-grade market surveillance." — [bStocks Docs, Regulation page](https://docs.bstocker.finance/docs/regulation)
- A prospectus filing exists with the Abu Dhabi Global Market (ADGM) regulator: "BTECH HOLDINGS LTD (a private company limited by...)" prospectus PDF dated around 8 September 2026, filed in ADGM's market-disclosure prospectus repository — confirming BTECH Holdings Ltd as the issuer and ADGM/FSRA as the regulatory venue. — [ADGM prospectus PDF](https://www.adgm.com/globalassets/market-disclosure/content/prospectus/btech-holdings-prospectus---8-september---salesforce-bstocks_09_08_2026_12-57-14.pdf) (Note: this PDF's text did not decode cleanly via automated fetch in this session — filename and search-result metadata confirm the issuer/date, but detailed risk-factor text inside could not be extracted; see Gaps.)
- bStocks launched publicly on **12 June 2026** with five tickers, after Binance opened zero-commission trading in 7,000+ US stocks on 1 June 2026. — [The Defiant](https://thedefiant.io/converge/tradfi-and-fintech/binance-launches-bstocks-tokenized-us-equities-24-7-onchain-trading); [Hackernoon](https://hackernoon.com/binance-opens-bstocks-collateral-to-every-eligible-user-as-tokenized-stock-volume-tops-$30-billion)
- BNB Chain's own blog describes bStocks as part of a broader "BNB Street" tokenized-equity ecosystem (which also includes third-party issuers Ondo Global Markets and xStocks/Backed Finance on other or the same chain) — bStocks is explicitly one issuer among several, not the only tokenized-stock scheme on BNB Chain. — [BNB Chain blog, "BNB Street is Open 24/7"](https://www.bnbchain.org/en/blog/bnb-street-is-open-24-7-access-709-tokenized-stocks-of-the-worlds-largest-companies-on-bnb-chain)
- "A bStock gives you price exposure and dividends, not direct ownership, with no voting rights and no other shareholder perks." — [BSCNews via WebSearch summary](https://x.com/BSCNews/article/2066893653985853917)

### Inferences
- Because BTECH Holdings Ltd is a Binance group affiliate operating under an ADGM/FSRA prospectus, bStocks is best characterized as a **regulated-wrapper, centrally-issued product**, not a decentralized/permissionless protocol — closer in structure to an ETN/certificate than to a DeFi-native synthetic-asset protocol (e.g., Synthetix-style).
- The existence of competing issuers on the same "BNB Street" umbrella (Ondo Global Markets' SPCXon, xStocks' SPCXx, alongside bStocks' SPCXB — three different tokenized-SpaceX products) means any downstream system must key off the **specific contract address / issuer**, not just the ticker or company name, to avoid conflating products.

### Gaps
- Could not directly fetch/confirm the content of `bstocks.finance` (the primary marketing domain) due to DNS resolution failure in this tool; all findings about it are via search-engine snippets or third-party citations, not a direct read.
- Could not extract clean text from the ADGM prospectus PDF (binary/compressed content did not decode); full risk-factor and issuer-structure language from the primary legal document is not verified beyond the filename/metadata.

---

## Which specific tokenized stocks (tickers) are deployed and tradable on BSC, with contract addresses?

### Takeaway
bStocks launched with 5 tickers on 12 June 2026 and has expanded to roughly 60–70+ tickers by September 2026 (exact current total not found in a single authoritative live list); confirmed BscScan contract addresses were found for at least TSLAB, NVDAB, and SPCXB.

### Cited Findings
- Launch-day tickers (12 June 2026): **NVDAB** (NVIDIA), **TSLAB** (Tesla), **CRCLB** (Circle Internet Group), **MUB** (Micron Technology), **SNDKB** (SanDisk) — traded as NVDAB/USDT, TSLAB/USDT, CRCLB/USDT, MUB/USDT, SNDKB/USDT. — [Hackernoon](https://hackernoon.com/binance-opens-bstocks-collateral-to-every-eligible-user-as-tokenized-stock-volume-tops-$30-billion); [Trust Wallet blog](https://trustwallet.com/blog/announcements/access-bstocks-on-trust-wallet-tokenized-shares-on-chain)
- By 2 July 2026, 15 listed securities: Circle, Micron, NVIDIA, SanDisk, Tesla, **SpaceX (SPCXB)**, AMD, iShares MSCI South Korea ETF, Intel, MicroStrategy, Lumentum, Meta, Microsoft, Palantir, Invesco QQQ Trust. — [BNB Chain blog, "Introducing bStocks on BNB Chain"](https://www.bnbchain.org/en/blog/introducing-bstocks-on-bnb-chain-trade-24-7-with-zero-fees-deploy-across-defi-protocols-with-full-self-custody)
- Through July 2026, more names added: Coinbase, Alphabet, Robinhood, IBM, Nokia. — [Yahoo Finance](https://finance.yahoo.com/markets/crypto/articles/binance-adds-10-more-tokenized-072709446.html)
- 29 July 2026: 10 more added — Apple (AAPL), Amazon (AMZN), Goldman Sachs, PayPal, Applied Materials, Bloom Energy, Dell, Fluence Energy, and two (unnamed in source) semiconductor ETFs. AUM exceeded $100M within 15 days of the initial launch. — [Yahoo Finance](https://finance.yahoo.com/markets/crypto/articles/binance-adds-10-more-tokenized-072709446.html)
- 5 August 2026: ASML and Netflix added. 12 August 2026: GameStop added. — [WebSearch summary citing BNB Chain blog reporting](https://www.bnbchain.org/en/blog/bnb-street-is-open-24-7-access-709-tokenized-stocks-of-the-worlds-largest-companies-on-bnb-chain)
- 26 August 2026: Tokenized Trump Media stock listed as **DJTB**, initially gated to VIP 3+ users, later used as margin/spot collateral. — [CryptoTimes](https://www.cryptotimes.io/2026/08/26/binance-lists-tokenized-trump-media-bstock-as-spot-margin-collateral/)
- 14 September 2026: CEA Industries listed as **BNCB**, enabled as collateral in Cross Margin, Portfolio Margin, Portfolio Margin Pro. 21 September 2026: Binance removed the VIP gate entirely, opening bStocks-as-collateral to all eligible users. — [CryptoDaily](https://cryptodaily.co.uk/2026/09/binance-bncb-bstocks-margin-collateral-vip-users); [Bitcoinethereumnews](https://bitcoinethereumnews.com/finance/binance-opens-bstocks-margin-collateral-to-all-eligible-users-as-cumulative-trading-volume-tops-30-billion/)
- By early September 2026, bStocks' outstanding value had "doubled...to $678 million" from mid-July, and cumulative trading volume surpassed **$30 billion** in under 90 days from launch, capturing roughly 85% of tokenized-equity DEX volume in July 2026. — [Hackernoon](https://hackernoon.com/binance-opens-bstocks-collateral-to-every-eligible-user-as-tokenized-stock-volume-tops-$30-billion)
- As of roughly late August/early September 2026, one source estimated "roughly 70 bStocks trading pairs" existed, though no single source in this research gave a complete, current, authoritative enumerated list. — [WebSearch synthesis, unable to attribute to one primary source]
- Confirmed BscScan contract addresses (BNB Smart Chain, checksummed):
  - **TSLAB** (Tesla): `0x5b1910eAaD6450E50f816082Aa078C41F10C292f` — [BscScan](https://bscscan.com/address/0x5b1910eaad6450e50f816082aa078c41f10c292f)
  - **NVDAB** (NVIDIA): `0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436` — [BscScan](https://bscscan.com/address/0x02fca66c1d1afb4e2a7884261eb00f63598a7436)
  - **SPCXB** (SpaceX): `0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1` (per CoinGecko; not independently re-verified on BscScan in this session — length/format should be double-checked before production use, as it is one character longer than a standard 20-byte/42-char address as transcribed) — [CoinGecko](https://www.coingecko.com/en/coins/spacex-bstocks-tokenized-stock)
  - **CRCLB** (Circle): truncated address `0x80f3...ffc0` seen on Trust Wallet's blog (full address not resolved in this session) — [Trust Wallet blog](https://trustwallet.com/blog/announcements/access-bstocks-on-trust-wallet-tokenized-shares-on-chain)
  - **MUB** (Micron): truncated address `0xcdf2...2699` — [Trust Wallet blog](https://trustwallet.com/blog/announcements/access-bstocks-on-trust-wallet-tokenized-shares-on-chain)
  - **SNDKB** (SanDisk): truncated address `0x3ee4...50fb` — [Trust Wallet blog](https://trustwallet.com/blog/announcements/access-bstocks-on-trust-wallet-tokenized-shares-on-chain)
- BscScan search surfaced additional unlabeled addresses associated with "bStocks" branding that were not individually identified by ticker in this session (e.g., `0x9008d19f...`, `0x90cbe4bd...`, `0x0faeb60e...`, `0xb4f34d09...`, `0xc7f501d2...`, `0x055a3b37...`) — worth follow-up verification. — [BscScan search results, WebSearch](https://bscscan.com/address/0x5b1910eaad6450e50f816082aa078c41f10c292f)

### Inferences
- The full current roster (as of September 2026) is likely 60–70+ tickers given the steady cadence of additions (roughly weekly/biweekly since June), but exact enumeration requires a live pull from Binance's own bStocks listing page or BscScan's token-list for the issuer contract factory — neither was directly accessible in this session.
- Given that CRCLB/MUB/SNDKB/CRCLB addresses were only found truncated, a production financial system should re-derive full addresses directly from BscScan's verified-contract search or Binance's official docs rather than relying on the partial strings found here.

### Gaps
- No single authoritative, complete, current (September 2026) list of all bStocks tickers with full contract addresses was found in this session. Binance's own live bStocks listing page and a BscScan "token list by issuer" query would be needed to compile a definitive, current roster — not accessed here.
- Full (untruncated) contract addresses for CRCLB, MUB, and SNDKB were not confirmed.
- The SPCXB address from CoinGecko has an unusual character count and should be re-verified directly on BscScan before use.

---

## What token/contract standard do bStocks tokens use?

### Takeaway
bStocks tokens are standard **BEP-20** tokens on BNB Smart Chain (BSC's ERC-20-equivalent standard), each centrally issued by BTECH Holdings Ltd and backed off-chain 1:1 by real shares at a custodian — i.e., a **custodial, wrapped-certificate structure**, not an on-chain-collateralized synthetic asset (no CDP/vault mechanism was found; backing is off-chain custody, verified via a daily attestation process).

### Cited Findings
- "packaged as a standard BEP-20 token that trades 24/7 from your self-custody wallet" — [WebSearch synthesis of multiple sources, e.g. Trust Wallet blog](https://trustwallet.com/blog/announcements/access-bstocks-on-trust-wallet-tokenized-shares-on-chain)
- Trust Wallet's blog describes the token standard as "BEP-20 with ERC-8056 support" (an additional/extended standard reference alongside BEP-20; ERC-8056 could not be independently identified/verified as an established EIP in this session — flagged as unverified). — [Trust Wallet blog](https://trustwallet.com/blog/announcements/access-bstocks-on-trust-wallet-tokenized-shares-on-chain)
- "Fully backed by equivalent underlying equity with 1:1 conversion capability to shares... Zero fees for commission, custody, management, and conversion." — [bStocks Docs](https://docs.bstocker.finance/docs)
- Custody structure described as "a ring-fenced SPV structure that is bankruptcy-remote," with custodian holdings at "a regulated US broker-custodian," reconciled against circulating token supply daily. — [bStocks Docs, Proof of Collateral page](https://docs.bstocker.finance/docs/proof-of-collateral)
- One search-summarized source (BSCNews via WebSearch) specifically named the custodian: "Alpaca acts as custodian of the underlying in the Issuer's Segregated Custody Account" — this specific claim comes from an AI-generated search summary, not a directly fetched primary page, so treat as **lower-confidence / unverified** pending direct confirmation from the prospectus or docs site. — [BSCNews article, via WebSearch summary](https://x.com/BSCNews/article/2066893653985853917)
- Dividends are "automatically reinvested through [a] rebase mechanism after tax withholding" — implying the BEP-20 tokens are **rebasing tokens**, not fixed-supply, which is an important technical detail for any integration expecting standard ERC-20/BEP-20 balance immutability between transfers. — [bStocks Docs, FAQ](https://docs.bstocker.finance/docs/faq)

### Inferences
- The rebase-on-dividend mechanic means balance-tracking systems (e.g., a price/holdings cross-checker) must account for supply-changing events tied to corporate actions (dividends), not just price changes — a naive ERC-20 `balanceOf` polling approach could misattribute rebase-driven balance changes as trading activity.
- The "custodial, off-chain-collateralized" structure (real share at custodian, attested daily) contrasts with fully on-chain-collateralized DeFi synthetics — meaning trust in the peg/backing depends on custodian solvency and the honesty/accuracy of the attestation process, not solely on-chain proofs.

### Gaps
- The named custodian ("Alpaca") is not independently confirmed from a primary document read directly in this session — only from an AI search-summary of a secondary article. This should be verified directly against the ADGM prospectus or an official Binance/bStocks statement before being treated as fact.
- "ERC-8056" could not be verified as a real, adopted Ethereum/BSC token standard in this session; it may be a typo, a proposal number, or specific to this integration — flagged as unconfirmed rather than asserted.
- No contract source code / ABI was directly reviewed in this session (BscScan page fetch returned HTTP 403), so claims about pausability, mint/burn permissions, and rebase implementation are inferred from marketing/docs copy, not verified against actual verified contract code.

---

## How are bStocks prices sourced/fed on-chain? Oracle details and provider

### Takeaway
No official bStocks documentation found in this session names a specific on-chain oracle provider (no confirmed Chainlink, Pyth, or named custom oracle); the clearest technical evidence found — a third-party developer bug report — indicates bStocks price data reaches DeFi routing/aggregator infrastructure through what looks like a Binance-operated, unverified price-feed contract accessed via a DEX-aggregator route, with an apparent price-staleness guard causing intermittent transaction failures.

### Cited Findings
- Official docs and blog content describe daily "Proof of Collateral" reconciliation (backing verification) but **do not describe a specific on-chain price oracle mechanism** for bStocks' trading price on DEXes; the Integration docs page explicitly states oracle contract addresses and price-query mechanisms are "not specified" in the documentation available. — [bStocks Docs, Integration page](https://docs.bstocker.finance/docs/integration); [bStocks Docs, Proof of Collateral page](https://docs.bstocker.finance/docs/proof-of-collateral)
- A GitHub issue from an unrelated third-party project (Ottopus, a DeFi routing/aggregation tool) reports bug reports where "Oracle-priced bStocks routes revert on the review page" for TSLAB and NVDAB purchases: the swap route selected as "isBest" is served through what the issue calls the "Metric" route/aggregator, hitting a contract at `0xe10113d50d0370d60fa52d3403c6820a7501f3bc` (unverified source code on BscScan per the issue) via a "LiquidMesh" router (`0xb444…dda5`), calling a function `getBidAndAskPrice()` (selector `0xc1701b67`), and intermittently reverting with a Uniswap v4 `WrappedError`, suspected to be caused by a price-staleness guard. — [GitHub, ottopusxyz/ottopus issue #65](https://github.com/ottopusxyz/ottopus/issues/65)
- This same issue explicitly states the underlying price-feed contract's source is **not verified on-chain**, so the exact staleness/update logic "couldn't be confirmed without access to the source code." — [GitHub, ottopusxyz/ottopus issue #65](https://github.com/ottopusxyz/ottopus/issues/65)
- General BSC context: Chainlink price feeds are live and available to any BSC smart contract in principle, but no source found in this research directly confirms bStocks uses Chainlink (or Pyth) specifically. — [BNB Chain blog, general Chainlink-on-BSC announcement, not bStocks-specific](https://www.bnbchain.org/en/blog/chainlink-oracles-now-live-on-binance-smart-chain)

### Inferences
- The available evidence suggests bStocks' on-chain trading price (e.g., on PancakeSwap pools) is primarily determined by **DEX pool AMM pricing** (arbitraged against Binance's centralized spot price for the same ticker) rather than a transparent, independently-auditable push oracle — the "oracle" referenced in the Ottopus bug report appears to be an aggregator-side routing/pricing helper contract (possibly Binance's own off-chain-to-on-chain price relay for its Web3 wallet swap feature), not a public, verifiable oracle network like Chainlink or Pyth.
- Because the referenced price-feed contract's source is unverified on BscScan (per the third-party bug report), independent verification of how/how-often bStocks on-chain prices are updated, and what staleness protections exist, **cannot currently be done by reading contract code alone** — this is a material limitation for anyone wanting to cross-check bStocks prices programmatically against a trusted, transparent on-chain source.

### Gaps
- No official, named oracle provider or on-chain price-feed contract address for bStocks was found in the official docs (`docs.bstocker.finance`) or BNB Chain / Binance blog posts reviewed. This is a significant gap: the question "who is the price provider" cannot be answered definitively from public sources found in this session.
- Could not independently verify the `0xe10113d5...` price-feed contract's owner, update frequency, or whether it's controlled by Binance, a third-party market maker, or a DEX aggregator — the source is reportedly unverified on BscScan.

---

## Is historical price data available, and how?

### Takeaway
Historical bStocks price data is available indirectly via CoinGecko's tracking page (and presumably BscScan's on-chain transaction/transfer history for each token contract and its DEX pools), but no dedicated official bStocks API or subgraph for historical prices was found.

### Cited Findings
- CoinGecko hosts a live/historical price page for at least SPCXB ("SpaceX (bStocks Tokenized Stock)"), showing current price ($149.22 at time of fetch), 24h volume ($33.8M), market cap (~$89.6M), all-time high/low, and a 7-day price range — indicating CoinGecko aggregates bStocks price/volume data, likely from the CEX (Binance, LBank, BingX) and DEX (PancakeSwap V3) markets it lists. — [CoinGecko, SPCXB page](https://www.coingecko.com/en/coins/spacex-bstocks-tokenized-stock)
- The official bStocks docs site does not mention a subgraph, historical-data API, or charting endpoint; the Integration page explicitly states historical data access methods are "not specified" in available documentation. — [bStocks Docs, Integration page](https://docs.bstocker.finance/docs/integration)
- On-chain transfer/swap history is inherently available via BscScan for any given token contract address (standard BEP-20 transparency), e.g., the TSLAB and NVDAB contract pages. — [BscScan, TSLAB](https://bscscan.com/address/0x5b1910eaad6450e50f816082aa078c41f10c292f); [BscScan, NVDAB](https://bscscan.com/address/0x02fca66c1d1afb4e2a7884261eb00f63598a7436) (Note: direct BscScan page fetch returned HTTP 403 in this session, so page content/detail could not be directly confirmed beyond the address and basic labeling surfaced via search.)

### Inferences
- For a financial product needing historical bStocks prices, the most practical near-term sources are (a) CoinGecko's API/website for tokens it tracks, and (b) direct on-chain reconstruction from PancakeSwap pool swap events via BscScan or a self-run indexer — there is no evidence of an official, purpose-built bStocks historical-price API.

### Gaps
- No official bStocks-branded historical price API, subgraph, or downloadable dataset was found.
- Could not confirm CoinGecko coverage exists for tickers beyond SPCXB (e.g., TSLAB, NVDAB, CRCLB) in this session — this would need a direct per-ticker CoinGecko lookup.
- BscScan contract pages returned HTTP 403 on direct fetch in this session, preventing direct confirmation of verified-source status, holder counts, or transfer-history depth for TSLAB/NVDAB.

---

## Is on-chain liquidity data available? Which DEXes list bStocks tokens?

### Takeaway
Yes — bStocks tokens are confirmed traded on **PancakeSwap** (V3 pools cited for SPCXB) and referenced as usable across other BNB Chain DeFi protocols (Aster, Venus, Lista DAO for lending/collateral use), and standard DEX-analytics tooling (CoinGecko, presumably DexScreener) should be able to surface pool-level TVL/volume, though direct DexScreener page fetches were blocked in this session.

### Cited Findings
- CoinGecko lists SPCXB trading venues including "PancakeSwap V3 | SPCXB/WBNB, SPCXB/BSC-USD" as DEX pairs, alongside CEX pairs on Binance, LBank, and BingX. — [CoinGecko, SPCXB page](https://www.coingecko.com/en/coins/spacex-bstocks-tokenized-stock)
- "From day one, you can put your bStocks to work across DeFi on BNB Chain: lend on Venus and Lista DAO, trade on PancakeSwap, Aster, and more." — [BNB Chain blog](https://www.bnbchain.org/en/blog/introducing-bstocks-on-bnb-chain-trade-24-7-with-zero-fees-deploy-across-defi-protocols-with-full-self-custody)
- bStocks reportedly captured "approximately 85% of tokenized-equity DEX volume" on BNB Chain in July 2026, implying most of its trading liquidity for on-chain settlement is concentrated in BNB Chain DEX pools (primarily PancakeSwap) rather than being spread across many venues. — [Hackernoon](https://hackernoon.com/binance-opens-bstocks-collateral-to-every-eligible-user-as-tokenized-stock-volume-tops-$30-billion)
- Direct attempts to fetch DexScreener pages for a bStocks token (TSLAB pool) and Binance's own site were blocked (HTTP 403 and DNS resolution failure respectively) in this session, so pool-level TVL figures could not be directly pulled here. — [WebFetch attempts, this session]

### Inferences
- TVL/liquidity querying is feasible in principle via PancakeSwap's own analytics, DexScreener, or DexTools by pool address, but this session could not directly confirm live numbers due to tool access blocks (403s) — a production integration should query these directly rather than relying on this report for current figures.

### Gaps
- No specific PancakeSwap pool contract addresses (as opposed to token addresses) were confirmed in this session.
- Could not confirm whether bStocks liquidity pools are open/permissionless (anyone can add liquidity) or exclusively seeded/managed by BTECH Holdings/Binance-affiliated market makers — this materially affects how reliable DEX-based pricing is as an independent check.

---

## Is market-open/closed status (US market hours) exposed anywhere in bStocks' system?

### Takeaway
No evidence was found of bStocks exposing on-chain or API-based "is the underlying US market open" status; the product is explicitly marketed as trading 24/7 regardless of underlying market hours, meaning market-open/closed status must be inferred externally (e.g., from standard NYSE/Nasdaq calendar logic) rather than read from bStocks itself.

### Cited Findings
- "Trading is designed to be available 24/7 on Binance Spot" — official FAQ answer to a weekend-trading question, with no mention of a market-status flag or differential behavior when underlying markets are closed. — [bStocks Docs, FAQ](https://docs.bstocker.finance/docs/faq)
- The Markets docs page states "bStocks markets focus on popular US names and related exposures" and says trading is available "around the clock," again without describing any market-status signal or on-chain flag. — [bStocks Docs, Markets page](https://docs.bstocker.finance/docs/markets)
- No official page found in this session mentions a circuit-breaker or different pricing/trading mode during traditional market closures (nights, weekends, holidays) — pricing appears to continue via DEX/CEX order flow regardless of NYSE/Nasdaq hours.

### Inferences
- Since bStocks is designed to trade continuously and no market-status flag is documented, any system needing to know "is the real underlying market open right now" must compute this itself from a standard market-calendar (NYSE/Nasdaq holiday and hours schedule), not query bStocks/BNB Chain.
- This also implies that during traditional market closures, bStocks prices are not necessarily anchored to a live reference price from the primary exchange, raising basis-risk/tracking-error considerations for cross-checking purposes (similar to weekend CFD/synthetic pricing dynamics seen in other tokenized-equity products) — though no bStocks-specific incident data on this was found (see next section).

### Gaps
- No official statement was found on exactly how bStocks/Binance prices these instruments during hours when the underlying US exchange is closed (e.g., is it Binance's own market-making model, an external index, or pure DEX/CEX order-book price discovery) — this is an important unanswered question for basis-risk assessment.

---

## Are there official public APIs for bStocks?

### Takeaway
No official public REST/GraphQL API for bStocks (prices, holdings, proof-of-collateral data, etc.) was found; official integration guidance found only tells developers to treat withdrawn bStocks as ordinary BSC tokens and to consult the Proof of Collateral page and prospectus, with no endpoint, SDK, or schema published.

### Cited Findings
- The Integration docs page's only concrete guidance is: "treat withdrawn bStocks as BSC tokens held in user wallets," directing developers to "the official Integration page" (same one fetched, offering no endpoints) and "the Prospectus." No REST/GraphQL endpoints, SDKs, or oracle contract addresses were listed. — [bStocks Docs, Integration page](https://docs.bstocker.finance/docs/integration)
- General web search for "bStocks API documentation developer docs" returned no relevant official results — all results were for an unrelated, differently-spelled "B-Stock" liquidation-auction company's Apify scraper API, confirming no dedicated bStocks developer API surfaced in a direct search. — [WebSearch results, "bStocks API documentation developer docs"]

### Inferences
- Any programmatic access to bStocks data today is limited to: (1) generic blockchain data sources (BscScan, on-chain RPC) for token balances/transfers, (2) third-party aggregators (CoinGecko) for price/volume, and (3) Binance's own exchange API for the CEX-listed spot pairs (not independently confirmed as covering bStocks tickers in this session, but plausible given they trade as normal spot pairs on Binance).

### Gaps
- Not confirmed whether Binance's mainline exchange API (api.binance.com) exposes bStocks spot pairs (e.g., TSLAB/USDT) the same way as other spot listings — this should be checked directly against Binance's API symbol list.
- No official bStocks-specific API/docs portal (e.g., a `api.bstocks.finance` or similar) was found or referenced anywhere in this research.

---

## Are there documented pause/freeze/circuit-breaker mechanisms?

### Takeaway
No official bStocks documentation found in this session explicitly describes pause, freeze, blacklist, or circuit-breaker mechanisms, admin-key powers, or any historical instance of such powers being used; this is a genuine, unresolved transparency gap rather than a confirmed absence.

### Cited Findings
- The bStocks FAQ, Markets, Regulation, and Integration docs pages fetched in this session contain **no mention** of pause/freeze/circuit-breaker mechanisms, admin keys, or emergency powers. The Regulation page explicitly lists "pause/freeze powers" among the topics it does **not** disclose, deferring instead to "the official prospectus." — [bStocks Docs, Regulation page](https://docs.bstocker.finance/docs/regulation); [bStocks Docs, FAQ](https://docs.bstocker.finance/docs/faq)
- Direct attempts to read the TSLAB contract page on BscScan (to check for `pause`, `blacklist`, or `onlyOwner`-style functions in verified source code) returned HTTP 403 in this session and could not be completed. — [WebFetch attempt, this session, target: BscScan TSLAB page]
- Targeted web searches for "bStocks contract pausable blacklist admin function" and "bStocks pause freeze circuit breaker" returned no bStocks-specific results — only generic smart-contract-security educational content unrelated to bStocks specifically. — [WebSearch results, this session]

### Inferences
- Given bStocks is a centrally-issued, custodial, regulated-certificate product (not a decentralized protocol), it is highly likely that BTECH Holdings/Binance retains some administrative control (e.g., ability to freeze redemption, delist, or pause minting) as is standard for regulated tokenized-securities issuers — but this could not be confirmed from any public source in this session, and no evidence of such powers ever being exercised was found either way.

### Gaps
- **This is a material, unresolved gap for the stated objective.** Neither the existence nor the absence of admin pause/freeze/blacklist functionality in the bStocks BEP-20 contracts could be confirmed, because (a) the official docs defer this topic entirely to the prospectus (not directly readable in this session), and (b) direct BscScan contract-code inspection was blocked (403 errors). A production financial product should not assume either the presence or absence of these controls without directly reading the verified contract source code on BscScan and/or the full prospectus text.
- No historical incident of a pause/freeze/blacklist action being used against bStocks was found — but absence of evidence here is not strong evidence of absence, given the above access limitations.

---

## Are there documented stale-price or abnormal-price incidents, audits, or oracle-risk post-mortems?

### Takeaway
No formal audit report (CertiK, PeckShield, or similar) specifically covering bStocks contracts was found; the one concrete piece of evidence of an oracle-related issue is a third-party developer bug report (not a post-mortem or audit) describing intermittent transaction reverts for TSLAB/NVDAB purchases, suspected to stem from a price-staleness guard in an aggregator route.

### Cited Findings
- Web searches for "bStocks audit CertiK PeckShield" returned no results connecting either firm to a bStocks-specific audit; results were generic descriptions of the audit firms themselves. — [WebSearch results, "bStocks audit CertiK PeckShield"]
- Web searches for "bStocks oracle price staleness incident depeg" surfaced only the GitHub issue described earlier (Ottopus project, issue #65) as concretely bStocks-related; it describes intermittent revert failures for TSLAB/NVDAB swap routes attributed to a suspected price-staleness guard, not a confirmed price-feed failure, depeg, or exploit. No comments/resolution were visible in the fetched content. — [GitHub, ottopusxyz/ottopus issue #65](https://github.com/ottopusxyz/ottopus/issues/65)
- The official docs mention "Audited smart contracts — formal verification from Tier-1 security firms" as part of the Proof of Collateral / trust framework, but **do not name the specific firm(s) or link to an audit report**. — [bStocks Docs, Proof of Collateral page](https://docs.bstocker.finance/docs/proof-of-collateral)

### Inferences
- The claim of "Tier-1 security firm" formal verification is marketing language without a citable, publicly linked audit report; this should be treated as an unverified claim until an actual audit report or firm name is located.
- The Ottopus GitHub issue, while not a post-mortem or formal incident report, is the only concrete public evidence found of real-world technical friction with bStocks' on-chain pricing infrastructure (staleness-related transaction failures), and is worth monitoring for further developments/resolution.

### Gaps
- No named/linked audit report for any bStocks contract was found anywhere in this research.
- No confirmed historical incident of an actual stale or abnormal bStocks price causing financial loss, an exploit, or a de-pegging event was found (positive or negative) — this specific question could not be answered from available public sources as of this research date (29 September 2026).

---

## Does bStocks publish which entity/custodian holds the underlying shares, and what is the redemption mechanism?

### Takeaway
bStocks documentation confirms the issuer (BTECH Holdings Ltd) and describes a daily-attested, ring-fenced custody structure at "a regulated US broker-custodian" (unnamed in the primary docs fetched), plus a fee-free 1:1 conversion mechanism between held equities and bStocks tokens — but the custodian's specific name is only found in a lower-confidence secondary/AI-summarized source ("Alpaca"), not directly confirmed from a primary document in this session.

### Cited Findings
- "Every token is a digital representation of a real-world share, held by a regulated custodian." Verification is available via a daily, publicly reconciled Proof of Collateral. — [bStocks Docs / WebSearch synthesis](https://docs.bstocker.finance/docs/proof-of-collateral)
- Custody structure: "a ring-fenced SPV structure that is bankruptcy-remote," with "Daily Proof of Collateral" reconciling custodian holdings against circulating token supply, plus contract-level "formal verification from Tier-1 security firms" (unnamed). — [bStocks Docs, Proof of Collateral page](https://docs.bstocker.finance/docs/proof-of-collateral)
- Redemption/conversion: "Users who hold the underlying equities through Binance's brokerage platform can convert at a 1:1 ratio into the corresponding bStock tokens and switch back without lock-up periods, minimum holding requirements, or conversion fees," described elsewhere as "Instant exchange at a 1:1 ratio between stock positions and bStocks with no conversion fee." — [WebSearch synthesis of BNB Chain blog and BSCNews reporting](https://www.bnbchain.org/en/blog/introducing-bstocks-on-bnb-chain-trade-24-7-with-zero-fees-deploy-across-defi-protocols-with-full-self-custody)
- Redemption is explicitly a **centralized, Binance-platform-mediated conversion** (convert back through Binance's 1:1 conversion feature), not a permissionless on-chain redemption function callable by any wallet holder directly against the custodian. — [Trust Wallet blog](https://trustwallet.com/blog/announcements/access-bstocks-on-trust-wallet-tokenized-shares-on-chain)
- The specific custodian name "Alpaca" (as in Alpaca Securities/Alpaca Markets) was reported only via an AI-generated search-result summary attributed to a BSCNews article, not confirmed via direct primary-source fetch in this session — treat as **unverified, lower confidence**. — [BSCNews article, via WebSearch summary](https://x.com/BSCNews/article/2066893653985853917)
- A bStock "gives you price exposure and dividends, not direct ownership, with no voting rights and no other shareholder perks." — [BSCNews via WebSearch summary](https://x.com/BSCNews/article/2066893653985853917)

### Inferences
- Redemption in practice requires going back through the centralized Binance platform (not a smart-contract call against the custodian), which means holding bStocks in a self-custody wallet (e.g., Trust Wallet) still ultimately depends on Binance's exchange platform to convert back to cash/equity exposure — an important counterparty-risk and operational-dependency point for a financial product relying on bStocks.

### Gaps
- The exact, confirmed legal name of the custodian could not be verified from a primary document in this session (only via a secondary AI-summarized source naming "Alpaca"). This should be directly confirmed from the ADGM prospectus PDF or Binance's Proof of Collateral page before being relied upon.
- The name(s) of the "Tier-1 security firms" that performed formal contract verification were not disclosed anywhere found in this research.
- Binance's own "Proof of Collateral" page (`binance.com/en/proof-of-collateral/bstocks`) could not be directly fetched in this session (DNS resolution failure for `www.binance.com`), so its exact methodology/disclosure format was not independently verified beyond secondary summaries.
