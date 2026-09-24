# CryptoTracer

Free, open-source blockchain forensics for scam victims and independent investigators. Trace Bitcoin and Ethereum funds hop by hop, find the exchange deposit address where they were cashed out, and export a report you can hand to an exchange or the police. No sign-up, no paywall.

## What it does

| | |
|---|---|
| **Bitcoin + Ethereum** | BTC via Esplora (Blockstream / mempool.space), ETH + ERC-20 tokens + internal transfers via Etherscan API V2 |
| **122k+ entity labels** | GraphSense TagPacks (exchanges, scams, ransomware, hacks, darknet, CoinJoin) + the OFAC sanctions list, each with a source link |
| **Exchange deposit addresses** | Detects the customer deposit address funds were swept from (tutela / FC'20 heuristic): the detail an exchange needs to identify the account holder |
| **Taint analysis** | Poison, Haircut and FIFO: how much of the stolen amount reached each address (UTXO-exact on Bitcoin) |
| **Clustering** | Common-input ownership (union-find) and deposit-address reuse; labels propagate across a cluster |
| **CoinJoin & mixers** | Whirlpool, Wasabi 1/2 and JoinMarket fingerprints; Tornado Cash address-match, gas-price and multi-denomination reveals |
| **Change detection** | Address reuse, round amounts, script type, unnecessary input, each with a confidence score |
| **Risk score** | 0–100 with reasons (sanctioned / scam / mixer exposure, CoinJoin and Tornado use) |
| **Auto-trace** | Follow the money N hops forward, or walk back to the source of funds; stops at exchanges and mixers |
| **Case files & exports** | Save and reopen investigations (JSON), CSV of flows, GraphML (Gephi/yEd), PNG, printable report |

Every heuristic is documented, with its limits, at `/methodology`.

## Getting started

Requires Node.js 20+.

```bash
git clone https://github.com/TxWheat/Cryptocurrency-Tracing-Tool.git
cd Cryptocurrency-Tracing-Tool
npm install
cp .env.local.example .env.local   # add ETHERSCAN_API_KEY for Ethereum
npm run dev
```

Open http://localhost:3000. Bitcoin works without any key.

> **Windows PowerShell 5:** run the commands one per line (`&&` is not supported). Use `copy` in place of `cp`.

## How to use it

1. Paste a BTC or ETH address. The chain is auto-detected.
2. Click a node to see its label, risk score, findings and cluster.
3. **Transactions** lists its activity: **Follow** any sender or recipient to add them to the graph. **Load older transactions** pages back through history.
4. **Auto-trace out** follows the largest outflows; **Source of funds** walks back along the largest inputs.
5. On the address that received the stolen funds, click **Taint from here**, then choose Haircut / FIFO / Poison in the sidebar.
6. **Report** opens a printable summary (Print → Save as PDF). **Save case** stores the investigation on your computer.

## Development

```bash
npm test            # vitest: heuristics, taint, labels, chain clients (mocked upstream)
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
lib/taint.ts       poison / haircut / FIFO
lib/risk.ts        0–100 risk score
lib/autotrace.ts   hop-limited crawler
lib/labels.ts      label lookup (server only)
app/api/[chain]/[address]          trace one page of an address
app/api/screen/[chain]/[address]   JSON risk screening
```

## Credits

Ideas and data from open-source projects: [pareto-xyz/tutela-app](https://github.com/pareto-xyz/tutela-app) (deposit reuse, Tornado reveals), [peterzen/heuristic](https://github.com/peterzen/heuristic) (CoinJoin fingerprints, risk model, source-of-funds walk), [s0md3v/Orbit](https://github.com/s0md3v/Orbit) (auto-trace, edge weighting, GraphML), [TrailBit-Labs/TaintTrail](https://github.com/TrailBit-Labs/TaintTrail) and [tintiron/taintedtx](https://github.com/tintiron/taintedtx) (taint models), [GraphSense TagPacks](https://github.com/graphsense/graphsense-tagpacks) (labels, MIT), [0xB10C OFAC list](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses). Code is reimplemented, not copied; no tutela code or data is included (it has no licence).

Heuristics are leads, not proof. Verify findings on a block explorer before acting on them.
