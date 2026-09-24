'use client'

import { clsx } from 'clsx'
import { X, ExternalLink, ArrowRight, ArrowRightFromLine, ArrowLeftToLine } from 'lucide-react'
import { Chain, EdgeData } from '@/lib/types'
import { TracedFlow } from '@/lib/follow'
import { explorerTxUrl, fiatValue, fmtAmount, fmtDate } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'

interface Props {
  from: string
  to: string
  chain: Chain
  /** Per-transaction flows between the pair */
  rows: EdgeData[]
  traced: TracedFlow[]
  prices: Record<string, number>
  busy: boolean
  nameOf: (a: string) => string | undefined
  onSelect: (address: string) => void
  onTraceForward: (row: EdgeData) => void
  onTraceBack: (row: EdgeData) => void
  onClose: () => void
}

export default function EdgeDetail(p: Props) {
  const rows = [...p.rows].sort((a, b) => b.timestamp - a.timestamp)
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.asset, (totals.get(r.asset) ?? 0) + r.amount)

  const Addr = ({ a }: { a: string }) => (
    <button onClick={() => p.onSelect(a)} className="text-left min-w-0 hover:text-accent" title={a}>
      <div className="text-xs font-medium text-fg truncate">{p.nameOf(a) ?? truncate(a, 8)}</div>
      {p.nameOf(a) && <div className="text-[10px] font-mono text-faint truncate">{truncate(a, 6)}</div>}
    </button>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between h-10 px-4 border-b border-line flex-shrink-0">
        <span className="text-[10px] font-medium uppercase tracking-wider text-faint">Flow between two addresses</span>
        <button onClick={p.onClose} className="text-faint hover:text-fg p-1" aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-line">
        <section className="p-4 space-y-3">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <Addr a={p.from} />
            <ArrowRight size={14} className="text-faint" />
            <Addr a={p.to} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {[...totals].map(([asset, amt]) => (
              <div key={asset} className="text-sm font-mono text-fg">
                {fmtAmount(amt, asset, 8)}
                {fiatValue(amt, asset, p.prices) > 0 && (
                  <span className="text-[11px] text-faint"> · ${Math.round(fiatValue(amt, asset, p.prices)).toLocaleString('en-NZ')} NZD today</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-faint">{rows.length} transaction{rows.length === 1 ? '' : 's'} in loaded data</p>
        </section>

        {p.traced.length > 0 && (
          <section className="p-4 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-faint">Traced funds on this flow</div>
            {p.traced.map((f, i) => (
              <div key={i} className="border-l-2 border-accent pl-3">
                <div className="text-xs font-mono text-accent">{fmtAmount(f.amount, f.asset, 8)} · hop {f.hop}</div>
                <div className="text-[11px] text-muted leading-relaxed">{f.reason}</div>
              </div>
            ))}
          </section>
        )}

        <section className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-faint mb-2">Transactions</div>
          <p className="text-[11px] text-muted mb-3 leading-relaxed">
            <b className="text-fg font-medium">Trace →</b> follows this exact payment onward. <b className="text-fg font-medium">← Source</b> walks back to where it came from.
          </p>
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="border border-line p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-mono text-fg">{fmtAmount(r.amount, r.asset, 8)}</span>
                  <span className="text-[10px] text-faint whitespace-nowrap">{fmtDate(r.timestamp)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <a
                    href={explorerTxUrl(r.txid, p.chain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] font-mono text-muted hover:text-accent"
                  >
                    {truncate(r.txid, 8)} <ExternalLink size={9} />
                  </a>
                  {r.isChange && <span className="text-[9px] px-1 bg-yellow-500/15 text-yellow-600">likely change</span>}
                  <div className="ml-auto flex gap-1">
                    <button
                      onClick={() => p.onTraceBack(r)}
                      disabled={p.busy}
                      className={clsx('flex items-center gap-1 h-6 px-2 text-[10px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-40')}
                    >
                      <ArrowLeftToLine size={10} /> Source
                    </button>
                    <button
                      onClick={() => p.onTraceForward(r)}
                      disabled={p.busy}
                      className="flex items-center gap-1 h-6 px-2 text-[10px] font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-40"
                    >
                      Trace <ArrowRightFromLine size={10} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
