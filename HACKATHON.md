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
- [ ] Wallet sign-in (WalletConnect / Reown AppKit, Sign-In with Ethereum)
- [x] On-chain community labels as EAS attestations (Sepolia): schemas, encoding, reading, trust scoring, Inspector panel ([docs/ATTESTATIONS.md](docs/ATTESTATIONS.md)); signing goes live once wallet sign-in lands
- [x] Trust voting on labels, with reputation weighting (ENS)
- [x] Tron address labels from Tronscan tags (exchange hot wallets, red-flagged scams)
- [x] Fixes from live testing: fake-ETH address poisoning, runaway deposit-reuse clusters, duplicate traced lines
- [ ] Cross-chain hops: bridge deposits resolved to the destination chain's txid, trace continues
- [ ] Verifiable reports: report hash attested on-chain, `/verify` page
- [ ] Freeze-request letter for exchange compliance teams
- [ ] (Stretch) MetaMask Snap that warns before sending to a flagged address

## How to check

- Compare the baseline with the event work: `git diff pre-hackathon-baseline..master`
- Every change after the baseline was merged by the team through a pull request
