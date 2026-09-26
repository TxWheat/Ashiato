'use client'

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { X, EyeOff, ExternalLink, ArrowRight, ArrowLeft, ArrowRightFromLine, ArrowLeftToLine, Check } from 'lucide-react'
import { Chain, EdgeData } from '@/lib/types'
import { TracedFlow } from '@/lib/follow'
import { explorerTxUrl, fmtAmount, fmtDate } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'
import { fmtMoney } from '@/lib/currency'
import { useSettings } from './Settings'
import { valueAt } from '@/lib/prices'
import { usePricing } from './Pricing'
import { AUTO_TRACE } from '@/lib/features'

type Tab = 'relationship' | 'transactions'

interface Props {
  a: string
  b: string
  chain: Chain
  /** Per-transaction flows between the pair, both directions */
  rows: EdgeData[]
  traced: TracedFlow[]
  prices: Record<string, number>
  busy: boolean
  /** Per-transaction ids currently drawn individually on the graph */
  itemized: Set<string>
  canLoadMore: boolean
  /** Whether every transaction between the pair is already loaded, and why / what Load more would do */
  historyNote?: string
  loadingMore: boolean
  initialTab?: Tab
  nameOf: (a: string) => string | undefined
  onSelect: (address: string) => void
  onTraceForward: (row: EdgeData) => void
  onTraceBack: (row: EdgeData) => void
  onToggleItem: (id: string) => void
  onItemize: (ids: string[] | null) => void
  onLoadMore: () => void
  onClose: () => void
  /** Remove this link from the graph (both directions); the addresses stay */
  onHide: () => void
  /** Remove one traced transaction (and what was traced onward from it only) */
  onRemoveTraced?: (flow: TracedFlow) => void
  /** Shown above the tabs (e.g. where a cross-chain swap went) */
  extra?: React.ReactNode
}

/** Contract-sent ETH: Etherscan lists these under "Internal Transactions", not "Transactions" */
export function InternalBadge() {
  return (
    <span className="text-[9px] px-1 bg-raised text-muted" title="Sent by a contract inside this transaction (e.g. a mixer withdrawal or a forwarder). On Etherscan it appears under the Internal Transactions tab, not Transactions.">
      internal
    </span>
  )
}

function totals(rows: EdgeData[]) {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.asset, (m.get(r.asset) ?? 0) + r.amount)
  return [...m]
}

