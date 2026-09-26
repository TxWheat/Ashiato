import type { Metadata } from 'next'
import SiteNav from '@/components/SiteNav'

export const metadata: Metadata = {
  title: 'Docs · Ashiato',
  description: 'How to use Ashiato, what every feature does, and the methods behind the tracing: labels, change detection, CoinJoins, clustering, exchange deposits, risk and follow-the-funds, with their limits.',
}

interface Section { id: string; title: string; body: string[]; limits?: string; credit?: string }

const GUIDE: Section[] = [
  {
    id: 'start',
    title: 'Getting started',
    body: [
      'Sign in with a wallet (MetaMask, Rabby, Coinbase Wallet…) or with an email or Google, GitHub, X, Apple or Discord account. An email sign-in creates a wallet for you through Reown; signing back in with the same email gives you the same wallet. Signing in is a free signature, not a transaction.',
      'Paste a Bitcoin, Ethereum or Tron address or transaction hash on the home page and press Trace. You name the case first (for example "Jane Doe · USDT investment scam"), and it is saved to your account from the start and saved again as you work. Open it later from Cases.',
      'Cases hold everything on the graph: addresses, traced trails, drawings and notes. A case can also be saved as a file (Export → Save case file) and opened again on any device.',
    ],
  },
  {
    id: 'graph',
    title: 'The graph',
    body: [
      'Each box is an address, coloured by what it is: exchange, scam, mixer, bridge, sanctioned, service or unknown. Lines are money moving between them, with the total and the number of transactions; a line added by a trace is highlighted and shows the traced amount.',
      'Click an address for its menu: Transactions (every transfer in and out, newest first, incoming in green and outgoing in red), Relationships (who it sent to and received from, sortable, with a button to add any of them to the graph), Details (labels, risk, community labels), plus Label, Copy address, Open in block explorer and Remove from graph. Smart expand opens the transactions in a wide view.',
      'Click a line to see the transactions behind it. Each one can be removed from or shown on the graph on its own, so one relevant payment can stay while the noise goes.',
      'Drag addresses to arrange them; the layout and zoom are kept when you save and reopen. The tools at the bottom left add boxes, circles, arrows and text notes, for highlighting a cluster or writing what you found; select one to resize, rotate (arrows) or delete it.',
    ],
  },
  {
    id: 'trace',
    title: 'Following the funds',
    body: [
      'Tracing starts from a specific transaction: open it and press Trace to follow where the money went, or Source to walk back to where it came from. The trace follows that amount hop by hop and adds each step to the graph; the method is described under Follow the funds below.',
      'The Case panel (left edge) holds the trace settings and the results. Max hops (default 10) limits how far a trace goes. The pooled-funds cut-off (default 35%) stops a trail once the traced money is only a small share of what moves on. "Follow every output" turns off the smart pruning that keeps to the main trail.',
      'Where the money ended up is listed in the Case panel: at an exchange or exchange deposit address, a bridge, a mixer or CoinJoin, still unspent, pooled with other funds, or at the hop limit. Click any line of a trace to read why that hop was followed.',
    ],
  },
  {
    id: 'bridges',
    title: 'Bridges and swaps',
    body: [
      'Money that enters a cross-chain bridge is looked up with that service: Bridgers, Across, Relay and deBridge. The destination chain, recipient, amounts and both transaction hashes are shown, and the recipient is added to the graph with a dashed "via …" line. Ethereum and Tron destinations can be traced further.',
      'About 30 major bridge contracts (Stargate, Wormhole, Arbitrum, Optimism, Base, Polygon and others, checked against DefiLlama) are labelled, and a trace stops there so you can look the transfer up.',
      'DEX swaps (Uniswap, UniswapX, 1inch…) are recognised: when a transaction sells one token and pays another back, the trace continues with what came back.',
    ],
    limits: 'Destinations on chains Ashiato does not trace yet (Solana, BNB Chain, Base, Arbitrum…) are shown but cannot be followed further.',
  },
  {
    id: 'label-tools',
    title: 'Labels and risk',
    body: [
      'Ashiato ships with about 110,000 Bitcoin and 75,000 Ethereum labels, the OFAC sanctions list, scam lists (MyEtherWallet darklist, ScamSniffer phishing and drainer addresses) and Tronscan tags. Where each comes from is described under Entity labels below.',
      'Your own labels: use Label in an address\'s menu to name it (for example "Victim" or "Scammer wallet 1"). Your labels are kept in this browser, apply across your cases, and are shown only to you.',
      'Each address has a 0–100 risk score with its reasons, and flags for exchange deposit addresses, CoinJoin and Tornado Cash use, and address-poisoning attempts.',
    ],
  },
  {
    id: 'community',
    title: 'Community labels',
    body: [
      'Signed-in investigators can label an address for everyone (scam, phishing, hack, exchange, exchange deposit, mixer, service, or cleared) and vote on each other\'s labels. Accusing labels need evidence: transaction hashes, a report or a link.',
      'Each label and vote is a message signed by your wallet: free, no transaction and no network fee. Labels are public and linked to your wallet address. Never include a victim\'s personal details.',
      'Trust is the weighted share of support: the author counts as a strong yes, a voter with a verified ENS name counts double, and you cannot vote on your own label. 70% or more is trusted, 40–69% contested, below 40% disputed. You can withdraw your own label at any time.',
      'Anyone can check a label: its link shows the original signed message and signature. Labels are also readable by other tools at /api/community/{chain}/{address}.',
    ],
  },
  {
    id: 'values',
    title: 'Values and currencies',
    body: [
      'Settings (the gear icon) choose the display currency (12 currencies, defaulting to your locale), light or dark mode, and whether transfers are valued at the price on the day they moved or at today\'s price.',
      'Historical values use daily prices, so a transfer from two years ago shows what it was worth then. Stablecoins are valued at their peg.',
    ],
    limits: 'Daily prices, not the exact minute of the transfer. Small or new tokens may have no price.',
  },
  {
    id: 'exports',
    title: 'Exports and reports',
    body: [
      'Export → Printable report: a report of the case for police, a lawyer or an exchange, with the traced trails, where the money ended up, labels with their sources, the method used for each hop and its limits.',
      'Also: Save case file (and Open case file…), Graph image (PNG), Flows (CSV, for a spreadsheet) and Graph (GraphML, for tools like Gephi).',
    ],
  },
  {
    id: 'pro',
    title: 'Pro and payments',
    body: [
      'Tracing is free, and everything a scam victim needs stays free. Pro is for investigators who use Ashiato often and pays for the blockchain data behind it.',
      'Pro is paid in USDC on Base or Ethereum for 1, 3 or 12 months. Payments are checked on the blockchain and credited to the wallet that paid; paying again adds time on top. The account menu shows when Pro ends and reminds you a week before. Wallet → Add funds buys crypto with a card; Receive shows your address for sending from an exchange (choose the Base network, it is the cheapest).',
      'Ashiato traces where money went. It never recovers funds, never charges a fee to get money back and never contacts you first. Anyone offering to recover crypto for a fee is almost certainly running a second scam.',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy and data',
    body: [
      'Your account is a wallet address. Ashiato stores no emails, names or passwords: an email sign-in is handled by Reown, which gives you a wallet, and only that address reaches Ashiato.',
      'Stored: your saved cases (compressed, readable only when signed in as you), your payments, and the community labels and votes you sign (public by design). Blockchain data is public and fetched from Etherscan, Esplora (Blockstream), TronGrid and the bridge services.',
      'Ashiato is open source. The code is on GitHub (Source, top right).',
    ],
  },
]

const METHODS: Section[] = [
  {
    id: 'labels',
    title: 'Entity labels',
    body: [
      'Addresses are matched against GraphSense TagPacks (exchanges, scams, ransomware, hacks, darknet markets, CoinJoin coordinators), Etherscan public name tags from the eth-labels dataset (exchange hot wallets and deposit addresses, phishing, exploits), the US Treasury OFAC SDN list of sanctioned addresses, Tronscan tags, the MyEtherWallet darklist, the ScamSniffer phishing and drainer list, a list of bridge contracts, and a small curated list. Ethereum addresses on the graph are also checked against Etherscan: public name tags when the API plan includes them, otherwise a verified contract\'s own name, shown as inferred because the deployer chose it. Every label links to its public source.',
      'BitMEX deposit addresses are recognised by their 3BMEX vanity prefix.',
    ],
    limits: 'Labels are only as good as their sources. No label does not mean clean. Most addresses in the world are unlabelled.',
    credit: 'graphsense/graphsense-tagpacks (MIT), dawsbot/eth-labels (MIT), 0xB10C/ofac-sanctioned-digital-currency-addresses, MyEtherWallet ethereum-lists (MIT), ScamSniffer scam-database (GPL-3.0, downloaded at runtime, not bundled)',
  },
  {
    id: 'change',
    title: 'Change detection (Bitcoin)',
    body: [
      'A Bitcoin payment usually returns "change" to the sender. We score each output: paying back to an input address (certain); the only non-round amount (payments tend to be round); the only output with the same script type as the inputs; the only output smaller than every input (otherwise an input was unnecessary).',
      'An output is marked change only when it is clearly ahead of the others, and its confidence and reasons are shown on hover.',
      'A change mark is only a tag. The output still counts as money leaving the address: it appears in Outgoing totals, Relationships and the graph (as a dashed line), and Trace follows it like any other output.',
    ],
    limits: 'Modern wallets deliberately defeat these rules (script-type matching, random amounts, PayJoin). Treat change marks as likely, not certain.',
    credit: 'Meiklejohn et al. 2013; BlockSci; peterzen/heuristic',
  },
  {
    id: 'coinjoin',
    title: 'CoinJoin detection',
    body: [
      'Whirlpool: 5 inputs → 5 equal outputs in a pool denomination (0.001 / 0.01 / 0.05 / 0.5 BTC). Wasabi 1: ≥10 equal outputs near 0.1 BTC. Wasabi 2: 50+ inputs and outputs in several equal-value groups. JoinMarket: n equal outputs plus up to n change outputs from ≥n distinct inputs.',
      'CoinJoins are excluded from clustering and change detection, because the co-spending rule does not hold for them.',
    ],
    limits: 'Small or unusual CoinJoins can be missed, and batch payments with equal amounts can look like a generic CoinJoin.',
    credit: 'peterzen/heuristic; VincenzoImp/bitcoin-address-clustering',
  },
  {
    id: 'cluster',
    title: 'Address clustering',
    body: [
      'Common-input ownership: every address that signs inputs of the same non-CoinJoin transaction is treated as one wallet (union-find over the loaded transactions). If any member is labelled, the whole cluster inherits the label.',
      'Deposit-address reuse: wallets that pay into the same exchange deposit address are grouped as the same exchange customer.',
    ],
    limits: 'Clusters only cover transactions you have loaded. CoinJoins that are not detected, and PayJoins, can merge unrelated owners.',
    credit: 'Nakamoto 2008 §10; Victor, FC 2020; pareto-xyz/tutela-app',
  },
  {
    id: 'deposit',
    title: 'Exchange deposit addresses',
    body: [
      'Exchanges give each customer a unique deposit address and sweep it into a hot wallet soon after funds arrive. On Ethereum we look for an inbound transfer followed within ~12 hours by an outbound transfer of the same amount minus at most 0.01 ETH (or 1% for tokens) to a labelled exchange. On Bitcoin we look for spends that send ≥80% of their value to a single labelled exchange.',
      'This is the address to quote when asking an exchange to identify an account holder.',
    ],
    limits: 'Requires the exchange hot wallet to be labelled. Personal wallets that happen to send everything to one exchange can match.',
    credit: 'pareto-xyz/tutela-app (deposit reuse, adapted from etherclust); Victor, FC 2020',
  },
  {
    id: 'tornado',
    title: 'Tornado Cash reveals (Ethereum)',
    body: [
      'Address match: the same address deposits to and withdraws from a pool. Unique gas price: a deposit and a withdrawal in the same pool share an unusual gas price (pre-EIP-1559 fingerprint). Multi-denomination: one address\'s deposit mix across pools equals another address\'s withdrawal mix.',
    ],
    limits: 'Tutela ran these over the full pool history. Here they run over loaded transactions only, so they find links between addresses you are already investigating.',
    credit: 'pareto-xyz/tutela-app',
  },
  {
    id: 'risk',
    title: 'Risk score',
    body: [
      '0–100, the maximum of: the address\'s own label (e.g. sanctioned = 100, mixer = 70), its strongest direct exposure to risky counterparties by share of value, and behaviour (CoinJoin participation 45, Tornado Cash use 60). Bands: clean <8 · low 8–25 · medium 25–50 · high 50–75 · critical 75+.',
    ],
    limits: 'Direct (1-hop) exposure only, within the loaded transactions. A low score is not a clean bill of health.',
    credit: 'Model after peterzen/heuristic',
  },
  {
    id: 'follow',
    title: 'Follow the funds',
    body: [
      'Tracing follows a specific amount of money, not "the biggest counterparties", and always starts from a specific transaction.',
      'Bitcoin is exact. Every payment creates specific coins (UTXOs). We look up the transaction that later spent those coins and split the traced amount across its outputs in proportion to the coins\' share of that transaction\'s inputs. Source of funds walks the same links backwards through inputs.',
      'Ethereum and Tron balances are pooled, so a heuristic is needed. From the moment funds arrive at an address, the next outflows of the same asset are taken, in time order, until the arrived amount is used up (small differences for gas are tolerated). Outflows before the funds arrived are never followed, and a large later transfer cannot be attributed to a small incoming payment. Source of funds takes the most recent inflows before the money left.',
      'Tracing keeps to the main trail. Each spending transaction is classified: a peel (a small payment and a remainder at least three times larger) follows the remainder; a sweep follows its one output; two comparable outputs are both followed; a split follows the largest outputs, up to three branches per hop. Moves under 5% of the traced amount are listed but not followed, and a branch under 15% is noted rather than followed when a larger move carries the trail. An outflow of the same amount (within about 3%) soon after the funds arrived is taken as a pass-through and followed alone. Dust and address-poisoning spam (tiny or fake transfers made to look like your counterparties) are ignored. "Follow every output" in the Case panel turns the pruning off.',
      'Pooling: at every hop the traced funds\' share of the pool they move in is measured. On Bitcoin that is their share of the coins spent together in the transaction; on Ethereum and Tron it is their share of the balance, counting other funds that arrived after them and before the money moved on. Traced lines show the share (e.g. "42% of pool"), and when it falls below the cut-off (35% by default; 0 turns it off) the trail stops and the address is marked "pooled", because further outflows are no longer meaningfully the victim\'s money.',
      'A trail ends at an exchange, exchange deposit address, bridge, mixer, CoinJoin, DeFi protocol or sanctioned address; at a busy address (1,000+ transactions, almost certainly a service wallet); when coins are still unspent; or at the hop limit. Every hop records its reason, shown when you click the line and in the report.',
    ],
    limits: 'A balance already sitting at an Ethereum or Tron address before the traced funds arrived is not visible from loaded history, so the pool share can be overstated there. The Ethereum rule is a convention investigators commonly use, not proof: if the address already held other funds, a different outflow could be "the" victim\'s money. Only loaded history is searched (several pages per address).',
    credit: 'UTXO tracing via Esplora outspends; hop display after s0md3v/Orbit; source-of-funds walk after peterzen/heuristic',
  },
]

const num = (i: number) => String(i + 1).padStart(2, '0')

function Group({ title, sections, offset }: { title: string; sections: Section[]; offset: number }) {
  return (
    <>
      <h2 id={title.toLowerCase()} className="text-[10px] uppercase tracking-[0.14em] text-faint mt-16 first:mt-0 mb-2 scroll-mt-4">{title}</h2>
      {sections.map((s, i) => (
        <section key={s.id} id={s.id} className="border-t border-line py-10 scroll-mt-4">
          <div className="font-mono text-xs text-faint mb-3">{num(offset + i)}</div>
          <h3 className="text-2xl font-medium text-fg mb-4">{s.title}</h3>
          <div className="space-y-3 text-[15px] leading-relaxed text-muted">
            {s.body.map((b, k) => <p key={k}>{b}</p>)}
          </div>
          {s.limits && (
            <div className="mt-5 border-l-2 border-yellow-500 pl-4 text-sm text-muted">
              <span className="font-medium text-fg">Limits. </span>{s.limits}
            </div>
          )}
          {s.credit && <div className="mt-3 text-xs text-faint">Credit: {s.credit}</div>}
        </section>
      ))}
    </>
  )
}

export default function Docs() {
  const toc = [{ title: 'Guide', sections: GUIDE, offset: 0 }, { title: 'Methodology', sections: METHODS, offset: GUIDE.length }]
  return (
    <div className="min-h-screen">
      <SiteNav />
      <div className="grid lg:grid-cols-[280px_1fr]">
        <nav className="hidden lg:block border-r border-line p-10 sticky top-0 self-start max-h-screen overflow-y-auto">
          {toc.map(g => (
            <div key={g.title} className="mb-8">
              <div className="text-[10px] uppercase tracking-[0.14em] text-faint mb-4">{g.title}</div>
              <ol className="space-y-2 text-sm">
                {g.sections.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="text-muted hover:text-fg"><span className="font-mono text-faint mr-2">{num(g.offset + i)}</span>{s.title}</a>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </nav>
        <main className="max-w-3xl px-4 sm:px-10 py-14">
          <h1 className="text-5xl sm:text-6xl font-light tracking-[-0.03em] text-fg mb-6">Docs</h1>
          <p className="text-muted leading-relaxed mb-4">
            How to use Ashiato, what each part does, and the methods behind the tracing.
          </p>
          <p className="text-muted leading-relaxed mb-12">
            Everything Ashiato infers is a heuristic: a documented rule of thumb with a confidence, not proof. Use the findings as leads,
            verify them on a block explorer, and say which method you used when you report them.
          </p>
          {toc.map(g => <Group key={g.title} title={g.title} sections={g.sections} offset={g.offset} />)}
        </main>
      </div>
    </div>
  )
}
