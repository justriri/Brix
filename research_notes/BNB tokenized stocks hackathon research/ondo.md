# Ondo Finance Tokenized Stocks / Equities — BNB Smart Chain Research (as of Sept 2026)

## Does Ondo Finance offer tokenized US equities/stocks, and under what product name?

### Takeaway
Yes. Ondo Finance's equity product is called **Ondo Global Markets** (branded "OGM" / "GM"), issued by **Ondo Global Markets (BVI) Limited**; the product/brand was **rebranded to "Ondo Stocks"** around July 2026. This is a distinct product line from Ondo's tokenized US Treasury/yield products (OUSG, USDY), which are NOT equities and are out of scope here.

### Cited Findings
- Ondo Global Markets is "a tokenization platform designed to provide onchain exposure to publicly traded securities," letting non-US investors access thousands of US-listed stocks and ETFs — [Ondo Docs: Overview](https://docs.ondo.finance/ondo-global-markets/overview) (via search-cache extraction)
- The issuer of Ondo tokenized stocks is **Ondo Global Markets (BVI) Limited** — [Ondo Docs: Overview](https://docs.ondo.finance/ondo-global-markets/overview)
- Ondo rebranded "Ondo Global Markets" to "**Ondo Stocks**," positioning it as "the front door for tokenized U.S. equities" — [Genfinity, Jul 13 2026](https://genfinity.io/2026/07/13/ondo-global-markets-becomes-ondo-stocks-tokenized-equities-leader/)
- Product landing pages exist at `ondo.finance/global-markets` and `ondo.finance/ondo-stocks`; docs at `docs.ondo.finance/ondo-global-markets/*` — [Ondo Stocks](https://ondo.finance/ondo-stocks); [Ondo Docs index via search](https://docs.chain.link/data-feeds/tokenized-equity-feeds/ondo)
- Ondo Global Markets launched publicly on Ethereum in **September 2025**, described as "the largest launch of tokenized stocks" — [MarketsMedia](https://www.marketsmedia.com/ondo-global-markets-makes-largest-launch-of-tokenized-equities/); [Ondo blog, "Global Markets is Live"](https://ondo.finance/blog/global-markets-is-live)
- Tokens track individual stocks (e.g., Tesla, Nvidia, Apple, Figma, Baidu), indexes (QQQ, SPY), and fixed-income ETFs (TLT, TIP, AGG) — [Ondo Docs: Available Assets](https://docs.ondo.finance/ondo-global-markets/available-assets)
- Ondo's tokenized Treasury/yield products **OUSG** and **USDY** are separate, non-equity products (short-term US Treasuries / money-market exposure) and are explicitly distinguished in Ondo's own docs disclaimers — [Ondo Docs: Important Notes](https://docs.ondo.finance/ondo-global-markets/important-notes)

### Inferences
- None needed; this is directly confirmed by primary sources.

### Gaps
- None — product existence and naming are well documented.

---

## Is any Ondo tokenized-stock product actually deployed on BNB Smart Chain (BSC)?

### Takeaway
Yes — confirmed. Ondo Global Markets/Ondo Stocks is live and natively deployed on **BNB Smart Chain**, not merely bridged, alongside Ethereum and Solana. It launched on BSC on **October 29, 2025**.

### Cited Findings
- "Ondo Global Markets is now live on BNB Chain; giving users onchain access to over 100 US stocks and ETFs" — [BNB Chain official blog](https://www.bnbchain.org/en/blog/ondo-global-markets-brings-100-tokenized-u-s-stocks-etfs-to-bnb-chain)
- BNB Chain launch date: **October 29, 2025** — [The Block](https://www.theblock.co/post/376692/ondo-global-markets-expands-bnb-chain); [CoinDesk](https://www.coindesk.com/business/2025/10/29/ondo-brings-tokenized-u-s-stocks-to-bnb-chain-as-market-doubles-to-usd700m)
- "Ondo Finance's full suite of more than 100 tokenized U.S. equities, exchange-traded funds and other funds will soon be available on BNB Chain" — [The Defiant](https://thedefiant.io/news/blockchains/bnb-chain-to-host-ondo-finances-tokenized-u-s-stocks-suite-f06b1dd0)
- Ondo's own docs confirm: "Currently available on three blockchains: Ethereum, BNB Chain, and Solana," with tokens also "transferable to HyperEVM via bridge" — [Ondo Docs: Overview](https://docs.ondo.finance/ondo-global-markets/overview)
- As of the $1B TVL milestone (May 11, 2026), the platform "operates across three major blockchains: Solana, Ethereum, and BNB Chain" — [Yahoo Finance](https://finance.yahoo.com/markets/crypto/articles/ondo-global-markets-tops-1b-103215556.html)
- PancakeSwap (BNB Chain's leading DEX) is the trading venue integrated for Ondo Stocks liquidity on BSC — [BNB Chain blog](https://www.bnbchain.org/en/blog/ondo-global-markets-brings-100-tokenized-u-s-stocks-etfs-to-bnb-chain); [Structured Retail Products](https://www.structuredretailproducts.com/insights/81674/ondo-brings-tokenised-stocks-to-bnb-chain-via-pancakeswap)

### Inferences
- BSC deployment is a genuine multi-chain native issuance (each chain has its own token contracts and core infrastructure contracts, per Ondo's addresses documentation), not a wrapped/bridged-only representation of the Ethereum tokens — inferred from the existence of BSC-specific `GMTokenManager`, `GMIssuerManager`, `USDon`, and `SyntheticSharesOracle` contract addresses (see contract section below).

### Gaps
- No gap; BSC deployment is well-confirmed by BNB Chain's own blog plus multiple independent outlets and Ondo's own docs.

---

## Which specific tickers are on BSC, with contract addresses (BscScan)?

### Takeaway
Ondo Stocks uses an "**on**" ticker suffix convention (e.g., TSLA → **TSLAon**, AAPL → **AAPLon**, NVDA → **NVDAon**). Core BSC infrastructure contract addresses are documented by Ondo; one individual stock-token address (AAPLon) was directly found on BscScan. Ondo states the full list of 100+ individual token addresses per chain is published as a CSV/linked list on its docs site, which could not be fully enumerated in this research pass.

### Cited Findings
- Naming convention: "Ondo Stocks are designated by the 'on' suffix at the end of the stock ticker—for example, the stock ticker for Tesla is TSLA, so the corresponding Ondo tokenized stock is called TSLAon" — [search-cache summary citing CoinMarketCap/Ondo sources](https://coinmarketcap.com/currencies/tesla-tokenized-stock-ondo/)
- **AAPLon (Apple, Ondo Tokenized)** BEP-20 contract on BSC: `0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4` — [BscScan](https://bscscan.com/token/0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4)
- **NVDAon** (Nvidia) exists as a tokenized asset with ~$39.1M value noted at time of search snapshot — [CoinGecko/Ondo tokenized assets category](https://www.coingecko.com/en/categories/ondo-tokenized-assets)
- **TSLAon** (Tesla) exists as a live token — [CoinMarketCap](https://coinmarketcap.com/currencies/tesla-tokenized-stock-ondo/); [CryptoSlate](https://cryptoslate.com/coins/tesla-tokenized-stock-ondo/)
- Core BNB Chain (BSC) infrastructure contracts per Ondo's official addresses documentation:
  - **GMTokenManager**: `0x91f8Aff3738825e8eB16FC6f6b1A7A4647bDB299` (mint/redeem of Ondo Stocks)
  - **GMIssuerManager**: `0x341f9e6463161F0C90037Cbc0150DC54e6d1e06e`
  - **USDon**: `0x1f8955E640Cbd9abc3C3Bb408c9E2E1f5F20DfE6` (the settlement/swap token used to mint/redeem Ondo Stocks)
  - **SyntheticSharesOracle**: `0xF4Fd8a1B412633e10527454137A29Db7Aa35F15e` (multiplier for shares-per-token adjustments)
  - **GMTokenLimitOrder**: `0x96b525B1a93f31E65F4aAf18C53842eD28525D48` (limit order contract)
  — [Ondo Docs: Addresses](https://docs.ondo.finance/addresses)
  - **Caveat**: these five addresses were extracted via an automated page-summary tool (WebFetch) rather than viewed as raw HTML; they should be spot-checked directly on BscScan before being treated as final/production values in any downstream deliverable.
- Ondo's own docs state individual per-asset token contract addresses (the 100+ stock/ETF tokens) are provided via an external CSV/linked resource rather than being listed inline in docs text — [Ondo Docs: Addresses](https://docs.ondo.finance/addresses)
- Full asset list and live per-token pages available at the app: `app.ondo.finance` (e.g., `https://app.ondo.finance/assets/aaplon`) — [Ondo App](https://app.ondo.finance/assets/aaplon)

### Inferences
- Because Ondo runs the same core `GMTokenManager` / `GMIssuerManager` / oracle architecture on each chain with chain-specific addresses, it is likely (not confirmed for every ticker) that most/all of the 100+ stocks and ETFs available on Ethereum are mirrored on BSC using the same "on"-suffixed symbol, given BNB Chain's blog states "the full suite of more than 100 tokenized U.S. equities, exchange-traded funds and other funds" is available — [BNB Chain blog](https://www.bnbchain.org/en/blog/ondo-global-markets-brings-100-tokenized-u-s-stocks-etfs-to-bnb-chain). This has not been independently verified ticker-by-ticker.

### Gaps
- A complete, verified BSC-specific ticker-to-contract-address table (all 100+ tokens) was **not** obtained in this research pass. Ondo's docs point to a CSV/external list rather than inline text, and that CSV was not retrieved. Recommend the report writer flag that a full list requires either (a) direct retrieval of `docs.ondo.finance/addresses` in a browser/raw HTTP fetch (automated summarization tools truncated/interpreted the page rather than returning the raw table), or (b) querying BscScan/DeFiLlama/CoinGecko's "Ondo Tokenized Assets" category page directly.
- Could not confirm whether every Ethereum-listed ticker has a BSC equivalent, or whether BSC has a smaller subset.

---

## Token/contract standard, custody model, is it synthetic/wrapped and backed by real shares?

### Takeaway
On BSC, Ondo Stocks tokens are **BEP-20** (BSC's ERC-20-equivalent standard; confirmed directly via BscScan token pages), and Ondo's docs describe the general standard across chains as "ERC20 compliant." Each token is described as **fully backed 1:1 by the underlying security plus cash-in-transit**, held via a **special purpose vehicle (SPV)** with assets at regulated US custodians/broker-dealers, with **overcollateralization** required at all times and a third-party security agent holding first-priority security interest.

### Cited Findings
- "Ondo's tokenized stocks are ERC20 compliant and transferable, so they can be held by any smart contracts or other externally owned accounts or wallets" — [Ondo Docs, via search-cache](https://docs.ondo.finance/ondo-global-markets/overview)
- On BscScan, Apple's Ondo token is explicitly labeled a **"BEP-20 Token"** — [BscScan: AAPLon](https://bscscan.com/token/0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4)
- "Ondo tokenized stock smart contracts have been rigorously tested and have undergone independent audits by Spearbit and Cyfrin to ensure code integrity and protocol safety" — [search-cache citing Ondo docs](https://docs.ondo.finance/ondo-global-markets/trust-and-transparency)
- "Ondo tokenized stocks are all fully backed by their underlying stocks and ETFs (together with cash in transit), and the issuer of Ondo tokenized stocks is required to ensure that there is additional collateral available—above and beyond this full backing—at all times to overcollateralize its obligations to tokenholders" — [Ondo Docs: Trust and Transparency](https://docs.ondo.finance/ondo-global-markets/trust-and-transparency)
- "Assets are held at regulated US entities with daily attestations. The structure features full asset backing with overcollateralization and uses a special purpose vehicle with at least one independent director. A third-party security agent maintains first-priority security interests over holdings" — [Ondo Docs: Overview](https://docs.ondo.finance/ondo-global-markets/overview)
- Product is explicitly a **synthetic/derivative economic-exposure instrument, not direct share ownership**: "Ondo Stocks provide economic exposure to underlying assets but are 'not themselves stocks, ETFs or ADRs and the Ondo Stocks do not provide their holders with rights to hold or receive their respective underlying assets'" — [Ondo Docs: Important Notes](https://docs.ondo.finance/ondo-global-markets/important-notes)
- Tokens are designed as "**total return trackers**" — reflecting both price movement and reinvested dividends — via a "shares-per-token" multiplier mechanism rather than a constant 1-token-to-1-share peg — [Ondo Docs: Overview](https://docs.ondo.finance/ondo-global-markets/overview)
- Ondo Finance launched an **in-kind conversion** feature letting institutions exchange eligible shares held in Alpaca brokerage accounts directly for Ondo Stocks tokens, on both Ethereum and BNB Chain — [KuCoin News](https://www.kucoin.com/news/flash/ondo-finance-launches-in-kind-conversion-for-tokenized-stocks-on-ethereum-and-bnb-chain)

### Inferences
- The "total return tracker" design (dividend reinvestment via multiplier rather than distribution) means the token/share ratio is not fixed at 1:1 over time — the *number of shares backing each token* changes via the `SyntheticSharesOracle` multiplier, even though value backing is maintained. This is a meaningfully different mechanic than a simple 1:1 wrapped share and should be flagged clearly to avoid mischaracterizing it as a simple custodial wrapper.

### Gaps
- Exact custodian/broker-dealer name(s) were not confirmed beyond "regulated US entities" — the specific broker-dealer(s) name was referenced by third-party coverage (in-kind conversion piece mentions **Alpaca**) but Ondo's own docs text retrieved did not name the primary custodian directly in this pass.

---

## How are prices sourced/fed on-chain (oracle provider, update frequency)?

### Takeaway
Ondo Global Markets uses **Chainlink's "Tokenized Equity" 24/5 price feeds** combined with Ondo's own on-chain **`SyntheticSharesOracle`** multiplier contract; the formula is **Token Price = Underlying Equity Market Price × Multiplier (sValue)**. Chainlink's documentation for this feed type explicitly names Base Mainnet; it does not explicitly confirm BNB Chain feed deployment in the page retrieved, which is a notable gap given BSC is a live deployment chain for the tokens themselves.

### Cited Findings
- "Token Price = Underlying Equity Market Price × Multiplier (sValue)" — [Chainlink Docs: Ondo Finance Global Markets (GM) Tokenized Equity Feeds](https://docs.chain.link/data-feeds/tokenized-equity-feeds/ondo)
- Underlying equity prices are sourced from "Chainlink's 24/5 equity price feeds, which aggregate data across regular, pre-market, post-market, and overnight trading sessions" — [Chainlink Docs: Ondo](https://docs.chain.link/data-feeds/tokenized-equity-feeds/ondo)
- The multiplier is sourced from Ondo's own **`SyntheticSharesOracle`** contract, which adjusts for "dividend reinvestments and corporate action adjustments" — [Chainlink Docs: Ondo](https://docs.chain.link/data-feeds/tokenized-equity-feeds/ondo)
- Chainlink's documentation page for this feed type, as retrieved, names **Base Mainnet** as a supported network but does not list BNB Chain/BSC-specific feed addresses, heartbeat, or deviation threshold details — [Chainlink Docs: Ondo](https://docs.chain.link/data-feeds/tokenized-equity-feeds/ondo)
- Ondo's own docs describe a separate, proprietary displayed "indicative price": "an indicative token price calculated using our proprietary pricing methodology based on prevailing market conditions," distinct from a per-trade "quote price" guaranteed for ~30 seconds that additionally factors in "order size, available inventory, market conditions" — [Ondo Docs: Token & Quote Pricing](https://docs.ondo.finance/ondo-global-markets/token-and-quote-pricing)
- BNB Chain and Solana wallets use a **"display multiplier"** to reflect changes in shares-per-token (dividend reinvestment) directly in wallet balances/pricing — [Ondo Docs: Overview](https://docs.ondo.finance/ondo-global-markets/overview); [Ondo Docs: Token & Quote Pricing](https://docs.ondo.finance/ondo-global-markets/token-and-quote-pricing)
- Ondo's `SyntheticSharesOracle` contract on BSC is deployed at `0xF4Fd8a1B412633e10527454137A29Db7Aa35F15e` — [Ondo Docs: Addresses](https://docs.ondo.finance/addresses)

### Inferences
- Given BSC has its own on-chain `SyntheticSharesOracle` deployment, it is likely that Chainlink (or an equivalent 24/5 equity feed) also supplies the base equity price component on BSC, even though this wasn't explicitly confirmed in the Chainlink docs page retrieved — this should be verified further, e.g. by checking Chainlink's BNB Chain data feed directory directly.

### Gaps
- **Exact update frequency/heartbeat and deviation threshold** for the price feeds were not disclosed in either Chainlink's or Ondo's documentation as retrieved.
- **Explicit confirmation that Chainlink feeds (vs. some other oracle) supply BSC equity pricing** was not found — Chainlink's docs page names Base Mainnet, not BNB Chain, for this specific feed type, which is a real discrepancy worth flagging rather than assuming.

---

## Is historical price data available, and how?

### Takeaway
Yes, limited historical data is available via Ondo's own REST API (24-hour price history) and via third-party trackers (CoinGecko, CoinMarketCap, CryptoSlate) for the tokenized stock tickers; full multi-year OHLC history akin to traditional stock data was not confirmed as available through Ondo's own API in this research pass.

### Cited Findings
- Ondo's official API includes an endpoint `GET https://api.gm.ondo.finance/v1/assets/{symbol}/market` (e.g., symbol `AAPLon`) that returns, among other fields, `priceHistory24h` (array of timestamp+price pairs) for the "primary market" (on-chain token), plus underlying-market fields like `priceHigh52w`/`priceLow52w` — [Ondo Docs: Get Market Data for an Asset](https://docs.ondo.finance/api-reference/assets/get-market-data-for-an-asset)
- Ondo's API overview references broader "OHLC historical data for charting and analytics" as a stated capability, alongside a documented OpenAPI spec at `docs.ondo.finance/openapi.json` — [Ondo Docs: API Overview](https://docs.ondo.finance/api-reference/overview)
- Third-party price-history pages exist for individual Ondo tokenized stocks, e.g. **TSLAon** — [CoinMarketCap: Tesla Tokenized Stock (Ondo)](https://coinmarketcap.com/currencies/tesla-tokenized-stock-ondo/); [CryptoSlate: TSLAon](https://cryptoslate.com/coins/tesla-tokenized-stock-ondo/) — and **AAPLon** — [CoinMarketCap: Apple Tokenized Stock (Ondo)](https://coinmarketcap.com/currencies/apple-tokenized-stock-ondo/)
- CoinGecko maintains a dedicated **"Ondo Tokenized Assets"** category aggregating these tokens — [CoinGecko](https://www.coingecko.com/en/categories/ondo-tokenized-assets)

### Inferences
- The `get-market-data-for-an-asset` endpoint's `priceHistory24h` field, as documented, appears limited to a rolling 24-hour window rather than deep historical OHLC series; a separate, less-documented endpoint may provide fuller OHLC per the API overview's mention of "OHLC historical data," but its exact path/parameters were not found.

### Gaps
- The exact endpoint(s) providing multi-day/multi-year OHLC history (if any) were not located — the API overview mentions the capability but the specific endpoint path was not retrieved in this pass.
- Whether historical price data differs or is chain-specific (BSC vs. Ethereum vs. Solana token instances of the same ticker) was not confirmed.

---

## Is on-chain liquidity data available (DEX pools on BSC, TVL)?

### Takeaway
Yes. Ondo Global Markets is tracked on DeFiLlama with an aggregate TVL figure, and BNB Chain liquidity is provided primarily via **PancakeSwap** pools; reported combined (Ethereum) TVL reached $350M+ shortly after the September 2025 launch, and the platform crossed **$1 billion in total TVL** across all chains by May 2026, with 70%+ market share of tokenized-equity issuance.

### Cited Findings
- Ondo Global Markets has a dedicated DeFiLlama protocol page (aggregate TVL & volume tracker) — [DeFiLlama: Ondo Global Markets](https://defillama.com/protocol/ondo-global-markets) (page could not be fetched directly in this session due to a network/DNS error; existence confirmed via search results only — **treat the specific numeric TVL figures below as secondary/unverified from a primary DeFiLlama fetch**)
- PancakeSwap (described as "BNB Chain's leading decentralized exchange") is the integrated DEX for trading Ondo Stocks on BSC, providing "instant settlement, transparent custody, and no intermediaries" — [BNB Chain Blog](https://www.bnbchain.org/en/blog/ondo-global-markets-brings-100-tokenized-u-s-stocks-etfs-to-bnb-chain)
- "PancakeSwap taps Ondo to integrate real-world assets (RWAs)" — [Bitget News](https://www.bitget.com/amp/news/detail/12560605037758)
- Ethereum-launch TVL reached **$350 million** within weeks (September 2025), with **$669 million** cumulative on-chain trading volume by the time of the BNB Chain expansion announcement (Oct 29, 2025) — [The Block](https://www.theblock.co/post/376692/ondo-global-markets-expands-bnb-chain); [CoinDesk](https://www.coindesk.com/business/2025/10/29/ondo-brings-tokenized-u-s-stocks-to-bnb-chain-as-market-doubles-to-usd700m)
- CoinDesk's Oct 29, 2025 headline states the broader tokenized-stock market "doubles to $700M" coinciding with the BNB Chain launch — [CoinDesk](https://www.coindesk.com/business/2025/10/29/ondo-brings-tokenized-u-s-stocks-to-bnb-chain-as-market-doubles-to-usd700m)
- By **May 11, 2026**, Ondo Global Markets surpassed **$1 billion in TVL** across Solana, Ethereum, and BNB Chain, with over **$18 billion cumulative trading volume**, and TVL "doubled since January 2026" — [Yahoo Finance / PR Newswire coverage](https://finance.yahoo.com/markets/crypto/articles/ondo-global-markets-tops-1b-103215556.html); [PR Newswire](https://www.prnewswire.com/news-releases/ondo-global-markets-surpasses-1-billion-in-total-value-locked-a-first-for-tokenized-stocks-302768520.html)
- Search-tool summaries (not independently verified against primary source HTML) reported a specific BSC-only TVL figure of **~$325.9 million** and overall platform TVL of **~$962.64 million** at the time of a particular DeFiLlama snapshot — these numbers came from an automated search-result summary citing DeFiLlama and crypto.news, not from a directly fetched primary page, so **treat as unverified/approximate** — [crypto.news](https://crypto.news/ondo-global-markets-pushes-rwa-adoption-to-bnb-chain/); [DeFiLlama](https://defillama.com/protocol/ondo-global-markets)

### Inferences
- BSC's share of total Ondo Global Markets TVL is meaningful (roughly a third of total TVL per the unverified snapshot figure) but should be re-confirmed directly on DeFiLlama or dexscreener before being used as a hard data point.

### Gaps
- Could not directly fetch DeFiLlama (network error: `getaddrinfo ENOTFOUND defillama.com` / HTTP 403 on retry) or Dexscreener in this session to independently verify current BSC-specific TVL or individual pool addresses/liquidity depth. The report writer should re-attempt these fetches or note the figures above as approximate/secondary-sourced.
- No specific PancakeSwap pool contract addresses were identified for individual Ondo Stocks tokens (e.g., AAPLon/USDon pool address) in this pass.

---

## Is market open/closed status exposed anywhere?

### Takeaway
Ondo's API references a market-session concept ("tradableSessions" field and a referenced "Get Current Market Status" capability), and disclosures explicitly describe differentiated behavior during "off-hours" (lower liquidity, wider spreads) — but the exact public endpoint for real-time open/closed status was not directly confirmed/retrieved, and trading itself is stated to run 24/5 regardless of the underlying market's actual session.

### Cited Findings
- The "Get Market Data for an Asset" API response includes a `tradableSessions` field ("indicates which periods support trading for specific assets") — [Ondo Docs: Get Market Data for an Asset](https://docs.ondo.finance/api-reference/assets/get-market-data-for-an-asset)
- That same documentation references a separate, named capability/endpoint — **"Get Current Market Status"** — for session information, though its exact path was not retrieved directly in this pass — [Ondo Docs: Get Market Data for an Asset](https://docs.ondo.finance/api-reference/assets/get-market-data-for-an-asset)
- Ondo's disclosures state that during "off-hours" trading sessions (i.e., when the underlying equity market is closed), "liquidity is typically lower; bid-ask spreads are typically wider," with "conservative position limits," and tokens "may diverge more significantly from the value of its underlying security" — [Ondo Docs: Important Notes](https://docs.ondo.finance/ondo-global-markets/important-notes)
- Overall, Ondo Stocks trading is marketed as continuous: "Trading runs 24 hours a day, five days a week" (24/5) — [search-cache summary of Ondo materials](https://finance.yahoo.com/markets/crypto/articles/ondo-global-markets-tops-1b-103215556.html)
- The underlying Chainlink price feed itself is explicitly built to span sessions: "aggregate data across regular, pre-market, post-market, and overnight trading sessions" — [Chainlink Docs: Ondo](https://docs.chain.link/data-feeds/tokenized-equity-feeds/ondo)

### Gaps
- The exact endpoint path/schema for a standalone "Get Current Market Status" API call was referenced but not retrieved directly — this should be confirmed by fetching `docs.ondo.finance/openapi.json` or browsing the full API reference tree directly (raw HTML/JSON, not summarized).
- No on-chain (smart contract) boolean flag or similar public on-chain signal for "market open/closed" was identified on BSC specifically; the mechanism appears to live at the API/oracle layer (via the equity feed's data + session-aware quoting) rather than as an explicit on-chain state variable that was documented.

---

## Are there official public APIs for Ondo's tokenized stock prices/data?

### Takeaway
Yes — Ondo operates an official REST API at `api.gm.ondo.finance` (API-key gated) plus a documented streaming/gRPC interface using Protocol Buffers, both aimed at pricing, quoting, token lifecycle (mint/redeem attestations), and contract metadata. A full OpenAPI spec is published.

### Cited Findings
- REST endpoint example: `GET https://api.gm.ondo.finance/v1/assets/{symbol}/market`, requiring an `x-api-key` header — [Ondo Docs: Get Market Data for an Asset](https://docs.ondo.finance/api-reference/assets/get-market-data-for-an-asset)
- Response includes both "primary market" (on-chain token: price, 24h change, 24h price history, total holders, sharesMultiplier, tradableSessions) and "underlying market" (off-chain stock: ticker, name, price, 52-week high/low, volume, average volume, shares outstanding, market cap) data, plus `constituentTokens` for multi-asset/portfolio tokens — [Ondo Docs: Get Market Data for an Asset](https://docs.ondo.finance/api-reference/assets/get-market-data-for-an-asset)
- Ondo's API overview describes a "REST API Specification" offering "high-performance request/response access to essential pricing, quote generation, token lifecycle, and token contract metadata," with the authoritative endpoint catalog at `docs.ondo.finance/openapi.json`, plus a "Streaming API" using a Protocol Buffers schema for real-time updates via gRPC — [Ondo Docs: API Overview](https://docs.ondo.finance/api-reference/overview)
- The API documentation does not explicitly state whether/how responses differentiate the same ticker's token instance across chains (BSC vs. Ethereum vs. Solana) — [Ondo Docs: API Overview](https://docs.ondo.finance/api-reference/overview)

### Gaps
- Could not confirm whether the API is fully public/self-serve (how an API key is obtained) or restricted to partners/institutions — access-tier details were not found in this pass.
- Could not confirm whether the API's `symbol` parameter or a chain parameter is used to distinguish, e.g., BSC-AAPLon from Ethereum-AAPLon, if both exist as the same symbol on different chains.

---

## Documented pause/freeze/compliance-restriction mechanisms (KYC/whitelist-gated transfers)

### Takeaway
Ondo enforces extensive **legal/contractual** KYC, geographic, and investor-eligibility restrictions on who may subscribe for or redeem Ondo Stocks — including a full ban on US persons and a long list of sanctioned/restricted jurisdictions — but the specific **on-chain smart-contract enforcement mechanism** (e.g., a whitelist/blocklist function, freeze/pause modifier, or transfer-restriction hook in the BEP-20 contract) was **not documented in the pages retrieved**, despite tokens being described elsewhere as "ERC20 compliant and transferable" and holdable "by any smart contracts or other externally owned accounts or wallets" — suggesting restrictions may be enforced primarily at the issuance/redemption (off-chain/KYC) layer rather than via on-chain transfer blocking, but this is not confirmed either way.

### Cited Findings
- Full prohibition on subscription/redemption for persons/entities in or organized under the laws of: **Afghanistan, Belarus, Cuba, Iran, Libya, Myanmar, Russia, Somalia, South Sudan, Sudan, Syria, Democratic Republic of Korea (North Korea), Canada, Crimea and specified Ukrainian regions, the United States and all its territories**, and any "U.S. person" as defined by Regulation S under the Securities Act of 1933 — [Ondo Docs: Eligibility](https://docs.ondo.finance/ondo-global-markets/eligibility)
- Entities where "Prohibited Persons" hold 50%+ beneficial ownership are also barred — [Ondo Docs: Eligibility](https://docs.ondo.finance/ondo-global-markets/eligibility)
- Conditional access requiring investor-qualification status in: **Brazil** (Qualified/Professional Investor per CVM Resolution No. 30), **EEA member states** (Professional Client/Qualified Investor under MiFID II/Prospectus Regulation), **Hong Kong** (Professional Investor), **Malaysia** (Sophisticated Investor), **Singapore** (Accredited/Institutional Investor under SFA), **Switzerland** (Professional/Institutional Client only — individuals excluded), **United Kingdom** (Professional Client/Qualified Investor under MiFID II) — [Ondo Docs: Eligibility](https://docs.ondo.finance/ondo-global-markets/eligibility)
- "Restricted Persons generally will be required to produce evidence that they satisfy the applicable eligibility requirements and to certify or declare their eligible status," and the issuer applies "non-jurisdiction-related eligibility criteria in accordance with its know-your-customer policies, procedures and practices" — [Ondo Docs: Eligibility](https://docs.ondo.finance/ondo-global-markets/eligibility)
- Ondo secured regulatory clearance/approval enabling access across **30 European countries (EU/EEA)**, potentially reaching 500 million+ investors, and has filed confidentially with the U.S. SEC for registration — [Yahoo Finance coverage of $1B TVL milestone](https://finance.yahoo.com/markets/crypto/articles/ondo-global-markets-tops-1b-103215556.html)
- Tokens are marketed as "ERC20 compliant and transferable, so they can be held by any smart contracts or other externally owned accounts or wallets" — i.e., no explicit mention of on-chain whitelist-gating for general transfers between already-holding wallets — [Ondo Docs, via search-cache](https://docs.ondo.finance/ondo-global-markets/overview)
- The eligibility documentation page retrieved contains **no information about smart-contract-level enforcement** (no mention of whitelists, blocklists, freeze functions, or permissioned-transfer hooks) — this was explicitly noted as absent by the fetch tool when queried directly — [Ondo Docs: Eligibility](https://docs.ondo.finance/ondo-global-markets/eligibility)

### Inferences
- Based on available evidence, KYC/eligibility gating for Ondo Stocks appears to be enforced primarily at the **primary-market subscription/redemption layer** (i.e., who can mint/redeem via Ondo's own issuance process, likely gated off-chain/at the API or onboarding layer) rather than via an on-chain transfer-restriction mechanism baked into the BEP-20/ERC-20 contract itself, since docs explicitly describe general transferability to "any" wallet or smart contract. This is an inference, not a confirmed fact — it directly contradicts the premise in the task's key questions that Ondo is "known for KYC/whitelist-gated transfers," and this discrepancy should be flagged prominently to the report writer rather than silently resolved.

### Gaps
- **No documentation was found confirming an on-chain whitelist/freeze/pause mechanism** in the BEP-20 (or ERC-20/SPL) Ondo Stocks token contracts themselves. This is a significant, explicit gap given it was a specific question asked. It's possible such a mechanism exists in the actual verified contract source on BscScan (e.g., a `blacklist`/`isBlocked` mapping or `pause()` function) — but this was not confirmed by reading contract source code or a technical/security-focused doc page in this research pass. Recommend the report writer or a follow-up researcher directly inspect the verified source code of the BSC token contracts (e.g., AAPLon at `0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4`) on BscScan for transfer-restriction logic before making any claim either way.

---

## Documented stale-price/abnormal-price incidents or audit findings

### Takeaway
No documented stale-price, oracle-manipulation, or depeg incident specific to Ondo Global Markets/Ondo Stocks was found. Ondo has an active, extensive multi-firm audit program specifically covering the Global Markets (GM) product line, but specific vulnerability findings from those audits were not disclosed in the summary sources retrieved.

### Cited Findings
- Ondo Stocks/Global Markets-specific audits identified: **Cantina** (Aug 2026 — Ondo Stocks; Jul 2026 — Ondo Stocks; Feb 2026 — GM Limit Order Protocol; Dec 2025 — Ondo general & GM Limit Order Protocol; Nov 2025 — GM Synthetic Shares; Oct 2025 — GM USD Converter & Bridge Registrar), **Zellic** (Dec 2025 — GM Solana), **FYEO** (Nov 2025 and Sep 2025 — GM Solana), **Cyfrin** (Jul 2025 — GM v2.0), **Spearbit** (Jun 2025 — Ondo general) — [Ondo Docs: Audits](https://docs.ondo.finance/audits)
- Separately, Ondo's Funds & USDY product line (non-equity) has its own audit history going back to 2023 (Code4rena, Zokyo, NetherMind, Cyfrin, Halborn, Spearbit) — [Ondo Docs: Audits](https://docs.ondo.finance/audits)
- Ondo maintains an active bug bounty program "exceeding $500,000 for critical vulnerability discovery" — [search-cache summary, presumably citing Ondo/Immunefi materials](https://docs.ondo.finance/audits)
- A full Cyfrin audit report PDF (April 2024, for the Funds/USDY line, not Global Markets) is publicly hosted — [Ondo-Cyfrin-Audit-April-2024.pdf](https://docs.ondo.finance/pdf/Ondo-Cyfrin-Audit-April-2024.pdf)
- No news articles, audit summaries, or security-incident trackers describing an actual stale-price event, oracle failure, or depeg specific to Ondo Global Markets/Ondo Stocks were surfaced by search — [search results reviewed, no qualifying source found]

### Gaps
- No primary audit report content (specific findings/severity) for any of the GM-specific audits (Cantina, Zellic, FYEO, Cyfrin GM v2.0) was retrieved — only the existence/date/scope metadata from the audits index page.
- No confirmation either way on whether any stale-price or abnormal-pricing incident has occurred; absence of search results is treated here as "not found," not as proof no such incident exists.

---

## How is the same underlying stock ticker identified/mapped across Ondo vs other wrappers?

### Takeaway
Ondo uses its own proprietary, informal naming convention (ticker + "**on**" suffix, e.g. AAPLon, TSLAon, NVDAon) to identify its tokenized stocks; no evidence was found of a standardized, cross-issuer identifier scheme (e.g., a shared CAIP-style asset ID or ISIN-based on-chain standard) that maps the same underlying equity consistently across Ondo's tokens and other tokenized-stock issuers' wrappers (e.g., Backed Finance's "xStocks," Robinhood's tokenized stocks, Kraken's xStocks-based offerings).

### Cited Findings
- Ondo's naming convention appends "on" to the underlying ticker (TSLA → TSLAon, AAPL → AAPLon) — [CoinMarketCap: Tesla Tokenized Stock (Ondo)](https://coinmarketcap.com/currencies/tesla-tokenized-stock-ondo/)
- Third-party aggregators (CoinGecko, CoinMarketCap) list Ondo's tokens under names like "Apple (Ondo Tokenized) (AAPLon)" and "Tesla Tokenized Stock (Ondo)" — i.e., they disambiguate by appending "(Ondo)" or "(Ondo Tokenized)" to distinguish from other issuers' tokenized versions of the same stock, rather than relying on any shared on-chain standard identifier — [CoinGecko](https://www.coingecko.com/en/coins/baidu-ondo-tokenized-stock); [CoinMarketCap](https://coinmarketcap.com/currencies/apple-tokenized-stock-ondo/)
- Ondo's own API uses the "on"-suffixed symbol as the primary key/path parameter for its REST API (`/v1/assets/{symbol}/market`, e.g. `AAPLon`) with an "underlying market" sub-object carrying the plain `ticker` (e.g. "AAPL") and `name` fields to map back to the real-world security — [Ondo Docs: Get Market Data for an Asset](https://docs.ondo.finance/api-reference/assets/get-market-data-for-an-asset)
- RWA.xyz maintains a broader tokenized-stocks tracking page that would show multiple issuers' wrapped versions of the same underlying stock side by side, implying the market currently relies on aggregator-level manual mapping rather than a shared on-chain standard — [RWA.xyz: Stocks](https://app.rwa.xyz/stocks)

### Inferences
- There does not appear to be an industry-standard, cross-issuer on-chain identifier (akin to how stablecoins might reference a common peg standard) for tokenized equities as of this research; disambiguation currently happens informally via issuer-specific naming suffixes ("...on" for Ondo) and exchange/aggregator metadata (e.g., "(Ondo Tokenized)" labels), not a shared registry or standard. This is an inference based on absence of evidence for a standard, not a confirmed negative.

### Gaps
- Could not confirm definitively whether any standards body (e.g., a token standard like ERC-3643, ISIN-linked on-chain metadata, or a DeFiLlama/RWA.xyz internal taxonomy) is used to canonically map "AAPL-the-real-stock" across Ondo's AAPLon, Backed's xStocks AAPL wrapper, Robinhood's tokenized AAPL, etc. This would require dedicated research into RWA.xyz's or DeFiLlama's internal data schema, which was out of scope/budget for this pass.

---

## Summary of Overall Confidence and Known Data-Quality Caveats

- Several key facts in this report (contract addresses, some TVL figures) were extracted via an automated page-summarization fetch tool rather than raw HTML/JSON, introducing some risk of transcription error or omission. Anywhere this applies is flagged inline above (e.g., BSC core contract addresses, BSC-specific TVL figure).
- `ondo.finance` and `docs.ondo.finance` domains intermittently failed to resolve/connect during this research session (DNS/connection errors on first attempts, succeeding on retry) — this is noted in case it reflects a broader access issue rather than random transience; the report writer may wish to independently re-verify critical docs pages listed here are still reachable and unchanged.
- `defillama.com` could not be fetched directly in this session (DNS error, then HTTP 403 on retry) — any DeFiLlama-sourced TVL figures above came only from third-party search-result summaries referencing DeFiLlama, not a direct read of DeFiLlama itself.
