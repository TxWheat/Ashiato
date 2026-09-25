# ETHGlobal Continuity Track: plan of attack

**Pitch:** an open, low-cost alternative to TRM Labs and Chainalysis for scam victims and small investigators. Tracing is free. Labels are public on-chain attestations that anyone can read, dispute or build on. Reports can be verified by anyone. There are no accounts: your wallet is your identity, and no personal data is stored.

**Existing before the event:** the whole CryptoTracer web app (BTC/ETH/Tron tracing, adaptive follow-the-funds, client payment intake, taint, open label datasets). Tag: `pre-hackathon-baseline`.
**Built at the event:** everything in Phases 1–7 below.

---

## Decisions

| Topic | Decision |
|---|---|
| Attestation chain | **Ethereum Sepolia** (testnet). Chain id and contract addresses in one config file, so Base Sepolia or Base mainnet is a one-line change later |
| Traced data | Still read from **mainnet** (real scams). Only the labels and report hashes go on testnet. Say this in the demo |
| Attestation standard | **EAS** (Ethereum Attestation Service). Already deployed on Sepolia; free indexer at `sepolia.easscan.org` |
| Wallet | **Reown AppKit** (WalletConnect) + wagmi + viem, **Sign-In with Ethereum** (SIWX). No email, no user table |
| Cases | Stay in the browser (IndexedDB, already built). Optional: encrypted sync keyed by wallet (stretch) |
| Hosting | Vercel (live site for judging). Stretch: IPFS copy + ENS name |

Check before the event:
- EAS on Sepolia: EAS `0xC2679fBD37d54388Ce493F1DB75320D236e1815e`, SchemaRegistry `0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0` (confirm on docs.attest.org).
- Base Sepolia predeploys: EAS `0x4200000000000000000000000000000000000021`, SchemaRegistry `…0020`.

---

## Attestation schemas (register in Phase 2)

**1. Label**: "this address is X"
```
string chain        // "eth" | "btc" | "tron"  (subjects can be on any chain)
string subject      // the address, normalised
string category     // scam | phishing | exchange-deposit | exchange | mixer | hack | cleared | service
string name         // e.g. "Pig-butchering scam: fake USDT platform"
string evidence     // tx hashes and/or a report hash / URL (required for scam, phishing or hack)
uint8  confidence   // 1–100
```
Revocable: the attester can withdraw their own label.