export default function EdgeDetail(p: Props) {
  const { currency } = useSettings()
  const pricing = usePricing()
  const [tab, setTab] = useState<Tab>(p.initialTab ?? 'relationship')
  const [order, setOrder] = useState<'newest' | 'oldest' | 'largest'>('newest')
  const ab = p.rows.filter(r => r.source === p.a)
  const ba = p.rows.filter(r => r.source === p.b)
  const times = p.rows.map(r => r.timestamp).filter(Boolean)
  const itemizedHere = p.rows.filter(r => p.itemized.has(r.id)).length

  const sorted = useMemo(() => {
    const r = [...p.rows]
    if (order === 'newest') r.sort((x, y) => y.timestamp - x.timestamp)
    else if (order === 'oldest') r.sort((x, y) => x.timestamp - y.timestamp)
    else r.sort((x, y) => y.amount - x.amount)
    return r
  }, [p.rows, order])

  const Name = ({ a }: { a: string }) => (
    <button onClick={() => p.onSelect(a)} className="text-left min-w-0 hover:text-accent" title={a}>
      <div className={clsx('text-xs font-medium text-fg truncate', !p.nameOf(a) && 'font-mono')}>{p.nameOf(a) ?? truncate(a, 8)}</div>
      {p.nameOf(a) && <div className="text-[10px] font-mono text-faint truncate">{truncate(a, 6)}</div>}
    </button>
  )

  const Direction = ({ from, to, rows }: { from: string; to: string; rows: EdgeData[] }) => (
    <div className="border border-line p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-[11px] text-faint">
        <span className="truncate">{p.nameOf(from) ?? truncate(from, 6)}</span>
        <ArrowRight size={11} className="flex-shrink-0" />
        <span className="truncate">{p.nameOf(to) ?? truncate(to, 6)}</span>
        <span className="ml-auto whitespace-nowrap">{rows.length} tx{rows.length === 1 ? '' : 's'}</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-faint">Nothing in loaded data</div>
      ) : (
        totals(rows).map(([asset, amt]) => {
          // Each transaction at its own time (or today's price, per Settings)
          const value = rows.filter(r => r.asset === asset).reduce((v, r) => v + valueAt(pricing, r.amount, asset, r.timestamp), 0)
          return (
            <div key={asset} className="text-sm font-mono text-fg">
              {fmtAmount(amt, asset, 8)}
              {value > 0 && <span className="text-[11px] text-faint"> · {fmtMoney(value, currency, true)}{pricing.atTransfer && pricing.history ? ' at the time' : ' today'}</span>}
            </div>
          )
        })
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-4 border-b border-line space-y-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-faint">Between two addresses</span>
          <div className="flex items-center gap-1">
            <button onClick={p.onHide} title="Hide this link from the graph (Delete key). The addresses stay; restore it from “hidden links” on the graph."
              className="flex items-center gap-1 h-6 px-2 text-[11px] font-medium bg-raised hover:bg-line text-fg">
              <EyeOff size={11} /> Hide link
            </button>
            <button onClick={p.onClose} className="text-faint hover:text-fg p-1" aria-label="Close"><X size={14} /></button>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <Name a={p.a} />
          <span className="flex flex-col items-center text-faint"><ArrowRight size={12} /><ArrowLeft size={12} /></span>
          <Name a={p.b} />
        </div>
      </div>

      {/* Above the tabs so it shows whichever tab opens (e.g. where a cross-chain swap went) */}
      {p.extra && <div className="px-4 pt-3 pb-3 border-b border-line flex-shrink-0 max-h-[45%] overflow-y-auto">{p.extra}</div>}

      <div className="flex border-b border-line flex-shrink-0 text-[12px] font-medium">
        {(['relationship', 'transactions'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('flex-1 h-10 border-b-2 -mb-px capitalize', tab === t ? 'border-accent text-fg' : 'border-transparent text-faint hover:text-fg')}>
            {t === 'transactions' ? `Transactions · ${p.rows.length}` : 'Relationship'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === 'relationship' ? (
          <div className="p-4 space-y-3">
            <Direction from={p.a} to={p.b} rows={ab} />
            <Direction from={p.b} to={p.a} rows={ba} />
            {times.length > 0 && (
              <div className="text-[11px] text-faint">
                First seen {fmtDate(Math.min(...times))} · last seen {fmtDate(Math.max(...times))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {p.rows.length <= 1 && itemizedHere === 0 ? (
                <span className="text-[11px] text-faint self-center">One transaction: the line already shows it.</span>
              ) : itemizedHere > 0 ? (
                <button onClick={() => p.onItemize(null)} className="h-8 px-3 text-[11px] font-medium bg-raised hover:bg-line text-fg">
                  Show as one relationship line
                </button>
              ) : (
                <button onClick={() => p.onItemize(p.rows.map(r => r.id))} disabled={!p.rows.length}
                  className="h-8 px-3 text-[11px] font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-40">
                  Show each transaction on the graph
                </button>
              )}
              {p.canLoadMore && (
                <button onClick={p.onLoadMore} disabled={p.loadingMore} className="h-8 px-3 text-[11px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-50">
                  {p.loadingMore ? 'Loading…' : 'Load more history'}
                </button>
              )}
            </div>
            {p.historyNote && <p className="text-[11px] text-faint leading-relaxed">{p.historyNote}</p>}
            {p.traced.length > 0 && (
              <div className="pt-2 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-faint">Traced funds on this relationship</div>
                {p.traced.map((f, i) => (
                  <div key={i} className="border-l-2 border-accent pl-3">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-mono text-accent">{fmtAmount(f.amount, f.asset, 8)} · hop {f.hop}</div>
                      <span className="text-[10px] font-mono text-faint">{truncate(f.txid, 6)}</span>
                      {p.onRemoveTraced && (
                        <button onClick={() => p.onRemoveTraced!(f)} disabled={p.busy} title="Remove this traced transaction, and anything traced onward only from it"
                          className="ml-auto text-faint hover:text-red-500 disabled:opacity-30" aria-label="Remove traced transaction"><X size={12} /></button>
                      )}
                    </div>
                    <div className="text-[11px] text-muted leading-relaxed">{f.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line sticky top-0 bg-bg z-10 text-[11px]">
              <select value={order} onChange={e => setOrder(e.target.value as typeof order)} aria-label="Order"
                className="h-7 px-1.5 bg-panel border border-line text-fg outline-none focus:border-accent">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="largest">Largest first</option>
              </select>
              <button onClick={() => p.onItemize(itemizedHere === p.rows.length ? null : p.rows.map(r => r.id))}
                className="ml-auto h-7 px-2 font-medium bg-raised hover:bg-line text-fg">
                {itemizedHere === p.rows.length && p.rows.length ? 'Hide all from graph' : 'Show all on graph'}
              </button>
            </div>
            <p className="px-4 pt-3 text-[11px] text-faint leading-relaxed">
              Tick a transaction to draw it on the graph as its own line. <b className="text-fg font-medium">Trace</b> follows it onward, <b className="text-fg font-medium">Source</b> walks it back.
            </p>
            {sorted.map(r => {
              const on = p.itemized.has(r.id)
              const out = r.source === p.a
              return (
                <div key={r.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-line/60 hover:bg-panel">
                  <button onClick={() => p.onToggleItem(r.id)} aria-label={on ? 'Remove from graph' : 'Show on graph'}
                    className={clsx('mt-0.5 grid place-items-center w-4 h-4 border flex-shrink-0', on ? 'bg-accent border-accent text-accent-fg' : 'border-line hover:border-accent')}>
                    {on && <Check size={11} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-faint whitespace-nowrap">{out ? '→' : '←'} {fmtDate(r.timestamp)}</span>
                      <span className="ml-auto font-mono text-[12px] text-fg whitespace-nowrap">{fmtAmount(r.amount, r.asset, 8)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <a href={explorerTxUrl(r.txid, p.chain)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-mono text-[10px] text-faint hover:text-fg">
                        {truncate(r.txid, 6)} <ExternalLink size={9} />
                      </a>
                      {r.isChange && <span className="text-[9px] px-1 bg-yellow-500/15 text-yellow-600">likely change</span>}
                      {r.kind === 'internal' && <InternalBadge />}
                      {AUTO_TRACE && <div className="ml-auto flex gap-1">
                        <button onClick={() => p.onTraceBack(r)} disabled={p.busy}
                          className="flex items-center gap-1 h-6 px-1.5 text-[10px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-40">
                          <ArrowLeftToLine size={10} /> Source
                        </button>
                        <button onClick={() => p.onTraceForward(r)} disabled={p.busy}
                          className="flex items-center gap-1 h-6 px-1.5 text-[10px] font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-40">
                          Trace <ArrowRightFromLine size={10} />
                        </button>
                      </div>}
                    </div>
                  </div>
                </div>
              )
            })}
            {(p.canLoadMore || p.historyNote) && (
              <div className="p-3 space-y-2 text-center">
                {p.historyNote && <p className="text-[11px] text-faint leading-relaxed text-left">{p.historyNote}</p>}
                {p.canLoadMore && (
                  <button onClick={p.onLoadMore} disabled={p.loadingMore} className="h-8 px-4 text-[11px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-50">
                    {p.loadingMore ? 'Loading…' : 'Load more history'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
