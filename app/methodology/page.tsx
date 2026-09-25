import type { Metadata } from 'next'
import SiteNav from '@/components/SiteNav'

export const metadata: Metadata = {
  title: 'Methodology · CryptoTracer',
  description: 'How CryptoTracer labels addresses, detects change, CoinJoins and exchange deposit addresses, scores risk and runs taint analysis, and where each method can be wrong.',
}

const SECTIONS: { id: string; title: string; body: string[]; limits: string; credit?: string }[] = [
  {
    id: 'labels',
    title: 'Entity labels',
    body: [
      'Addresses are matched against GraphSense TagPacks (exchanges, scams, ransomware, hacks, darknet markets, CoinJoin coordinators), Etherscan public name tags from the eth-labels dataset (exchange hot wallets and deposit addresses, phishing, exploits), the US Treasury OFAC SDN list of sanctioned addresses, and a small curated list. Ethereum addresses loaded onto the graph are also checked against Etherscan: public name tags when the API plan includes them (Pro Plus), otherwise a verified contract’s own name, shown as inferred because the deployer chose it. Every label links to its public source.',
      'BitMEX deposit addresses are recognised by their 3BMEX vanity prefix.',
    ],
    limits: 'Labels are only as good as their sources. No label does not mean clean. Most addresses in the world are unlabelled.',
    credit: 'graphsense/graphsense-tagpacks (MIT), 0xB10C/ofac-sanctioned-digital-currency-addresses',
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
    id: 'taint',
    title: 'Taint analysis',
    body: [
      'Poison: any tainted input taints all outputs in full (upper bound). Haircut: each output carries taint in proportion to the tainted share of the inputs (the usual industry default). FIFO: tainted value fills outputs in order (Clayton\'s case).',
      'Bitcoin taint follows exact UTXOs. Ethereum is account-based, so each address keeps a running balance (Haircut) or a queue of received lots (FIFO).',
    ],
    limits: 'Only loaded transactions are used, so amounts are a lower bound. The three methods can give very different answers; report which one you used.',
    credit: 'TrailBit-Labs/TaintTrail; tintiron/taintedtx',
  },
  {
    id: 'risk',
    title: 'Risk score',
    body: [
      '0–100, the maximum of: the address\'s own label (e.g. sanctioned = 100, mixer = 70), its strongest direct exposure to risky counterparties by share of value, and behaviour (CoinJoin participation 45, Tornado Cash use 60). Bands: clean <8 · low 8–25 · medium 25–50 · high 50–75 · critical 75+.',
    ],
    limits: 'Direct (1-hop) exposure only, within the loaded page. A low score is not a clean bill of health.',
    credit: 'Model after peterzen/heuristic',
  },
  {
    id: 'follow',
    title: 'Follow the funds',
    body: [
      'Tracing follows a specific amount of money, not "the biggest counterparties". You always start from a specific transaction: open it and press Trace (onward) or Source (backward).',
      'Bitcoin is exact. Every payment creates specific coins (UTXOs). We look up the transaction that later spent those coins and split the traced amount across its outputs in proportion to the coins\' share of that transaction\'s inputs. Source of funds walks the same links backwards through inputs.',
      'Ethereum and Tron balances are pooled, so a heuristic is needed. From the moment funds arrive at an address, the next outflows of the same asset are taken, in time order, until the arrived amount is used up (small differences for gas are tolerated). Outflows before the funds arrived are never followed, and a large later transfer cannot be attributed to a small incoming payment. Source of funds takes the most recent inflows before the money left.',
      'Tracing is adaptive: each spending transaction is classified and only the trail is followed. A peel (one or two input addresses, a small payment and a remainder at least three times larger) follows the remainder and lists the peeled payment instead of expanding it, unless it lands at an exchange, mixer or other flagged endpoint. A sweep into one output follows it; two comparable outputs are both followed; a split into many outputs follows the largest ones covering about 80% of the value. On Ethereum, an outflow of the same amount (within about 3%) after the funds arrived is taken as a pass-through and followed alone. “Follow every output” in the Case panel turns this off.',
      'Pooling: at every hop the traced funds’ share of the pool they move in is measured. On Bitcoin that is their share of the coins spent together in the transaction; on Ethereum and Tron it is their share of the balance, counting other funds that arrived after them and before the money moved on. Traced lines show the share (e.g. “42% of pool”), and when it falls below the cut-off in the Case panel (35% by default; 0 turns it off) the trail stops and the address is marked “pooled”, because further outflows are no longer meaningfully the client’s money.',
      'A trail ends at an exchange, exchange deposit address, mixer, CoinJoin, DeFi protocol or sanctioned address, when coins are still unspent, or at the hop limit. Every hop records its reason, shown when you click the line and in the report.',
    ],
    limits: 'A balance already sitting at an Ethereum or Tron address before the traced funds arrived is not visible from loaded history, so the pool share can be overstated there. The Ethereum rule is a convention investigators commonly use, not proof: if the address already held other funds, a different outflow could be "the" victim\'s money. Only loaded history is searched (up to several pages per address).',
    credit: 'UTXO tracing via Esplora outspends; hop display after s0md3v/Orbit; source-of-funds walk after peterzen/heuristic',
  },
]

export default function Methodology() {
  return (
    <div className="min-h-screen">
      <SiteNav />
      <div className="grid lg:grid-cols-[280px_1fr]">
        <nav className="hidden lg:block border-r border-line p-10 sticky top-0 self-start">
          <div className="text-[10px] uppercase tracking-[0.14em] text-faint mb-4">Contents</div>
          <ol className="space-y-2 text-sm">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-muted hover:text-fg"><span className="font-mono text-faint mr-2">0{i + 1}</span>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <main className="max-w-3xl px-4 sm:px-10 py-14">
          <h1 className="text-5xl sm:text-6xl font-light tracking-[-0.03em] text-fg mb-6">Methodology</h1>
          <p className="text-muted leading-relaxed mb-12">
            Everything here is a heuristic: a documented rule of thumb with a confidence, not proof. Use the findings as leads, verify them on a block explorer, and say which method you used when you report them.
          </p>
          {SECTIONS.map((s, i) => (
            <section key={s.id} id={s.id} className="border-t border-line py-10 scroll-mt-4">
              <div className="font-mono text-xs text-faint mb-3">0{i + 1}</div>
              <h2 className="text-2xl font-medium text-fg mb-4">{s.title}</h2>
              <div className="space-y-3 text-[15px] leading-relaxed text-muted">
                {s.body.map((b, k) => <p key={k}>{b}</p>)}
              </div>
              <div className="mt-5 border-l-2 border-yellow-500 pl-4 text-sm text-muted">
                <span className="font-medium text-fg">Limits. </span>{s.limits}
              </div>
              {s.credit && <div className="mt-3 text-xs text-faint">Credit: {s.credit}</div>}
            </section>
          ))}
        </main>
      </div>
    </div>
  )
}