**2. Vote**: agree or dispute an existing label (`refUID` = the label's UID)
```
bool   agree
string reason       // required when disputing
```

**3. Report**: "this trace report existed, unaltered, at this time"
```
bytes32 reportHash  // sha256 of the exported case JSON
string  chain
string  subject     // origin address/tx of the case
string  summary     // one line, no victim personal data
```

**Privacy rule:** nothing about a victim goes on-chain. Only addresses, categories, evidence tx hashes and report hashes.

---

## Reputation weighting (keep simple)

Score of a label = Σ over agreeing attesters of `weight`, minus Σ over disputing attesters.
`weight` = 1, +1 if the attester has an ENS primary name, +1 per 3 of their past labels that others agreed with (cap at +3), −1 per label of theirs that was disputed and revoked.
Show it plainly: "Scam · 7 investigators agree · 1 dispute", with a list of attesters.
Community labels sit **alongside** the open datasets, not over them. A label disputed by more weight than it has is shown struck through, not hidden.

---

## Phases (in build order)

### Phase 0: before the event (setup only, no features)
- [ ] New GitHub repo, full history pushed (`git push --mirror`), tag `pre-hackathon-baseline`
- [ ] `HACKATHON.md`: what existed before, link to the baseline tag, what will be built
- [ ] `AI_USAGE.md`: which tools, which files, how they were directed; keep prompts and plans in `docs/`
- [ ] Deploy the baseline app to Vercel with env keys (Etherscan, TronGrid) and check it works live
- [ ] Reown project ID, Sepolia ETH from a faucet in 2–3 test wallets (need several "investigators" for the demo)
- [ ] Confirm the event, dates and partner prizes (EAS, ENS, MetaMask, WalletConnect?)

### Phase 1: wallet sign-in (**you**)
- [ ] AppKit provider in `app/layout.tsx` (client component, cookie storage for SSR)
- [ ] Connect button in the top bar; SIWX sign-in; show ENS name / avatar
- [ ] Network guard: prompt to switch to Sepolia before any attestation
- **Done when:** connect → sign in → reload keeps the session; wrong network gets a clear prompt

### Phase 2: publish labels
- [ ] `lib/attest/config.ts`: chain, EAS addresses, schema UIDs
- [ ] Script to register the 3 schemas; commit the UIDs
- [ ] "Flag this address" in the Inspector: category, name, evidence (pre-filled with the selected tx hashes), confidence → EAS attest
- [ ] Revoke own label
- **Done when:** a label attested in the app appears on sepolia.easscan.org

### Phase 3: read, weigh and show community labels
- [ ] `app/api/community/[chain]/[address]`: query the EAS GraphQL indexer for labels + votes, compute weights, cache ~60s
- [ ] Merge into the label pipeline as source "Community (EAS)"; node badge shows the count of agreeing investigators
- [ ] Inspector: attesters (ENS), evidence links, Agree / Dispute buttons (Vote schema)
- [ ] Optimistic UI: show your own new label immediately (the indexer can lag ~30s)
- **Done when:** wallet A flags, wallet B agrees, wallet C disputes; all three show with correct weighting

### Phase 4: verifiable reports
- [ ] On export: sha256 of the case JSON, "Certify on-chain" → Report attestation; UID + QR code printed on the PDF report
- [ ] `/verify` page: drop in a report file or paste a UID → "Unaltered, certified by vitalik.eth on 12 Nov 2026" or "Altered / not found"
- **Done when:** changing one byte of the exported file makes verification fail

### Phase 5: freeze-request letter
- [ ] From a traced case: pick the exchange deposit address(es) reached, generate a letter for the exchange's compliance team (addresses, tx hashes, amounts, timeline, report UID and verify link)
- [ ] Copy / download as PDF; a short list of exchange compliance contacts (curated)
- **Done when:** a trace that reaches Binance produces a ready-to-send letter

### Phase 6 (stretch): MetaMask Snap "warn before you send"
- [ ] Public read API `/api/community/eth/[address]` (CORS on)
- [ ] Snap with a transaction-insight handler: shows community + open-data labels for the recipient before signing
- **Done when:** sending to a flagged address in MetaMask Flask shows the warning

### Phase 7: ship it
- [ ] Deploy to Vercel; smoke-test with real mainnet cases
- [ ] Rate-limit and cache the API routes (free Etherscan and TronGrid keys have limits)
- [ ] README + HACKATHON.md updated with what was built; AI_USAGE.md complete
- [ ] Demo video (under 4 min) + live demo rehearsal

Other stretch ideas: exchange alerts (watch an address; alert via XMTP/Push when funds reach an exchange), pay-per-report in USDC, a Chainabuse import, IPFS/ENS mirror, encrypted case sync.

---

## Who does what

| Work | Owner |
|---|---|
| Wallet, SIWX, network guard (Phase 1) | You |
| Schema design sign-off, reputation rules, what counts as evidence | You (decisions) |
| Attest/read/weigh code (Phases 2–4), with you reviewing every change | Claude assisting, you reviewing |
| Freeze letter wording, exchange contacts | You |
| Demo script, video, live presentation | You |

Keep commits small and frequent, and log how AI was used as you go, not at the end.

---

## Demo script (~4 min)
1. **The problem (20s):** victims can't afford TRM or Chainalysis; open labels are wrong or missing (show the MetaMask router once mislabelled as "scam").
2. **Trace (60s):** paste the client's payments → verified on-chain → auto-trace reaches an exchange deposit.
3. **Label (60s):** sign in with a wallet, flag the scam address with evidence → on-chain. Switch to a second wallet: it sees the label, agrees; a third disputes; show the weighting.
4. **Report (45s):** certify the report on-chain → `/verify` passes; edit one byte → fails.
5. **Act (30s):** generate the freeze letter for the exchange.
6. **(Stretch) Prevent (20s):** MetaMask warns before sending to the flagged address.
7. **Close (15s):** free to use, no accounts, open data anyone can build on.

## Risks
| Risk | Mitigation |
|---|---|
| False or malicious labels | Evidence required, disputes, weighting, struck-through display, testnet only for now |
| EAS indexer lag | Optimistic UI; fall back to reading the attestation by UID on-chain |
| API rate limits on the live site | Caching, per-IP rate limit, optional "bring your own key" |
| Faucet dries up on the day | Fund 3 wallets in Phase 0 |
| "Too much AI" for finalist eligibility | You own the decisions, the wallet work, and can explain every line; full AI_USAGE.md |
