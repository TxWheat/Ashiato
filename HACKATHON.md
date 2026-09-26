# Ashiato at ETHGlobal Tokyo 2026: Continuity track

**Event:** ETHGlobal Tokyo, 25–27 September 2026
**Track:** Continuity (extending an existing project)
**Plan:** [docs/HACKATHON_PLAN.md](docs/HACKATHON_PLAN.md)
**AI disclosure:** [AI_USAGE.md](AI_USAGE.md)

## What existed before the event

Everything up to and including commit `b6ed119` (25 Sep 2026, 11:45 JST), tagged
[`pre-hackathon-baseline`](https://github.com/TxWheat/Ashiato/tree/pre-hackathon-baseline).
The project was started in May 2026 under the working name "CryptoTracer" in
[TxWheat/Cryptocurrency-Tracing-Tool](https://github.com/TxWheat/Cryptocurrency-Tracing-Tool),
and its full history was carried over to this repo.

At the baseline it was a working web app (Next.js) for tracing scam funds:

- Address and transaction search for **Bitcoin, Ethereum and Tron** (ETH, ERC-20, TRX, USDT)
- Graph of addresses and flows; "follow the funds" auto-trace that reads each
  transaction's shape (peel chains, splits, pass-throughs) and stops at exchanges and mixers
- Pooling cut-off (stop when the traced funds are a small share of a pool)
- Client payment intake: paste what a victim reports, check it on-chain, trace it
- Taint analysis, address clustering, CoinJoin and Tornado Cash detection,
  exchange deposit-address inference, risk score
- Labels from open datasets only (GraphSense TagPacks, OFAC, eth-labels) plus the user's
  own labels in the browser
- Exports: case file, CSV, GraphML, PNG, printable report

Nothing about it was on-chain: no wallets, no attestations, no shared labels.

## What was built at the event

Everything after `pre-hackathon-baseline`. Updated as work lands:

- [x] Renamed the project to **Ashiato** (足跡, "footprints")
- [x] Accounts: sign in with a wallet or email (Reown AppKit + Sign-In with Ethereum); cases saved to your account (Supabase, keyed by wallet address, no emails stored); My cases page
- [x] Community labels and votes signed with the connected wallet: EIP-712 signatures, free (no gas, no network switch), checked by the server and publicly re-verifiable; trust scoring and Inspector panel ([docs/ATTESTATIONS.md](docs/ATTESTATIONS.md)). Started as EAS attestations on Sepolia; moved off-chain because paying gas to flag a scammer puts people off
- [x] Trust voting on labels, with reputation weighting (ENS)
- [x] Tron address labels from Tronscan tags (exchange hot wallets, red-flagged scams)
- [x] Fixes from live testing: fake-ETH address poisoning, runaway deposit-reuse clusters, duplicate traced lines
- [x] Cross-chain hops (Bridgers): a transfer into Bridgers is looked up in Bridgers' order records; the destination chain, address, amount and both txids are shown, and the destination goes on the graph with a dashed "via Bridgers" line (Tron/Ethereum destinations keep tracing)
- [x] DEX swaps: a transaction that sells one asset and pays a different one back (Uniswap, UniswapX, 1inch…) is shown as a swap, and follow-the-funds continues with what came back
- [x] Graph keeps its layout and zoom (collapse/expand, delete); addresses can be added to an open case from search
- [x] Cleaner auto-trace: ignores poisoning spam and dust, follows the main trail (side payments are noted, not branched), stops at busy service wallets and bridges, forward and back
- [x] Node quick actions (click a node: Transactions / Relationships / Details, label, copy, explorer, remove) and a Smart-expand transactions view: one-row header, table fills the panel
- [x] Simpler interface: taint analysis removed; the case panel starts hidden and no longer carries client payments
- [x] Scam address lists (MyEtherWallet darklist; ScamSniffer phishing/drainer list, fetched at runtime because it is GPL) and a "Cross-chain bridge" label for 30 major bridge contracts (Stargate, Wormhole, Arbitrum, Optimism, Base, Polygon, each checked against DefiLlama's bridge adapters); traces stop at bridges
- [x] More bridges: Across, Relay and deBridge transfers are looked up from each service's public API (destination chain, recipient, amounts, both txids), the same way as Bridgers
- [x] Ashiato Pro: prepaid months in USDC on Base or Ethereum, checked on-chain by the server (payer, recipient, amount, confirmations; each transaction credited once); time stacks when renewing early; pricing page, Pro badge and renewal reminder in the account menu. Everything a victim needs stays free. Test mode (PAYMENTS_TESTNET=1) runs the same flow with free test USDC on Base Sepolia for the demo
- [x] API routes need a signed-in account (sign-in and public community-label reads excepted)
- [ ] Still to add: Stargate (LayerZero Scan), Wormhole, Axelar/Squid, Orbiter
- [ ] Verifiable reports: report hash attested on-chain, `/verify` page
- [ ] Freeze-request letter for exchange compliance teams
- [ ] (Stretch) MetaMask Snap that warns before sending to a flagged address

## How to check

- Compare the baseline with the event work: `git diff pre-hackathon-baseline..master`
- Every change after the baseline was merged by the team through a pull request
