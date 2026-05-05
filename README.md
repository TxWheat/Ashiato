# Cryptocurrency Tracing Tool

Free, open-source blockchain forensics for scam victims and independent investigators. Trace BTC and ETH transactions hop by hop — no sign-up, no paywalls.

Built as a no-bullshit alternative to tools like Chainalysis and TRM Labs that charge $50k+/year.

## Features

- **BTC + ETH tracing** — follow fund flows across Bitcoin and Ethereum
- **Visual transaction graph** — interactive force-directed graph with auto-layout
- **Entity tagging** — automatically identifies exchanges, mixers, DeFi protocols, and flagged addresses
- **Click to expand** — drill into any node to trace further hops
- **Explorer links** — one click to Blockstream (BTC) or Etherscan (ETH)
- **No account required** — completely free, runs locally or self-hosted

## Screenshots

> Coming soon

## Getting Started

### Prerequisites

- Node.js 18+
- A free [Etherscan API key](https://etherscan.io/apis) (for ETH tracing — BTC works without any key)

### Install

```bash
git clone https://github.com/TxWheat/Cryptocurrency-Tracing-Tool.git
cd Cryptocurrency-Tracing-Tool
npm install
```

### Configure

```bash
cp .env.local.example .env.local
```

Open `.env.local` and add your Etherscan API key:

```
ETHERSCAN_API_KEY=your_key_here
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How It Works

1. Enter a BTC or ETH address — chain is auto-detected
2. The tool fetches recent transactions via free public APIs
3. Counterparty addresses are extracted and laid out as a graph
4. Known entities (exchanges, mixers, etc.) are tagged automatically
5. Click any node to inspect it or expand it to trace the next hop

### Data Sources

| Chain | Source | Cost |
|-------|--------|------|
| Bitcoin | [Blockstream API](https://blockstream.info/api/) | Free, no key |
| Ethereum | [Etherscan API](https://etherscan.io/apis) | Free tier |

### Node Colours

| Colour | Meaning |
|--------|---------|
| Cyan | Origin address (your starting point) |
| Green | Known exchange |
| Red | Flagged / scam address |
| Orange | Mixer / tumbler (e.g. Tornado Cash) |
| Purple | DeFi protocol |
| Grey | Unknown wallet |

## Entity Database

Known addresses are stored in [`data/labels.json`](data/labels.json). Currently includes:

- Major exchanges: Binance, Coinbase, Kraken, OKX, Huobi, Bybit, Poloniex
- Mixers: Tornado Cash pools
- DeFi: Uniswap V2/V3, SushiSwap, 0x

To add an address, edit `data/labels.json`:

```json
"0xYourAddressHere": {
  "name": "Exchange Name",
  "type": "exchange"
}
```

Valid types: `exchange` | `mixer` | `scam` | `defi` | `wallet` | `unknown`

## Tech Stack

- [Next.js 15](https://nextjs.org/) — framework + API routes
- [ReactFlow](https://reactflow.dev/) — transaction graph
- [Dagre](https://github.com/dagrejs/dagre) — automatic graph layout
- [Tailwind CSS](https://tailwindcss.com/) — styling

## Roadmap

- [ ] BSC / Polygon support
- [ ] Multi-hop tracing (configurable depth)
- [ ] PDF report export (for police / exchange fraud reports)
- [ ] CIOH clustering (Bitcoin common-input-ownership heuristic)
- [ ] Bulk address import from CSV
- [ ] OFAC sanctions list integration
- [ ] Community scam address submissions

## Contributing

PRs welcome. If you know of a scam address that should be in the label database, open an issue or submit a PR to `data/labels.json`.

## Disclaimer

This tool is for investigative and educational purposes. It only reads publicly available on-chain data. No private keys, no wallets, no transactions are ever submitted.

## License

MIT
