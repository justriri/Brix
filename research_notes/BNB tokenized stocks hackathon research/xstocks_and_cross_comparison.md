# xStocks (Backed Finance) and Cross-Wrapper Comparison of Tokenized Stocks

## What is xStocks exactly, who operates it, and what is the official site/docs?

### Takeaway
xStocks is a brand/product for tokenized US equities and ETFs issued by the Swiss company Backed Finance AG (via an issuing SPV structure), distributed through exchanges like Kraken and Bybit; the canonical technical documentation lives at docs.xstocks.fi and the public API at api.xstocks.fi, while backed.fi/assets.backed.fi is the issuer's own corporate/legal site.

### Cited Findings
- "xStocks is a collection of tokenized US equities issued by Backed Finance on Solana and listed on Kraken for non-US users... each xStock token corresponds 1:1 to a real share held in custody by a regulated entity." — [Kraken Xstocks Explained](https://eco.com/support/en/articles/15083158-kraken-xstocks-explained)
- Backed Finance is described as "a Swiss-based company founded in 2021 creating permissionless tokens tracking the value of publicly listed equities and ETFs." — [bnbchain.org blog](https://www.bnbchain.org/en/blog/xstocks-is-now-live-on-bnb-chain-with-50-tokenized-equities-with-100-more-coming-soon)
- Official Backed Finance resource pages: Docs at https://docs.backed.fi/, issuer platform at https://assets.backed.fi/, trading platform at https://app.backed.fi/authenticate, legal/prospectus at https://www.backedassets.fi/legal-documentation — [backed.fi](https://backed.fi/)
- xStocks-specific technical documentation is hosted separately at https://docs.xstocks.fi (Introduction, Developers, API Reference, FAQ sections) — [docs.xstocks.fi/docs](https://docs.xstocks.fi/docs), [docs.xstocks.fi/developers](https://docs.xstocks.fi/developers), [docs.xstocks.fi/apis/openapi](https://docs.xstocks.fi/apis/openapi)
- The public xStocks API is served from https://api.xstocks.fi/api/v2 with documentation at https://api.xstocks.fi/api-docs/ — [search result summary of docs.xstocks.fi/developers/quickstart](https://docs.xstocks.fi/developers/quickstart)
- Backed's structure: "a bankruptcy-remote issuing SPV, full 1:1 collateralization on an asset-by-asset basis with no commingling between products, segregated custody accounts governed by a three-party Account Control Agreement." — [docs.xstocks.fi/docs (Introduction)](https://docs.xstocks.fi/docs)
- Backed Finance is "regulated under [the] Swiss DLT Act," uses "licensed custodians," and has filed a prospectus "with [the] Liechtenstein FMA." — [backed.fi](https://backed.fi/)
- xStocks are explicitly geo-restricted: "unavailable in the United States, United Kingdom, Canada, Australia, and sanctioned jurisdictions." — [xstocks.com landing page](https://xstocks.com/)
- Kraken publishes its own xStocks risk disclosure page. — [Kraken xStocks Risk Disclosure](https://www.kraken.com/legal/xstocks)

### Inferences
- There appear to be two related but distinct official web properties: backed.fi / backedassets.fi / assets.backed.fi (issuer/corporate/legal side, run by Backed Finance AG) and xstocks.com / docs.xstocks.fi / api.xstocks.fi (product/brand and developer-facing side). Both should be treated as "official" for xStocks purposes, but legal/issuance terms live on the Backed side and technical/API/integration details live on the xstocks.fi side.

### Gaps
- No corporate registry filing or regulator confirmation was independently pulled (e.g., FINMA/Swiss commercial register record for "Backed Finance AG"); the Swiss-DLT-Act / Liechtenstein FMA claims rest on backed.fi's own marketing copy rather than a primary regulatory filing.

---

## Which tickers does xStocks offer, on which chains — is BNB Smart Chain (BSC) supported?

### Takeaway
xStocks is genuinely multi-chain, not Solana-only: independent reporting (BNB Chain's own blog, a Kraken/Backed/BNB Chain BusinessWire press release, and crypto trade press) confirms a real, named deployment of xStocks on BNB Smart Chain as BEP‑20 tokens, tradable on PancakeSwap and CowSwap — **however, this BSC deployment is notably NOT listed among the chains named in xStocks' own core developer documentation**, which enumerates only "Ethereum, Solana, Arbitrum, Mantle, TON, Ink, and other EVM-compatible networks." This is a real discrepancy between marketing/press-covered reality and the primary technical docs, and should be flagged explicitly rather than resolved by assumption.

### Cited Findings
- **Evidence FOR BSC support:**
  - "Kraken and Backed Deepen xStocks Reach with BNB Chain Integration" — BusinessWire press release dated 2025-07-09. — [businesswire.com](https://www.businesswire.com/news/home/20250709352561/en/Kraken-and-Backed-Deepen-xStocks-Reach-with-BNB-Chain-Integration)
  - "xStocks Is Now Live on BNB Chain with 50+ Tokenized Equities, with 100+ More Coming Soon" — official BNB Chain blog. "Over 50 tokenized U.S. equities and ETFs are now live on BNB Chain via xStocks, with 100+ more coming, including Apple, Tesla, NVIDIA, S&P 500 and more, tradeable 24/5 from as little as $10." "On BNB Chain, you can trade xStocks on PancakeSwap and CowSwap, with 1inch coming soon." — [bnbchain.org blog](https://www.bnbchain.org/en/blog/xstocks-is-now-live-on-bnb-chain-with-50-tokenized-equities-with-100-more-coming-soon)
  - "BNB Chain is partnering with Kraken and Backed to unlock access to tokenized equities like AAPLx, TSLAx, NVDAx, and SPYx—as BEP-20 tokens." — [bnbchain.org blog: "BNB Chain x Kraken x xStocks"](https://www.bnbchain.org/en/blog/bnb-chain-x-kraken-x-xstocks-trade-tokenized-equities-onchain-anytime)
  - "xStocks launches on BNB Chain, initial batch of 50+ tokenized U.S. [equities]" — trade-press coverage (~May 2025, per article-age estimate from the search snippet, i.e. roughly 152 days before late-September 2026). — [Bitget news](https://www.bitget.com/asia/amp/news/detail/12560605392474)
  - "The xStocks protocol surpassed $2 billion in total trading volume just three months after launch" (context in which BNB Chain coverage appears). — [search-aggregated summary citing CoinMarketCap Academy](https://coinmarketcap.com/academy/article/bnb-news-bnb-chain-expands-xstocks-trading-as-kraken-and-backed-launch-tokenized-equities)
  - "Further integrations are coming through Venus Protocol and Flux, powered by Chainlink" (planned BNB Chain DeFi integrations for xStocks as collateral). — [bnbchain.org blog](https://www.bnbchain.org/en/blog/xstocks-is-now-live-on-bnb-chain-with-50-tokenized-equities-with-100-more-coming-soon)
  - The xstocks.com landing page (via automated summarization) listed "BNB Chain (BSC)" among 10+ supported chains, alongside Ethereum, Solana, Mantle, TON, Ink, X Layer, Arbitrum, Tron, Optimism, and cited 1,101 stocks/ETFs and $40B+ volume — **this figure and chain list could not be independently re-verified against the primary docs and should be treated with caution** (see Inferences/Gaps below). — [xstocks.com](https://xstocks.com/)
- **Evidence AGAINST / omitting BSC in the primary technical docs:**
  - docs.xstocks.fi's own introduction states xStocks are "issued natively on Ethereum, Solana, Arbitrum, Mantle, TON, Ink, and other EVM-compatible networks" — BNB Smart Chain is not explicitly named (it could arguably fall under "other EVM-compatible networks," but is not called out by name the way Ethereum/Solana/Arbitrum/Mantle/TON/Ink are). — [docs.xstocks.fi/docs](https://docs.xstocks.fi/docs)
  - The xStocks FAQ page likewise names "Ethereum, Solana, Arbitrum, Mantle, TON, Ink, and other EVM-compatible networks" without mentioning BSC specifically. — [docs.xstocks.fi/docs/frequently-asked-questions](https://docs.xstocks.fi/docs/frequently-asked-questions)
- **Tickers:** The initial Solana lineage of ~60 tickers launched May 22, 2025, including AAPL, NVDA, TSLA, AMZN, MSFT, COIN, MSTR, and SPY (ETF), with tickers following an "x" suffix (AAPLx, TSLAx, NVDAx, SPYx, etc.). — [Coinmetrics / State of the Network](https://coinmetrics.substack.com/p/state-of-the-network-issue-341); [Solana.com case study](https://solana.com/news/case-study-xstocks); [bingx.com](https://bingx.com/en/learn/article/what-are-the-top-tokenized-stocks-xstocks-on-solana)
- "TSLA, NVDA, CRCL, and SPY account for about 58% of active wallets" on the Solana deployment. — [Coinmetrics substack](https://coinmetrics.substack.com/p/state-of-the-network-issue-341)
- Each xStock has an assigned ISIN, e.g. TSLAx = CH1436219252, SPYx = CH1436219716, MSTRx = CH1436219633 (Swiss ISIN prefix "CH," consistent with a Swiss issuer). — [RWA.xyz asset pages](https://app.rwa.xyz/assets/TSLAx), [RWA.xyz](https://app.rwa.xyz/assets/SPYx), [RWA.xyz](https://app.rwa.xyz/assets/MSTRx)
- Attempts to directly find specific BEP-20 contract addresses for AAPLx/TSLAx on BscScan via search did not surface a confirmed, verifiable contract address in this research pass. — search of bscscan.com token pages returned generic/unrelated token contracts, not confirmed xStocks tickers. [BscScan search](https://bscscan.com/)

### Inferences
- The weight of evidence (an official BNB Chain blog post, a joint BusinessWire press release naming Kraken, Backed, and BNB Chain, and independent trade-press coverage) supports that **xStocks tokens were in fact deployed on BNB Smart Chain as BEP-20 tokens and traded on PancakeSwap/CowSwap**, first reported around May–July 2025. This is a case where the primary developer docs (docs.xstocks.fi) are either stale/incomplete or classify BNB Chain informally under "other EVM-compatible networks" rather than naming it explicitly — the docs should not be read as denying BSC support, but they also do not affirmatively confirm it by name.
- The xstocks.com landing-page figures ($40B+ volume, 1,101 stocks/ETFs, 10+ named chains) look inflated/inconsistent relative to other sourced figures (e.g., "~60 tickers" at Solana launch, "$2B volume after 3 months") and were obtained via an automated single-page summarization tool rather than direct verification — treat these specific numbers as **unverified** pending a direct, human-reviewed read of xstocks.com and docs.xstocks.fi.

### Gaps
- No independently confirmed BEP-20 contract address for any specific xStocks ticker (e.g. AAPLx) on BscScan was located in this pass — a direct BscScan search/verification (ideally cross-checked against an address published in docs.xstocks.fi or api.xstocks.fi) is needed to fully confirm the BSC deployment at the contract level.
- Could not determine whether the BSC deployment is still active/maintained as of September 2026, or whether it was a time-limited promotional integration — the most recent BSC-specific sources found date to mid-2025; no 2026-dated confirmation of continued BSC support was found.
- Could not confirm exactly how many of the 50+ (and reportedly 100+ more) tickers announced for BNB Chain are still live, nor obtain a current authoritative list.

---

## What token/contract standard does xStocks use?

### Takeaway
xStocks uses SPL tokens on Solana (its original/primary chain), ERC‑20-style tokens on Ethereum and other EVM chains (Arbitrum, Mantle, Ink, per docs), and — per BNB Chain's own announcement — BEP‑20 tokens on BNB Smart Chain; TON uses its own token standard on that network.

### Cited Findings
- "xStocks... available as SPL tokens on Solana with ticker symbols ending in 'x'." — [search-aggregated overview](https://bingx.com/en/learn/article/what-are-the-top-tokenized-stocks-xstocks-on-solana)
- Backed Finance is described as issuing "a series of Solana Program Library (SPL) tokens collateralized 1:1 by real-world U.S. equities and ETFs." — [search-aggregated summary](https://phemex.com/academy/what-is-backed-finance)
- "xStocks are issued natively on Ethereum, Solana, Arbitrum, Mantle, TON, Ink, and other EVM-compatible networks." (implying ERC-20 on Ethereum/Arbitrum/Mantle/Ink, SPL on Solana, and a TON-native standard on TON). — [docs.xstocks.fi/docs](https://docs.xstocks.fi/docs)
- "BNB Chain is partnering with Kraken and Backed to unlock access to tokenized equities like AAPLx, TSLAx, NVDAx, and SPYx—as BEP-20 tokens." — [bnbchain.org blog](https://www.bnbchain.org/en/blog/bnb-chain-x-kraken-x-xstocks-trade-tokenized-equities-onchain-anytime)
- On Solana and TON specifically, "the raw onchain balance remains constant and the multiplier must be applied for display: displayed balance = raw amount × multiplier" (relevant to how corporate actions are reflected without changing token supply directly). — [docs.xstocks.fi/developers/multipliers, per search summary](https://docs.xstocks.fi/developers/multipliers)

### Inferences
- BSC's BEP-20 standard is functionally an Ethereum ERC-20-compatible standard, so the BNB Chain xStocks deployment is architecturally consistent with the EVM-family deployments already documented for Ethereum/Arbitrum/Mantle/Ink — no evidence found of a fundamentally different token mechanism on BSC.

### Gaps
- No BEP-20 contract address, decimals, or token metadata schema was independently verified on BscScan for any specific xStocks ticker.

---

## How are xStocks prices sourced/fed on-chain (oracle, NAV mechanism, redemption-backed)?

### Takeaway
xStocks tokens are designed to track 1:1 the price of the underlying real equity via full physical backing and a redemption arbitrage mechanism (not primarily an internal on-chain "NAV" calculation); corporate actions (splits/dividends) are handled via an onchain "multiplier" rebasing mechanism rather than changing raw token supply; the specific oracle vendor used by Backed/xStocks internally was not confirmed in official docs during this research pass, though Pyth Network is confirmed as a major third-party oracle provider for equities/ETFs in the broader ecosystem and is explicitly used by at least one other tokenized-stock-adjacent protocol (Edel Finance) that consumed xStocks-derived assets.

### Cited Findings
- "corporate actions such as dividends, stock splits, and reverse splits are reflected through an onchain rebasing mechanism" and token balances maintain "1:1 exposure of the underlying equity." — [docs.xstocks.fi/docs (Introduction)](https://docs.xstocks.fi/docs)
- "issuance and redemption through the issuer operate 24/5, aligned with U.S. equity market hours." — [docs.xstocks.fi/docs](https://docs.xstocks.fi/docs)
- "Each token is collateralized by shares custodied at a Backed Finance prime broker in Switzerland, redeemable by qualified investors." — [search-aggregated summary re: backed.fi](https://backed.fi/)
- The xStocks public API exposes "asset metadata, pricing data, multipliers, proof of reserves, oracle feeds, corporate action schedules" — explicitly confirming an "oracle feeds" endpoint exists in the API, though the exact oracle vendor name was not returned in the summarized result. — [api.xstocks.fi / docs.xstocks.fi/apis/openapi, per search summary](https://docs.xstocks.fi/apis/openapi)
- "Pyth Core equity feeds publish during US regular hours only (9:30-16:00 ET, weekdays), and outside that, the feed goes stale. This is a known technical constraint for equity-backed assets like xStocks." — [search-aggregated technical commentary, source context: GitHub hylo-so/sdk issue #136 "Off-hours pricing for equity-backed xAssets (SPCXx)"](https://github.com/hylo-so/sdk/issues/136)
- In the Edel Finance exploit (see incidents section below), the lending protocol built on top of xStocks-derived wrapped assets "used Chainlink oracles, which correctly reported Alphabet's share price" — indicating Chainlink, not Pyth, was the oracle used by that specific downstream DeFi protocol for GOOGL price, while the exploited component was the wrapper's own internal share-rate/exchange-rate mechanism, not the price oracle itself. — [CoinDesk, "Prices of tokenized Google stock inflated 7,700% in rare DeFi lending exploit," 2026-07-01](https://www.coindesk.com/tech/2026/07/01/tokenized-google-stock-inflated-7-700-in-rare-defi-lending-exploit)
- BNB Chain's own blog notes planned (not yet live at announcement time) integrations "through Venus Protocol and Flux, powered by Chainlink" for xStocks collateral use on BSC — implying Chainlink is the intended oracle for BSC-based DeFi integrations of xStocks, though this refers to downstream lending/collateral use rather than confirming what oracle backs the xStocks token price itself. — [bnbchain.org blog](https://www.bnbchain.org/en/blog/xstocks-is-now-live-on-bnb-chain-with-50-tokenized-equities-with-100-more-coming-soon)

### Inferences
- The core xStocks price-tracking mechanism is fundamentally redemption/arbitrage-backed (1:1 physical share custody + issuer-level 24/5 issuance/redemption), rather than a synthetic/algorithmic NAV computed purely on-chain — this is structurally different from a collateralized-debt or algorithmic stablecoin-style peg.
- The specific primary oracle used internally by Backed/xStocks to publish reference prices via its own API (the "oracle feeds" endpoint) was not identified by name in this research pass; separately, third-party protocols building on top of xStocks have used both Pyth (referenced in the context of "equity-backed xAssets" stale-price behavior) and Chainlink (used by Edel Finance and planned for BNB Chain DeFi integrations) — suggesting **no single oracle vendor is confirmed to be common to all xStocks price consumption**, though this is inferred from fragmentary evidence rather than an authoritative single source.

### Gaps
- Could not directly confirm, from a primary source, exactly which oracle network (if any single one) feeds the canonical "oracle feeds" field in the xStocks public API — a direct fetch of https://docs.xstocks.fi/apis/openapi or the live OpenAPI spec would be needed to name the vendor(s) precisely.
- No detail found on the exact redemption arbitrage mechanics (e.g., who are the authorized participants, how fast can redemption occur, what are the fees) beyond the FAQ's "$5,000 minimum for direct redemption" and "eligible direct clients vs. retail via secondary markets" distinction.

---

## Is historical price data available (official API, on-chain, subgraph)?

### Takeaway
Yes — xStocks publishes a public, documented REST API (api.xstocks.fi) that includes historical multiplier data and general asset/pricing metadata endpoints; no dedicated on-chain subgraph was identified in this research pass, though Dune Analytics hosts an official xStocks dashboard drawing on on-chain data.

### Cited Findings
- "OpenAPI descriptions are available for download in both openapi.json and openapi.yaml formats, with the production endpoint at https://api.xstocks.fi/api/v2." — [docs.xstocks.fi/apis/openapi, per search summary](https://docs.xstocks.fi/apis/openapi)
- "Historical multiplier data is available at: https://api.xstocks.fi/api/v2/public/assets/{SYMBOL}/multiplier/history?network={NETWORK}." — [docs.xstocks.fi/developers/multipliers, per search summary](https://docs.xstocks.fi/developers/multipliers)
- "Public endpoints expose asset metadata, pricing data, multipliers, proof of reserves, oracle feeds, corporate action schedules, and xStocks public wallet addresses" (no auth required). — [docs.xstocks.fi/developers, per search summary](https://docs.xstocks.fi/developers)
- Dune has an official xStocks dashboard: "The official @xStocksFi dashboard is now live" — [Dune (X/Twitter) announcement](https://x.com/Dune/status/1950541932608061797); dashboard hub at [dune.com/xstocks](https://dune.com/xstocks)

### Inferences
- The historical data explicitly documented is for the *multiplier* (corporate-action adjustment factor) time series, not necessarily a full historical OHLC price series for the underlying stock itself — actual historical price/quote data may need to be sourced from the underlying market data (e.g., via the referenced oracle) or from on-chain DEX trade history (e.g., via Dune) rather than from a dedicated "historical price" endpoint.

### Gaps
- Could not confirm whether api.xstocks.fi exposes a dedicated historical OHLC/price-series endpoint (distinct from the multiplier-history endpoint) — this would require a direct fetch of the OpenAPI spec, which was not successfully retrieved in full during this pass.
- No dedicated subgraph (e.g., a TheGraph subgraph) specific to xStocks was found.

---

## Is on-chain liquidity data available (which DEXs list xStocks, TVL)?

### Takeaway
On-chain liquidity data for xStocks is trackable via DefiLlama (which lists "xStocks" as a discrete, low-ranked RWA protocol) and via DEX aggregators like DEXScreener for BSC/PancakeSwap pairs; on Solana, xStocks trade on Solana DEXs, and on BNB Chain specifically they trade on PancakeSwap and CowSwap.

### Cited Findings
- "Among RWA protocols tracked by DefiLlama, xStocks ranks #143 by TVL, with the RWA category holding $5.776b across 171 protocols, and xStocks accounting for 0% of that total" (i.e., a very small share of RWA TVL). — [DefiLlama, via search summary](https://defillama.com/protocol/xstocks) (direct fetch of this URL failed with a DNS resolution error during this research pass — see Gaps)
- "On BNB Chain, you can trade xStocks on PancakeSwap and CowSwap, with 1inch coming soon." — [bnbchain.org blog](https://www.bnbchain.org/en/blog/xstocks-is-now-live-on-bnb-chain-with-50-tokenized-equities-with-100-more-coming-soon)
- "PancakeSwap X lists tokenized RWAs including AAPLX and NVDAX" (headline evidence of PancakeSwap-side listing). — [Crypto Briefing](https://cryptobriefing.com/pancakeswap-x-tokenized-rwa-stocks/)
- PancakeSwap overall (all chains) TVL figure for context: "$2.313b in total value locked, with BSC accounting for $2.237b of that TVL" (general PancakeSwap/BSC liquidity backdrop, not xStocks-specific). — [DefiLlama, via search summary](https://defillama.com/protocol/pancakeswap)
- Bitget/BSCNews-sourced commentary and the "Nett" comparison tool (see cross-wrapper section) describe xStocks alongside bStocks and Ondo as all trading "on BNB Smart Chain," implying at least some BSC-native liquidity exists for xStocks tokens as of the tool's writing. — [github.com/nftkingiii/nett](https://github.com/nftkingiii/nett)

### Inferences
- xStocks' TVL/liquidity footprint appears to be comparatively small within the broader RWA/DeFi landscape (per the DefiLlama #143 ranking / ~0% of RWA category TVL claim), which is consistent with tokenized-equity products generally being nascent and lower-liquidity compared to major DeFi primitives.

### Gaps
- Direct fetch of defillama.com failed (DNS resolution error: "getaddrinfo ENOTFOUND defillama.com") in this environment, so the DefiLlama TVL figures above are relayed from a WebSearch summary snippet rather than independently confirmed against the live page — this should be re-verified by the report writer/reader directly against https://defillama.com/protocol/xstocks if possible.
- No specific per-ticker DEXScreener pair URLs or exact TVL/liquidity-depth figures (e.g., dollar amount of liquidity in the AAPLx/USDT PancakeSwap pool) were retrieved in this pass.

---

## Is market open/closed status exposed anywhere?

### Takeaway
xStocks distinguishes secondary-market (DEX/CEX) trading — described as available 24/7 — from issuer-level issuance/redemption, which is restricted to a 24/5 window aligned with US equity market hours; the public API documentation references "oracle feeds" and "corporate action schedules" endpoints that plausibly could expose market-hours/status information, but no explicit "market open/closed" boolean field or endpoint was confirmed by name in this research pass.

### Cited Findings
- "xStocks can be traded 24/7 on secondary markets, depending on the platform" while "issuance and redemption are limited to business days when the US market is open, normally 24/5." — [docs.xstocks.fi/docs/frequently-asked-questions, per search summary](https://docs.xstocks.fi/docs/frequently-asked-questions)
- "issuance and redemption through the issuer operate 24/5, aligned with U.S. equity market hours." — [docs.xstocks.fi/docs](https://docs.xstocks.fi/docs)
- Separately, "Pyth Core equity feeds publish during US regular hours only (9:30-16:00 ET, weekdays), and outside that, the feed goes stale" — indicating that at least some equity oracle feeds used in this ecosystem (for xStocks-like assets, per the cited GitHub issue discussing "equity-backed xAssets (SPCXx)") do carry an implicit open/closed signal via feed staleness, even if not exposed as an explicit status flag by xStocks itself. — [GitHub hylo-so/sdk issue #136, via search summary](https://github.com/hylo-so/sdk/issues/136)
- The "Nett" comparison tool explicitly builds market-status detection into its safety logic, refusing wrapper versions during "Corporate action halts or closed issuers outside US trading hours" — implying that at least third-party tooling infers/derives market status rather than reading a single unified "market open" flag from any one wrapper's API. — [github.com/nftkingiii/nett](https://github.com/nftkingiii/nett)

### Inferences
- There does not appear to be one single authoritative, universally-relied-upon "market open/closed" boolean exposed by xStocks itself; downstream tools instead infer market status either from oracle feed staleness or from known US market-hours schedules.

### Gaps
- Could not confirm whether api.xstocks.fi has a literal `/market-status` or similar endpoint — would require direct retrieval of the full OpenAPI spec (attempts to fetch api.xstocks.fi/api-docs/ directly did not return endpoint-level detail in this pass).

---

## Are there official public APIs for xStocks (backed.fi or xstocks.com docs)?

### Takeaway
Yes — xStocks maintains a documented, versioned public REST API (api.xstocks.fi, v2) with an OpenAPI specification, covering asset metadata, pricing, multipliers, proof of reserves, oracle feeds, corporate action schedules, and public wallet addresses, requiring no authentication for public endpoints; this is separate from Backed Finance's own backed.fi/docs.backed.fi corporate documentation.

### Cited Findings
- "The xStocks API provides programmatic access to the xStocks platform, market data, and token metadata... all endpoints served under /api/v2/*." — [docs.xstocks.fi/developers, per search summary](https://docs.xstocks.fi/developers)
- "OpenAPI descriptions are available for download in both openapi.json and openapi.yaml formats, with the production endpoint at https://api.xstocks.fi/api/v2." — [docs.xstocks.fi/apis/openapi, per search summary](https://docs.xstocks.fi/apis/openapi)
- "Public endpoints (No Authentication Required)... expose asset metadata, pricing data, multipliers, proof of reserves, oracle feeds, corporate action schedules, and xStocks public wallet addresses." — [same source](https://docs.xstocks.fi/developers)
- Example documented endpoint: `https://api.xstocks.fi/api/v2/public/assets/{SYMBOL}/multiplier?network={NETWORK}` and its `/history` variant. — [docs.xstocks.fi/developers/multipliers](https://docs.xstocks.fi/developers/multipliers)
- A separate third-party "Solana Xstocks API" also exists via Bitquery, described as covering the Solana on-chain side specifically. — [Bitquery docs](https://docs.bitquery.io/docs/blockchain/Solana/xstocks-api/)
- Backed Finance's own docs portal (docs.backed.fi) exists as a separate resource, presumably covering the issuer/legal/asset-registration side rather than the same v2 trading API. — [backed.fi](https://backed.fi/)

### Inferences
- Because a "Backed public API that provides quote and multiplier data" was referenced in relation to a Solana-focused open-source tool ("Stocklana"), it's likely that api.xstocks.fi (or a closely related Backed-operated API) is the same API referenced there, suggesting some consolidation between "Backed" and "xStocks" branded API surfaces. — [github.com/instinct-auditor/Stocklana, per search snippet](https://github.com/instinct-auditor/Stocklana)

### Gaps
- Did not obtain the full endpoint list/schema from api.xstocks.fi/api-docs/ (direct fetch returned only a generic confirmation that v1 docs exist, without endpoint bodies) — a manual browser-based review of the live Swagger/OpenAPI UI would be needed for a complete endpoint inventory.
- Rate limits, authentication requirements for non-public endpoints, and terms of use for the API were not found in this pass.

---

## Documented pause/freeze mechanisms (compliance/transfer restriction features)

### Takeaway
xStocks tokens include an issuer-controlled "Pausable" capability that lets Backed Finance halt all interactions with a token in emergencies/regulatory situations, but — notably — once issued, xStocks are described as freely transferable peer-to-peer on-chain (including to non-KYC'd/anonymous wallets) with no routine transfer whitelist, unlike many traditional security tokens; on Solana this is implemented via Solana Token Extensions (Token-2022) rather than a bespoke smart contract.

### Cited Findings
- "xStocks utilize a 'Pausable Config' that lets the issuer pause all interactions with the token in case of emergencies, regulatory requirements, or security incidents — providing an important safeguard." — [search-aggregated summary, likely sourced from Ledger Academy / Solana case study content](https://www.ledger.com/academy/topics/defi/what-are-tokenized-equities)
- "xStocks can be freely transferred on-chain without restrictions after issuance... xStocks use programmable compliance features via Solana Token Extensions that include pause/transfer controls while staying DeFi-compatible." — [search-aggregated summary](https://solana.com/news/case-study-xstocks)
- "Unlike most security tokens, xStocks are permissionless post-issuance, allowing users to freely trade and interact with them on decentralized platforms, and once received, xStocks can be withdrawn on-chain to any Solana wallet and are fully transferrable—including to anonymous addresses." — [search-aggregated summary, likely Solana.com or QuickNode blog](https://www.quicknode.com/blog/xstocks-solana-tokenized-stocks-2025)
- "Backed Finance is a Swiss-regulated RWA issuer that provides the underlying infrastructure for tokenized equities, most notably xStocks – a series of Solana Program Library (SPL) tokens collateralized 1:1 by real-world U.S. equities and ETFs" (context confirming the Token-2022/SPL basis on Solana). — [phemex.com academy article, via search summary](https://phemex.com/academy/what-is-backed-finance)
- Related GitHub discussion: "Token-2022 collateral: extension policy notes for the exo registry" references how Solana Token-2022 extensions (which include pause/transfer-hook features) apply to xStocks-like collateral. — [github.com/hylo-so/sdk issue #135](https://github.com/hylo-so/sdk/issues/135)

### Inferences
- The pause mechanism appears designed as an emergency/regulatory circuit-breaker (issuer-level, presumably rare/discretionary) rather than a routine per-transaction compliance gate — this is a materially different risk profile from, e.g., a stablecoin issuer that blacklists individual addresses routinely, and should be treated as a "tail risk" (issuer discretion to halt all transfers of a given xStock) rather than a day-to-day friction.

### Gaps
- Could not find a primary Backed Finance or xStocks document (whitepaper, smart contract audit, or terms of service) that specifies the exact conditions/governance process under which the pause function can be triggered, who holds the pause key/authority, or whether it has ever been exercised in practice.
- Could not confirm whether the EVM-chain deployments (Ethereum/Arbitrum/Mantle/Ink/BSC) implement an equivalent pause mechanism via a standard ERC-20 extension (e.g., OpenZeppelin Pausable) — the pause/freeze sourcing found was specific to the Solana Token-2022 implementation.

---

## Documented stale-price/abnormal-price incidents or audits?

### Takeaway
No incident was found in which xStocks' own oracle/price feed was directly compromised or found to be stale/manipulated; however, a well-documented ~$403K exploit occurred in July 2026 against **Edel Finance**, a third-party DeFi lending protocol built on top of *wrapped* xStocks tokens (wGOOGLx and others) — the exploit manipulated the wrapper's internal exchange-rate/share-rate mechanism (inflating collateral value ~78x), not the underlying Chainlink price oracle, which "correctly reported Alphabet's share price." This is an important, concrete illustration of exactly the kind of wrapper-level (not oracle-level) risk relevant to cross-wrapper comparison. No independent smart-contract audit report for Backed Finance/xStocks itself was located in this research pass.

### Cited Findings
- "Edel Finance, a programmable market layer for tokenized equities, suffered a roughly $403,000 exploit" on July 1[, 2026]. — [KuCoin News](https://www.kucoin.com/news/flash/edel-finance-loses-403k-in-flash-loan-oracle-exploit); [LiveBitcoinNews](https://www.livebitcoinnews.com/edel-finance-exploit-exposes-oracle-weakness-leaves-403k-hole/); [AMBCrypto](https://ambcrypto.com/edel-finance-loses-403k-as-flash-loan-oracle-exploit-hits-xstock-lending-reserves/)
- "The attacker manipulated the exchange rate between wGOOGLx and GOOGLx through repeated supply and borrow actions using a flash loan, inflating the value of the wGOOGLx collateral" to roughly 78x its correct value. — [CoinDesk, "Prices of tokenized Google stock inflated 7,700% in rare DeFi lending exploit," 2026-07-01](https://www.coindesk.com/tech/2026/07/01/tokenized-google-stock-inflated-7-700-in-rare-defi-lending-exploit)
- "The attacker borrowed 384,215 USDC, 122.20 wSPYx, 62.97 wQQQx, 293.12 wMSTRx, 99.85 wNVDAx, and 37.59 wTSLAx. The flash loan was eventually repaid, yielding a profit of approximately $305,000." — [CoinDesk](https://www.coindesk.com/tech/2026/07/01/tokenized-google-stock-inflated-7-700-in-rare-defi-lending-exploit)
- "The oracle itself was not compromised... Edel used Chainlink oracles, which correctly reported Alphabet's share price [~$357]... The flaw was in the wrapping mechanism. The attacker interfered with how GOOGLx converted to and from wGOOGLx, so the collateral was mispriced even though the underlying price feed was accurate." — [CoinDesk](https://www.coindesk.com/tech/2026/07/01/tokenized-google-stock-inflated-7-700-in-rare-defi-lending-exploit)
- "Immediately after detection, the Edel team paused all V1 contracts... will absorb all losses so depositors are made whole, is rolling out a redesigned version-two system to prevent similar price-manipulation attacks, and has offered the attacker a white-hat settlement." — [Bitget News](https://www.bitget.com/news/detail/12560605484929) (title/summary), [related Bitget follow-up](https://www.bitget.com/news/detail/12560605484975)
- A related industry analysis piece, "How tokenized stocks fail as collateral even when the stock price does not move," discusses this class of wrapper-mispricing risk more broadly. — [CryptoSlate](https://cryptoslate.com/how-tokenized-stocks-fail-as-collateral-even-when-the-stock-price-does-not-move/); [mirrored on CryptoPond](https://cryptopond.com/how-tokenized-stocks-fail-as-collateral-even-when-the-stock-price-does-not-move/)
- Separately, "Pyth Core equity feeds publish during US regular hours only (9:30-16:00 ET, weekdays), and outside that, the feed goes stale. This is a known technical constraint for equity-backed assets like xStocks" — a documented *structural* stale-price risk (off-hours feed staleness), distinct from an "incident." — [GitHub hylo-so/sdk issue #136, via search summary](https://github.com/hylo-so/sdk/issues/136)
- "Kraken and Backed utilize secure custody, audited reserves, and blockchain infrastructure to ensure the safety and transparency of xStock holdings" — a marketing-level claim of "audited reserves," but no specific audit firm, report, or date was found. — [search-aggregated summary, source unclear/marketing copy](https://www.kraken.com/xstocks)

### Inferences
- The Edel Finance incident is best understood as a risk of a **secondary, third-party wrapper built on top of xStocks** (wGOOGLx etc. are not native Backed/xStocks tokens themselves, but a further wrapping layer created by Edel Finance), not evidence of a flaw in Backed Finance's own xStocks infrastructure or its price oracle. This distinction is directly relevant to the cross-wrapper-comparison research question: it demonstrates concretely that additional wrapping layers on top of an already-wrapped asset introduce their own independent pricing risk, separate from both the underlying stock's real price and the base wrapper's (xStocks') own price feed.
- No confirmed, named third-party smart-contract security audit (e.g., from a firm like Trail of Bits, OpenZeppelin, Certik, etc.) of Backed Finance's or xStocks' own token/issuance contracts was found; the "audited reserves" language appears to refer to financial/custody audits of the backing assets rather than a code security audit, but this could not be confirmed either way.

### Gaps
- No named audit firm or audit report link for Backed Finance/xStocks smart contracts (as opposed to reserve attestations) was found in this research pass.
- Could not confirm whether Backed Finance's own xStocks price oracle/feed (as opposed to Edel Finance's downstream Chainlink integration) has ever itself gone stale or been found inaccurate in a documented incident — no such incident was found, but this is an absence of evidence rather than confirmed evidence of absence.

---

## Cross-Wrapper Comparison: How would one identify "the same underlying stock" across different wrapper protocols (bStocks, Ondo, xStocks)?

### Takeaway
The most robust identifier found is the ISIN (each Backed/xStocks asset has an assigned Swiss ISIN, e.g. TSLAx = CH1436219252); in practice, however, publicly available comparison tools built for exactly this purpose (Nett, Statera) rely on simpler heuristics — matching by ticker-symbol convention (base ticker + wrapper-specific suffix: "…x" for xStocks, "…on" for Ondo, "…B" for bStock) or by raw token contract address — rather than a shared cross-protocol identifier registry.

### Cited Findings
- Each xStock carries an ISIN, e.g., TSLAx = CH1436219252, SPYx = CH1436219716, MSTRx = CH1436219633. — [RWA.xyz: TSLAx](https://app.rwa.xyz/assets/TSLAx), [SPYx](https://app.rwa.xyz/assets/SPYx), [MSTRx](https://app.rwa.xyz/assets/MSTRx)
- "The same US stock trades on BNB Smart Chain as up to three different tokens — Ondo, xStocks and bStock — each with its own price, share multiplier, trading hours, liquidity and execution path." The "Nett" tool "resolves a stock to every version" using the naming convention that the same base ticker appears as three suffixed variants: Ondo ("…on"), xStocks ("…x"), and bStock ("…B"). — [github.com/nftkingiii/nett](https://github.com/nftkingiii/nett)
- Nett's identification method is ticker-symbol-based, with **no mention of ISIN or CUSIP matching** in its documentation. — [github.com/nftkingiii/nett](https://github.com/nftkingiii/nett)
- The separate "Statera" tool instead identifies identity at the **raw token contract-address level**, explicitly comparing a raw xStock (e.g., NVDAx at `0xc845b2894dbddd03858fd2d643b4ef725fe0849d`) against its further-wrapped ERC-4626 vault form (wNVDAx at `0xa8ddb5cd96b5222afe198316e9a57caa642850d5`), stating "the raw xStock address... is the asset identity for both forms." — [github.com/seekdaseek/statera](https://github.com/seekdaseek/statera)
- Every token price in Nett "is divided by its share multiplier before comparison" to correctly normalize for corporate actions/multiplier drift before cross-wrapper price comparison is meaningful. — [github.com/nftkingiii/nett](https://github.com/nftkingiii/nett)

### Inferences
- Because official ISINs do exist (at least for Backed/xStocks assets) but the actual open-source tooling built for this exact cross-wrapper-comparison problem does *not* use ISIN/CUSIP matching, it's reasonable to infer that either (a) equivalent ISINs are not consistently published/discoverable for the other wrappers (Ondo, bStock), making ticker-suffix convention a more practically available common key across all three, or (b) tool authors simply found ticker-suffix matching sufficient and simpler to implement. This should be treated as an inference, not a confirmed fact, since no source directly explains why ISIN matching was not used.

### Gaps
- Could not find published ISINs (or equivalent) for Ondo Global Markets or bStocks assets to confirm whether true ISIN-based cross-referencing is even possible today across all three wrapper families.
- No evidence of a formal, maintained, cross-protocol "master registry" mapping ticker/ISIN/contract address across xStocks, Ondo, and bStocks was found (Nett and Statera are independent, small open-source projects, not an industry-standard registry).

---

## Do these wrappers share the same upstream price oracle/data provider (i.e., are they NOT independent for cross-checking purposes)?

### Takeaway
Evidence found does **not** show all three wrapper families (xStocks, Ondo, bStocks) relying on one single common oracle vendor; independent comparison tools built specifically to cross-check these wrappers instead deliberately use a *separate, independent* reference price (a centralized exchange order book — Binance's public Web3/wallet API in one tool, OKX's public spot order book in another) precisely because they treat the wrappers' own quoted/oracle prices as not fully independent or trustworthy on their own. Within the xStocks ecosystem specifically, evidence points to more than one oracle vendor being involved depending on the integration (Pyth referenced for "equity-backed xAssets" feed staleness; Chainlink used both by Edel Finance's downstream lending protocol and planned for BNB Chain DeFi integrations via Venus/Flux).

### Cited Findings
- The "Nett" tool explicitly does **not** rely on the wrappers' native oracles for its comparison; instead it "relies on the Binance Web3 Trading API," pulling "names, logos, share ratios, status, reference price" from a "RWA Data module" and "executable quotes" from Binance's `aggregator/quote`/`aggregator/swap` endpoints — using a centralized-exchange data source as the arbiter rather than any one wrapper's own on-chain oracle. Its documentation states there is "no indication these wrappers share a common price oracle." — [github.com/nftkingiii/nett](https://github.com/nftkingiii/nett)
- The "Statera" tool similarly avoids relying on any wrapper's native pricing and instead uses "OKX's public spot order book" as an independent mark ("needs no key, so it is the mark"), tracking instruments like `XNVDA-USDT`, `XTSLA-USDT`, `XSPY-USDT` and computing "mid of bid/ask" with timestamps (`markAgeMs`) to track feed freshness. — [github.com/seekdaseek/statera](https://github.com/seekdaseek/statera)
- Statera found that, after adjusting for wrapper share multipliers, on-chain xStocks pool prices and OKX's independent order-book mark agreed closely: "NVDA and SPY agree to within 2 bps once the multiplier is divided out" (NVDA: 0.12 bps divergence; SPY: 0.96 bps divergence; TSLA: −29 bps "ordinary venue basis"). — [github.com/seekdaseek/statera](https://github.com/seekdaseek/statera)
- Within the xStocks/related-wrapper ecosystem, at least two different oracle vendors appear in different roles: (1) Pyth Network is referenced specifically regarding equity-feed market-hours staleness for "equity-backed xAssets" — [GitHub hylo-so/sdk issue #136](https://github.com/hylo-so/sdk/issues/136); and (2) Chainlink was the oracle actually used by Edel Finance (a wGOOGLx-consuming lending protocol) and is the oracle BNB Chain names for planned Venus Protocol/Flux DeFi integrations of xStocks collateral — [CoinDesk](https://www.coindesk.com/tech/2026/07/01/tokenized-google-stock-inflated-7-700-in-rare-defi-lending-exploit); [bnbchain.org blog](https://www.bnbchain.org/en/blog/xstocks-is-now-live-on-bnb-chain-with-50-tokenized-equities-with-100-more-coming-soon).

### Inferences
- The fact that two independent, purpose-built comparison tools (Nett, Statera) both chose to source their reference/"ground truth" price from a **centralized exchange order book** (Binance and OKX respectively) rather than from any tokenized-stock wrapper's own on-chain oracle strongly suggests that, in the authors' assessment, the wrappers' own price feeds are not considered sufficiently independent, transparent, or trustworthy to cross-check each other directly — i.e., using one wrapper's oracle to validate another wrapper's price would risk circularity or shared-vendor bias if such sharing existed, so best practice (as demonstrated by these tools) is to benchmark all wrappers against a *third*, external, off-chain reference rather than against each other.
- No direct evidence was found that xStocks, Ondo, and bStocks all use one identical single oracle vendor; however, the absence of a definitive, named, single upstream data provider across all three (verified by only partial, fragmentary sourcing) means this question cannot be fully closed — see Gaps.

### Gaps
- Could not find a direct, primary-source statement (from Ondo's or bStocks' own documentation) naming their specific oracle/price-feed vendor(s), which is necessary to definitively confirm or rule out oracle overlap with xStocks. This research pass focused primarily on xStocks per the assignment scope; Ondo's and bStocks' own oracle architecture would need separate, dedicated research (likely covered by a parallel researcher on this task) to close this gap fully.
- Could not confirm whether Backed Finance's own canonical/official xStocks reference price (as opposed to third-party integrations like Edel's or BNB Chain's planned Venus/Flux integration) is sourced from Pyth, Chainlink, an internal proprietary feed, or some combination — the "oracle feeds" field referenced in the xStocks public API was not resolved to a named vendor in this pass.

---

## Are there published comparisons, dashboards, or research directly comparing prices/liquidity across bStocks, Ondo, and xStocks for the same stock?

### Takeaway
Yes, at least two purpose-built, publicly available (open-source) comparison tools exist — "Nett" and "Statera" — plus official individual Dune Analytics dashboards for xStocks and Ondo Global Markets separately; a concrete, quantified real-world example (the SpaceX/SPCX tokenized-stock listings across three venues) illustrates significant price divergence between wrapper types, and mainstream financial/crypto press (Yahoo Finance) has also published "xStocks vs. Ondo" comparative coverage. No single authoritative, continuously-updated three-way (bStocks + Ondo + xStocks) live dashboard from a major analytics firm (e.g., DefiLlama or a flagship Dune dashboard explicitly comparing all three) was found — the closest things are the individual-protocol Dune dashboards and the small, independent open-source tools.

### Cited Findings
- "The same US stock trades on BNB Smart Chain as up to three different tokens — Ondo, xStocks and bStock — each with its own price, share multiplier, trading hours, liquidity and execution path... Nett resolves a stock to every version, prices each one by what your money actually buys, refuses the versions that are unsafe, and lets you buy the best one from your own wallet." — [github.com/nftkingiii/nett](https://github.com/nftkingiii/nett)
- Concrete example of real cross-venue price divergence: "Within ~10 days of the SpaceX IPO, SPCX carried ~$76M of tokenized value across three venues (bStocks $42M, xStocks $24M, Ondo $10M) while the same share priced from $122 to $176 depending on venue type" — [source context: search-aggregated, drawn from the Nett/related GitHub documentation](https://github.com/nftkingiii/nett)
- Official individual Dune dashboards exist: xStocks at [dune.com/xstocks](https://dune.com/xstocks), and bStocks-specific queries such as "bStocks Dashboard — Binance CEX Volume by bStock" ([dune.com/queries/7852397](https://dune.com/queries/7852397)), "bStocks Dashboard — Daily Volume by Token" ([dune.com/queries/7844288](https://dune.com/queries/7844288)), and "bStocks Daily Volume + Chart" ([dune.com/queries/7844258](https://dune.com/queries/7844258)) — these are protocol-specific, not explicitly three-way comparative, dashboards. — [Dune, via search results](https://dune.com/queries/7844258)
- Ondo has an official Dune dashboard at [dune.com/ondo/ondo-global-markets](https://dune.com/ondo/ondo-global-markets) (per search-result summary). — [search results](https://dune.com/ondo/ondo-global-markets)
- Yahoo Finance published a direct comparative piece: "xStocks vs. Ondo: Tokenized Stock Listings by Exchange." — [Yahoo Finance](https://finance.yahoo.com/news/xstocks-vs-ondo-tokenized-asset-132806058.html)
- BingX published an explainer comparison: "Ondo Global Markets vs. xStocks: Which Tokenized Stock Platform Is Better." — [BingX](https://bingx.com/en/learn/article/ondo-global-markets-vs-xstocks-which-tokenized-stock-platform-is-better)
- CoinMarketCap hosted an event/page titled "Tokenized Stocks: The Venue Landscape," comparing CEX vs. on-chain tokenized-stock venues generally. — [CoinMarketCap](https://coinmarketcap.com/events/tokenized-stocks-cex-vs-onchain/)
- "Statera" (a second, independent open-source tool) documents close price agreement between raw xStocks pools and an independent OKX benchmark once share multipliers are normalized (NVDA and SPY within ~2 bps), providing a rare quantified "these wrappers are technically trackable/consistent, when adjusted correctly" data point, though this tool's public documentation focuses on xStocks specifically (raw vs. wrapped ERC-4626 vault form) rather than a three-way bStocks/Ondo/xStocks comparison. — [github.com/seekdaseek/statera](https://github.com/seekdaseek/statera)

### Inferences
- The existence of two small, independently-authored open-source tools (Nett, Statera) built specifically to solve "which wrapper version of this stock should I trust/buy" strongly suggests this is a recognized, real pain point in the tokenized-equities space as of 2026, but it is not yet served by a mainstream, well-known analytics platform (DefiLlama, a major Dune dashboard, or a named research firm) with a dedicated three-way comparison product — the tooling that exists appears to be community/hackathon-scale rather than institutional-scale.
- The SPCX example (bStocks $42M vs. xStocks $24M vs. Ondo $10M in tokenized value, with per-share prices ranging $122–$176 across venues within ~10 days of IPO) is a strong, concrete illustration that these wrappers are *not* fungible or reliably arbitraged against each other in practice, at least in early/volatile listing periods — reinforcing the earlier finding that cross-wrapper "prices" require careful normalization (by multiplier) and independent benchmarking rather than naive equivalence.

### Gaps
- Could not verify the primary source/publication date of the specific SPCX $76M/$122–$176 statistic — it was surfaced via search-result summarization tied to the Nett GitHub repo context rather than fetched from a dated, named report; the report writer should treat this figure as sourced-but-not-independently-time-stamped and ideally re-verify against the original repo/README directly if precision matters.
- Did not find any DefiLlama-branded or other major analytics-firm dashboard that explicitly, natively compares bStocks vs. Ondo vs. xStocks side-by-side for the same ticker; if such a dashboard exists, it was not surfaced by the queries run in this research pass, and it should be considered plausible that no such mainstream unified dashboard exists as of September 2026.
- Given the assignment's scope was primarily xStocks-focused, deep dedicated research directly on bStocks' and Ondo's own official documentation/architecture was not conducted here — a parallel/adjacent researcher covering those two products specifically should be consulted to fill out the full three-way comparison.

---

## Overall Notes on Source Reliability for This File

- Several findings above were obtained via WebFetch's automated single-page summarization (a "small fast model" reading page content), not by directly reading raw HTML/API responses — where this is the case, it has been flagged explicitly ("per search summary" / "via search summary") so the report writer can weight confidence accordingly and re-verify high-stakes figures (e.g., exact TVL numbers, exact chain lists, exact dates) directly if precision is required.
- Two direct WebFetch attempts failed outright: `https://defillama.com/protocol/xstocks` (DNS resolution error) and `https://www.bitget.com/...` article URLs (DNS resolution error), and `https://www.businesswire.com/...` (HTTP 403 Forbidden) — in each case, the relevant facts were instead sourced from WebSearch result snippets/summaries referencing those same URLs, which is noted inline above.
- The clearest, most load-bearing unresolved tension in this file is: **official xStocks developer docs (docs.xstocks.fi) do not name BNB Smart Chain among supported chains, while BNB Chain's own official blog and a joint BusinessWire press release with Kraken and Backed clearly state xStocks launched on BNB Chain as BEP-20 tokens.** Both sets of sources are treated as credible; the discrepancy itself (rather than a guess at which is "right") is the key finding to carry into the final report.
