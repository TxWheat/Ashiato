import Link from 'next/link'
import SiteNav from '@/components/SiteNav'
import SearchForm from '@/components/SearchForm'
import { labelStats } from '@/lib/labels'
import { Bitcoin, ShieldAlert, Droplets } from 'lucide-react'

function EthGlyph({ size = 96 }: { size?: number }) {
  return (
    <svg width={size * 0.62} height={size} viewBox="0 0 62 100" aria-hidden>
      <path d="M31 0 0 51l31 18 31-18z" fill="currentColor" opacity=".75" />
      <path d="M31 0v69l31-18z" fill="currentColor" opacity=".45" />
      <path d="M0 57l31 43 31-43-31 18z" fill="currentColor" opacity=".75" />
    </svg>
  )
}

const FEATURES = [
  {
    title: 'Exchange deposit addresses',
    body: 'Spots the customer deposit address where stolen funds were cashed out, the detail an exchange needs to identify the account holder.',
  },
  {
    title: 'Taint analysis',
    body: 'Poison, haircut and FIFO models show how much of the stolen amount reached each address, traced exactly through Bitcoin UTXOs.',
  },
  {
    title: 'Mixers & CoinJoins',
    body: 'Fingerprints Whirlpool, Wasabi and JoinMarket rounds and runs the Tornado Cash address-reuse, gas-price and denomination reveals.',
  },
  {
    title: 'Sanctions & risk',
    body: 'Screens every address against the OFAC SDN list and 120k+ open-source labels, then scores 0–100 risk with the reasons shown.',
  },
]

export default function Home() {
  const stats = labelStats()
  const tiles = [
    { value: stats.btc.toLocaleString('en-US'), label: 'Bitcoin labels', dot: 'bg-orange-500' },
    { value: stats.eth.toLocaleString('en-US'), label: 'Ethereum labels', dot: 'bg-violet-500' },
    { value: stats.sanctioned.toLocaleString('en-US'), label: 'OFAC sanctioned addresses', dot: 'bg-red-500' },
    { value: '$0', label: 'Cost. No sign-up, open source', dot: 'bg-green-500' },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <SiteNav />

      <section className="grid lg:grid-cols-2 border-b border-line">
        {/* Left: headline + search */}
        <div className="relative flex flex-col justify-end gap-10 px-4 sm:px-10 pt-24 pb-14 lg:min-h-[640px] overflow-hidden">
          <div
            className="halftone absolute inset-0 pointer-events-none"
            style={{ maskImage: 'radial-gradient(ellipse at 90% 30%, black, transparent 65%)', WebkitMaskImage: 'radial-gradient(ellipse at 90% 30%, black, transparent 65%)' }}
          />
          <h1 className="relative text-[56px] sm:text-[88px] leading-[0.95] font-light tracking-[-0.03em] text-fg">
            Trace
            <br />
            the money
          </h1>
          <div className="relative space-y-6">
            <p className="flex items-center gap-3 text-sm font-medium text-fg">
              <span className="grid place-items-center w-5 h-5 rounded-full bg-fg">
                <span className="w-1.5 h-1.5 rotate-45 bg-bg" />
              </span>
              Free blockchain forensics for scam victims and investigators
            </p>
            <SearchForm />
            <p className="text-xs text-faint">
              Bitcoin works out of the box. Ethereum (ETH + ERC-20) needs a free Etherscan API key.{' '}
              <Link href="/methodology" className="underline underline-offset-2 hover:text-fg">How it works</Link>
            </p>
          </div>
        </div>

        {/* Right: stat tiles on a hairline grid */}
        <div className="grid grid-cols-2 lg:border-l border-t lg:border-t-0 border-line">
          {tiles.map((t, i) => (
            <div
              key={t.label}
              className={`flex flex-col justify-end p-5 sm:p-6 min-h-[130px] lg:min-h-0 ${i % 2 === 0 ? 'border-r border-line' : ''} ${i < 2 ? 'border-b border-line' : ''}`}
            >
              <div className="text-3xl sm:text-5xl font-medium tracking-tight text-fg">{t.value}</div>
              <div className="mt-2 flex items-center gap-2 text-xs sm:text-sm font-medium text-muted">
                <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                {t.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-2 border-b border-line">
        <div className="grid grid-cols-2">
          {[
            { label: 'Bitcoin: UTXO-exact tracing', value: 'BTC', icon: <Bitcoin size={96} strokeWidth={1.25} />, dot: 'bg-orange-500' },
            { label: 'Ethereum: ETH + ERC-20', value: 'ETH', icon: <EthGlyph />, dot: 'bg-violet-500' },
            { label: 'Screened on every lookup', value: 'OFAC', icon: <ShieldAlert size={96} strokeWidth={1.25} />, dot: 'bg-red-500' },
            { label: 'Poison · Haircut · FIFO', value: 'Taint', icon: <Droplets size={96} strokeWidth={1.25} />, dot: 'bg-green-500' },
          ].map((t, i) => (
            <div
              key={t.label}
              className={`flex flex-col justify-between gap-6 p-5 sm:p-6 min-h-[260px] sm:min-h-[340px] ${i % 2 === 0 ? 'border-r border-line' : ''} ${i < 2 ? 'border-b border-line' : ''}`}
            >
              <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-fg">
                <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                {t.label}
              </div>
              <div className="self-center text-faint">{t.icon}</div>
              <div className="text-3xl sm:text-5xl font-medium tracking-tight text-fg">{t.value}</div>
            </div>
          ))}
        </div>
        <div className="relative flex flex-col items-center justify-center text-center gap-4 px-6 py-24 lg:border-l border-t lg:border-t-0 border-line overflow-hidden">
          <div
            className="halftone absolute inset-0 pointer-events-none"
            style={{ maskImage: 'radial-gradient(ellipse at center, black 10%, transparent 75%)', WebkitMaskImage: 'radial-gradient(ellipse at center, black 10%, transparent 75%)' }}
          />
          <div className="relative text-2xl sm:text-4xl font-medium text-fg">Addresses identified</div>
          <div className="relative text-[64px] sm:text-[120px] leading-none font-light tracking-[-0.04em] text-fg">
            {(stats.btc + stats.eth).toLocaleString('en-US')}
          </div>
          <p className="relative text-xs sm:text-sm font-medium text-muted max-w-sm">
            Exchanges, mixers, scams, ransomware, hacks and sanctioned wallets from open, source-linked datasets.
          </p>
        </div>
      </section>

      <section className="grid sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <div key={f.title} className={`p-6 sm:p-8 border-b border-line ${i < 3 ? 'lg:border-r' : ''} ${i % 2 === 0 ? 'sm:border-r' : ''}`}>
            <div className="text-[11px] font-mono text-faint mb-4">0{i + 1}</div>
            <h2 className="text-lg font-medium text-fg mb-2">{f.title}</h2>
            <p className="text-sm leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="px-4 sm:px-10 py-6 text-xs text-faint flex flex-wrap gap-x-6 gap-y-2">
        <span>Labels: GraphSense TagPacks (MIT), US Treasury OFAC SDN list</span>
        <span>Data: Blockstream / mempool.space Esplora, Etherscan</span>
        <span>Heuristics are leads, not proof. Verify before acting.</span>
      </footer>
    </div>
  )
}
