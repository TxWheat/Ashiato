# Ashiato 足跡

*Ashiato* is Japanese for “footprints”. Every transaction leaves one; Ashiato follows them.

> Built on at **ETHGlobal Tokyo 2026** (Continuity track): see [HACKATHON.md](HACKATHON.md) for what existed before and what was added, and [AI_USAGE.md](AI_USAGE.md).

Free, open-source blockchain forensics for scam victims and independent investigators. Trace Bitcoin, Ethereum and Tron funds (including USDT) hop by hop, find the exchange deposit address where they were cashed out, and export a report you can hand to an exchange or the police. No sign-up, no paywall.

## What it does

| | |
|---|---|
| **Bitcoin + Ethereum** | BTC via Esplora (Blockstream / mempool.space), ETH + ERC-20 tokens + internal transfers via Etherscan API V2 |
| **185k+ entity labels** | GraphSense TagPacks (exchanges, scams, ransomware, hacks, darknet, CoinJoin), Etherscan public name tags via [eth-labels](https://github.com/dawsbot/eth-labels) (exchange hot wallets and deposit addresses, phishing, exploits) and the OFAC sanctions list, each with a source link. You can also add or edit your own |
| **Exchange deposit addresses** | Detects the customer deposit address funds were swept from (tutela / FC'20 heuristic): the detail an exchange needs to identify the account holder |
| **Clustering** | Common-input ownership (union-find) and deposit-address reuse; labels propagate across a cluster |
| **CoinJoin & mixers** | Whirlpool, Wasabi 1/2 and JoinMarket fingerprints; Tornado Cash address-match, gas-price and multi-denomination reveals |
| **Change detection** | Address reuse, round amounts, script type, unnecessary input, each with a confidence score |
| **Risk score** | 0–100 with reasons (sanctioned / scam / mixer exposure, CoinJoin and Tornado use) |
| **Follow the funds** | Trace a specific payment hop by hop: exact coin (UTXO) tracing on Bitcoin, chronological amount-capped tracing on Ethereum. Every hop explains itself; stops at exchanges, deposit addresses and mixers |
| **ENS names** | Verified primary ENS names on Ethereum addresses (reverse + forward check, so spoofed names are ignored) |
| **Cases & exports** | Save a chart as a case in your browser (auto-saves; Save as for copies) (layout, transactions, traces, notes, labels) and reopen it from the home page; case files (JSON) to move it between computers; CSV of flows, GraphML (Gephi/yEd), PNG, printable report |
| **Tron (TRX + USDT)** | TronGrid: TRX and TRC-20 transfers (fake-USDT poisoning flagged), exact tx lookup, same adaptive tracing and pooling as Ethereum; OFAC Tron addresses and GraphSense exchange wallets labelled. Works without a key; a free `TRONGRID_API_KEY` raises the rate limit |
| **Client payments** | Paste the tx hashes, wallet addresses, amounts and dates a client gives you: each is checked on-chain (verified / details differ / several matches / not found) and all of them are traced together; the report includes the comparison |
| **Your own labels** | Name any address and set its category; your label overrides every other source wherever the address appears |

Every heuristic is documented, with its limits, at `/methodology`.

## Getting started

Requires Node.js 20+.

```bash
git clone https://github.com/TxWheat/Ashiato.git
cd Ashiato
npm install
cp .env.local.example .env.local   # add ETHERSCAN_API_KEY for Ethereum; optional TRONGRID_API_KEY for Tron
npm run dev
```

Open http://localhost:3000. Bitcoin works without any key.

> **Windows PowerShell 5:** run the commands one per line (`&&` is not supported). Use `copy` in place of `cp`.

## How to use it

1. Paste a BTC/ETH **address** or a **transaction hash** (BTC txid, or ETH `0x…` hash) into the search box.
2. **Address:** the graph starts with just that address. The right-hand panel shows Incoming/Outgoing totals and its **Relationships** (who it paid and was paid by, filterable by asset, amount and count; spam like address poisoning and airdrops hidden by default). Press **+** to add one to the graph, or click the row to open the relationship.
3. **Transaction:** it appears as its own node with its inputs and outputs. Every input has **← Source**, every output **Trace →**.
4. Click any address to inspect it (Relationships · Transactions · Details); click empty canvas to collapse the panel. Lines are labelled along the curve with amount, NZD value and date. On a transaction, **Trace →** follows that payment onward and **← Source** walks it back. Click any **line** to see the payments behind it; **Hide link** (or the Delete key) removes a line you don't need, and **hidden links · Show all** on the graph brings them back. The Relationships tab has a search box and shows how far back the loaded history reaches. The **Transactions** tab has search, In/Out and date-range filters; expand the side panel (grip on its left edge, or drag to resize) for a wide table view. Bitcoin addresses with up to 500 transactions load their full history automatically; bigger ones have **Load all** with progress. With an address selected, boxes that paid it glow green and boxes it paid glow red; newly added boxes pulse. After a trace, long pass-through runs (peel chains, relays) are drawn as one line such as “39 hops · 15 → 6.29 BTC”; click it to expand, or use **Chains collapsed** in the top bar. Every hop is still in the report and exports.
5. After a trace, the traced money trail is highlighted on the graph. The left **Case** panel shows where the funds ended up and clusters.
6. **Save case** (top bar) turns the chart into a named case, like Breadcrumbs. From then on it auto-saves after each change (toggle in the Save menu), **Save as new case…** makes a copy, and the case stays in the URL so a refresh carries on where you were. Reopen cases from **Your cases** on the home page. **Label** on an address sets your own name and category for it.
7. **Export** (top bar): printable report, case file save/open, PNG, CSV, GraphML.

### Rate limits

The free Etherscan tier allows about 3 calls per second. The app spaces its calls and retries when Etherscan says the limit was hit. If you upgrade your Etherscan plan, set `ETHERSCAN_RPS` in `.env.local` (e.g. `ETHERSCAN_RPS=10`).

**Etherscan name tags.** For addresses the offline label files don't know, each address you load onto the graph is checked with Etherscan: its public name tag (e.g. "Privacy Pools: Deposit", with labels like "Mixer") via the nametag API, which is only on Etherscan's **Pro Plus** plan. The app tries it once and stops if your key can't use it; set `ETHERSCAN_NAMETAGS=0` to skip it entirely. On any plan, verified contracts fall back to their contract name (proxies resolved to their implementation). Those names are chosen by the deployer, so they show as inferred (dashed border). ENS names and single-transaction lookups use a free public Ethereum node (`ETH_RPC_URL`), not your Etherscan quota.

## Development

```bash
npm test            # vitest: heuristics, follow-the-funds, labels, chain clients (mocked upstream)
npm run lint
npm run typecheck
npm run build
```

### Refreshing labels

```bash
git clone --depth 1 https://github.com/graphsense/graphsense-tagpacks.git /tmp/tagpacks
git clone --depth 1 -b lists https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses.git /tmp/ofac
npm run labels:build -- --tagpacks /tmp/tagpacks --ofac /tmp/ofac
```

Hand-maintained labels live in `data/labels/curated.tsv`.

### Layout

```
lib/chains/        Esplora + Etherscan V2 clients (paginated, cached, rate-limited)
lib/heuristics/    change, coinjoin, cluster, deposit-address, tornado
lib/risk.ts        0–100 risk score
lib/labels.ts      label lookup (server only)
app/api/[chain]/[address]          trace one page of an address
app/api/screen/[chain]/[address]   JSON risk screening
app/api/tx/[chain]/[txid]          one tx: BTC with who spent each output, ETH with every transfer inside it
lib/follow.ts      follow-the-funds engine
lib/ens.ts         verified ENS names (ETH_RPC_URL)
```

## Credits

Ideas and data from open-source projects: [pareto-xyz/tutela-app](https://github.com/pareto-xyz/tutela-app) (deposit reuse, Tornado reveals), [peterzen/heuristic](https://github.com/peterzen/heuristic) (CoinJoin fingerprints, risk model, source-of-funds walk), [s0md3v/Orbit](https://github.com/s0md3v/Orbit) (auto-trace, edge weighting, GraphML), [GraphSense TagPacks](https://github.com/graphsense/graphsense-tagpacks) (labels, MIT), [dawsbot/eth-labels](https://github.com/dawsbot/eth-labels) (Etherscan name tags, MIT), [0xB10C OFAC list](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses). Code is reimplemented, not copied; no tutela code or data is included (it has no licence).

Heuristics are leads, not proof. Verify findings on a block explorer before acting on them.
