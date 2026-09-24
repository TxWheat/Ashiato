# Code Review & Upgrade Plan

_Review date: 2026-09-24. Covers the whole codebase at `ef0ac77`, the ideas in
[pareto-xyz/tutela-app](https://github.com/pareto-xyz/tutela-app), and a survey of other open-source tracing tools._

---

## 1. Code review: current tool

### Critical (wrong results or broken features)

| # | Where | Problem | Fix |
|---|-------|---------|-----|
| C1 | `lib/eth.ts:19-24` | **ETH tracing is broken.** It calls Etherscan **V1** (`api.etherscan.io/api`), which Etherscan shut down on 15 Aug 2025. Every ETH trace fails. This is why "we only support BTC". | Switch to `https://api.etherscan.io/v2/api?chainid=1&…`. The query params stay the same. `chainid` also gives Base, Arbitrum, BSC and Polygon for free. |
| C2 | `lib/btc.ts:127-146` | **BTC incoming amounts are overcounted.** When a tx has N input addresses, each input→origin edge is given the *full* received amount. The graph shows N× the real money. | Split the amount by each input's share of total input value (or draw the tx as its own node; see §3). |
| C3 | `data/labels.json`, `lib/labels.ts` | **BTC has no entity labels at all.** All 38 labels are ETH, so exchange/mixer/scam tagging never fires on BTC. `getLabel` also lowercases, which breaks case-sensitive base58 BTC addresses. | Add BTC labels (OFAC SDN list, GraphSense TagPacks). Only lowercase `0x…` and `bc1…` keys. |
| C4 | `app/trace/page.tsx:35,406` | **The ETH origin can be deleted and loses its styling.** Node IDs are lowercased but `originAddress` comes raw from the URL. With a checksummed (mixed-case) address, `canRemove` is true for the origin and origin edges don't animate. | Normalise `originAddress` with `.toLowerCase()` for ETH. |
| C5 | `lib/btc.ts:43-61` | **Change detection gets it wrong on common cases.** (a) If the sender's own address is an output (address reuse), that is certainly the change, but the code can flag the *payment* as change. (b) "Smaller output = change" is a weak rule and often backwards. (c) It only ever handles 2-output txs. | Do (a) first. Then add round-amount, unnecessary-input, script-type and fresh-address heuristics, with a confidence score (§3). |
| C6 | `components/TxTable.tsx:141` | **You can only trace forwards.** "Follow" only shows on outputs, so there's no way to follow the *sender* of an incoming payment (source of funds). | Add Follow on input/`from` addresses too. |

### High (misleading data)

- **H1 `lib/btc.ts:65-96`: only ~15 txs are ever looked at.** It reads one page of `/address/:a/txs` and then slices to 15. It never paginates (`/txs/chain/:last_txid`). Busy addresses show a tiny, recent-only slice with no warning. Add pagination, a "showing X of Y" note and a date-range filter.
- **H2 `lib/eth.ts:13-47`: ETH tracing sees only plain ETH transfers.** It ignores ERC-20 transfers (`tokentx`: USDT/USDC is where most scam money moves) and internal txs (`txlistinternal`: contract payouts). Also, `txCount` is set to `txs.length` (max 25) but shown as "Total txs".
- **H3 `lib/eth.ts:48,34`: wei is parsed with `parseInt`.** Anything above about 0.009 ETH goes past 2^53 and loses precision. Use `BigInt` and only convert for display.
- **H4 `app/api/*/route.ts`: no validation, caching or rate limiting.** The raw path param goes straight into upstream URLs. Every expand/follow triggers new upstream calls, so Blockstream will start returning 429. Validate with `detectChain`, cache responses (`fetch(..., { next: { revalidate } })` or an LRU), and back off on 429.
- **H5 `lib/eth.ts:14`: a missing API key fails with a confusing error.** It ends up sending `apikey=undefined`. Detect this and show "Set ETHERSCAN_API_KEY".

### Medium / quality

- M1 `page.tsx:176-209`: `followAddress` saves an undo snapshot before the fetch. A failed follow still pushes a no-op undo step.
- M2 `TraceGraph.tsx:84`: the `followedEdgeIds = new Set()` default creates a new Set every render, which reruns the dagre layout every render if the prop is omitted. Hoist it to a constant.
- M3 USD/NZD values use **today's** price. Investigators and police reports need the value **at the time of the transaction**. CoinGecko `/coins/{id}/history` gives daily historical prices.
- M4 There's no way to save or export a case. Victims need a JSON save/load, a CSV of the flows and a PNG/PDF of the graph for police and exchange reports. This is the most-requested feature in tools like this.
- M5 `npm run lint` has no ESLint config (it goes into an interactive prompt). There are no tests: the heuristics in `lib/` are pure functions and easy to unit test with a few real txids.
- M6 `fmtBalance`, `fmtAmount` and `explorerUrl` are copied across 3 files. Move them to `lib/format.ts`.
- M7 `detect-chain.ts` rejects valid uppercase bech32 (`BC1Q…`).

---

## 2. What tutela-app brings (ETH ideas)

Tutela is a Python/Flask + BigQuery research tool that finds which ETH addresses belong to the same person. **It has no licence file, so we reimplement the ideas and don't copy its code or its `known_addresses.csv`.**

| Tutela idea | What it does | How it fits here |
|---|---|---|
| **Deposit-address reuse** (`src/cluster/deposit.py`, from the [FC'20 paper](https://fc20.ifca.ai/preproceedings/31.pdf)) | Exchanges give each customer a unique deposit address, which forwards to the exchange hot wallet. Every wallet that pays into the same deposit address belongs to the same customer. Match rule: same amount within 0.01 ETH, within 3200 blocks. | **The biggest win for scam cases.** It finds *which exchange account* the money landed in, which is what you take to the exchange / police for a KYC request. We can run it live for one address: find outgoing txs to an address X that quickly forwards about the same amount to a labelled exchange wallet, then label X "Deposit address → Binance". |
| **Tornado Cash: address match** | The same address deposits and later withdraws. | If a traced address hit a Tornado pool, show its withdrawals from the same pool. |
| **Tornado Cash: unique gas price** | The deposit and withdrawal use the same unusual gas price (older, pre-EIP-1559 txs). | Flag possible linked withdrawals. |
| **Tornado Cash: multi-denomination match** | The deposit pattern (e.g. 5×1 ETH + 3×0.1 ETH) matches a withdrawal pattern elsewhere. | Needs pool-wide data. Later phase. |
| **Tornado Cash: linked address** | The depositor and withdrawer transact with each other outside Tornado. | Cheap to check once both sides are in the graph. |
| **Careless TORN mining** | Claiming anonymity-mining rewards reveals how long the funds sat in the pool. | Later phase. |
| **Diff2Vec embeddings** | ML "similar wallets" search. | Needs the full chain graph. Out of scope for a live-API tool. |
| **Pool anonymity-set stats** | How many deposits in a pool are really anonymous. | Nice extra for Tornado pool pages. |

**Tutela's heuristics give a per-link confidence and a reason.** We should copy that design: every inferred link carries `{heuristic, confidence, evidence}` and the UI shows it.

---

## 3. Other open-source projects surveyed

| Project | Licence | Ideas worth taking |
|---|---|---|
| [peterzen/heuristic](https://github.com/peterzen/heuristic) | MIT | **Closest match to us (Next.js + TS, BTC).** Common-input-ownership clustering with union-find. CoinJoin fingerprints for Whirlpool, Wasabi 1/2 and JoinMarket. Change detection using script type, round numbers and unnecessary inputs. **Backward source-of-funds walk** to coinbase or an exchange. OFAC screening. 0-100 risk score (clean/low/medium/high/critical). Per-address `/api/screen` JSON. A `/methodology` page explaining limits. |
| [VincenzoImp/bitcoin-address-clustering](https://github.com/VincenzoImp/bitcoin-address-clustering) | MIT | A list of 8 heuristics: coinbase, common-input, single-in/out, consolidation, payment+change, change address, CoinJoin exclusion. A good checklist. |
| [s0md3v/Orbit](https://github.com/s0md3v/Orbit) | GPL-3 (ideas only) | Recursive crawl to depth N, keeping the top N counterparties per hop. Edge thickness = tx frequency, node size = activity. Community detection for colouring. GraphML/JSON export. |
| [TrailBit-Labs/TaintTrail](https://github.com/TrailBit-Labs/TaintTrail), [tintiron/taintedtx](https://github.com/tintiron/taintedtx) | check before use | **Taint models: Poison, Haircut, Pro-rata, FIFO, LIFO.** Answers "how much of the stolen money is in this address?" It's the core number for a recovery claim. |
| [graphsense](https://github.com/graphsense) / [graphsense-tagpacks](https://github.com/graphsense/graphsense-tagpacks) | MIT | The full open-source Chainalysis-style stack (BTC/ETH/Tron). **TagPacks** are a YAML label format that requires a source link for every tag. Use them as our BTC label source and copy the format. |
| [0xB10C/ofac-sanctioned-digital-currency-addresses](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses) | MIT | OFAC SDN addresses per chain, updated nightly. Auto-flag sanctioned addresses. |
| [dawsbot/eth-labels](https://github.com/dawsbot/eth-labels) | check before use | 170k+ EVM labels (from Etherscan) plus a free API. Would take ETH labels from 38 to 100k+. |
| [maltemoeser/address-clustering-data](https://github.com/maltemoeser/address-clustering-data) | research | Ground-truth data for testing our change heuristics. |
| [OffcierCia/On-Chain-Investigations-Tools-List](https://github.com/OffcierCia/On-Chain-Investigations-Tools-List) | list | A curated index to mine for more. |

---

## 4. Upgrade roadmap

### Phase 0: fix what's broken (about 1 day)
1. Move to Etherscan V2 with `chainid=1` (C1). **This brings ETH back.**
2. Fix C2, C4, C5a and C6. Use `BigInt` for wei (H3). Show a clear message when the API key is missing (H5).
3. Validate the API route inputs, add caching and 429 back-off (H4).
4. Set up ESLint and add unit tests for `lib/` heuristics.

### Phase 1: make BTC credible
1. **Pagination** plus a date-range filter (H1).
2. **Label pipeline:** a `data/labels/` folder holding GraphSense TagPacks + OFAC + curated tags, each with a `source`. Add a new `sanctioned` entity type (red).
3. **Common-input-ownership clustering** with union-find. Show clusters as grouped nodes, and turn it off automatically for CoinJoins.
4. **CoinJoin detection** (Wasabi/Whirlpool/JoinMarket fingerprints). Mark the node "Mixer (CoinJoin)" and stop clustering through it.
5. **Change detection v2** with a confidence score and reasons (address reuse → round amount → script type → unnecessary input → fresh address).
6. **Tx-as-node view** (optional toggle). Draw each BTC tx as a small node between its inputs and outputs, so amounts are exact and multi-input txs read correctly.

### Phase 2: ETH at the same level
1. Normal + internal + **ERC-20** (`tokentx`) transfers. Show token amounts (USDT/USDC) with the token symbol.
2. **Deposit-address detection** (the Tutela / FC'20 heuristic) → label as "Deposit address for <Exchange>".
3. Tornado Cash module: pool labels (tutela's `tornado.csv` pool list is public on-chain data; re-derive it from source), address-match and gas-price reveals.
4. Load eth-labels (after checking its licence).
5. Multi-chain EVM (Base/Arbitrum/BSC/Polygon) using the same V2 key and a chain picker.

### Phase 3: investigation workflow
1. **Taint / amount tracking:** pick a "stolen" tx and push the value forward with Haircut (default) or FIFO. Show "X BTC of the stolen funds reached Binance".
2. **Auto-trace:** walk N hops forward/back with a top-K filter (Orbit-style) and stop at exchanges or mixers.
3. **Risk score** 0-100 per address (sanctioned, mixer and scam exposure), with the reasons listed.
4. **Case files:** save/load JSON, export CSV of flows, and export PNG/PDF of the graph plus an **"exchange report" PDF** (deposit addresses, amounts, txids and historical fiat values).
5. Historical fiat value at each tx's time (M3).
6. A notes panel for adding your own tags and comments per node.
7. A `/methodology` page explaining each heuristic and its limits, so it holds up when handed to police.

### Suggested module layout
```
lib/
  chains/{btc,eth}/        # fetchers (paginated, cached), normalise to a common Tx model
  heuristics/btc/          # change.ts, coinjoin.ts, cio-cluster.ts
  heuristics/eth/          # deposit-reuse.ts, tornado.ts
  taint/                   # poison.ts, haircut.ts, fifo.ts
  labels/                  # loader for TagPack YAML + OFAC + curated
  risk.ts, format.ts
```
Every heuristic should return `{ result, confidence, reasons[] }` so the UI can explain itself.
