'use client'

import { clsx } from 'clsx'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { EntityLabel, EntityType } from '@/lib/types'
import { Cluster } from '@/lib/heuristics/cluster'
import { TornadoLink } from '@/lib/heuristics/eth/tornado'
import { TaintMethod, TaintResult } from '@/lib/taint'
import { TracedFlow, TraceEnd, EndReason } from '@/lib/follow'
import { CheckedPayment } from '@/lib/client-payments'
import { PaymentStatusBadge } from './ClientPayments'
import { ENTITY_STYLE, fmtAmount } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'

export interface FollowSettings { hops: number; branches: number; adaptive: boolean; minSharePct: number }

const END_TITLE: Record<EndReason, string> = {
  entity: 'Reached an exchange / mixer / sanctioned',
  unspent: 'Still sitting (unspent)',
  'no-outflow': 'Not moved on yet',
  coinjoin: 'Entered a CoinJoin',
  'no-source': 'Origin of funds',
  'max-hops': 'Hop limit: continue from here',
  'not-loaded': 'Could not load',
  diluted: 'Pooled below the cut-off (stopped)',
  peel: 'Peeled-off payments (not followed)',
  split: 'Smaller splits (not followed)',
}
const END_ORDER: EndReason[] = ['entity', 'diluted', 'coinjoin', 'unspent', 'no-outflow', 'no-source', 'max-hops', 'peel', 'split', 'not-loaded']

function groupEnds(ends: TraceEnd[]) {
  return END_ORDER.map(reason => ({ reason, items: ends.filter(e => e.reason === reason).sort((a, b) => b.amount - a.amount) })).filter(g => g.items.length)
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="px-4 py-4 border-b border-line">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}


const METHODS: { id: TaintMethod; name: string; hint: string }[] = [
  { id: 'haircut', name: 'Haircut', hint: 'Proportional share (industry default)' },
  { id: 'fifo', name: 'FIFO', hint: 'First in, first out' },
  { id: 'poison', name: 'Poison', hint: 'Any contact taints all (upper bound)' },
]

export interface CasePanelProps {
  collapsed: boolean
  onToggle: () => void
  legendTypes: EntityType[]
  follow: FollowSettings
  onFollow: (f: FollowSettings) => void
  traced: TracedFlow[]
  traceEnds: TraceEnd[]
  onClearTrace: () => void
  taint: { seed: string; method: TaintMethod; asset: string } | null
  taintResult: TaintResult | null
  taintAssets: string[]
  onTaintMethod: (m: TaintMethod) => void
  onTaintAsset: (a: string) => void
  onTaintClear: () => void
  clusters: Cluster[]
  tornadoLinks: TornadoLink[]
  labelOf: (a: string) => EntityLabel | undefined
  nameOf: (a: string) => string | undefined
  onSelect: (address: string) => void
  payments: CheckedPayment[]
  onOpenPayments: () => void
}

export default function CasePanel(p: CasePanelProps) {
  const name = (a: string) => p.nameOf(a) ?? truncate(a, 6)

  return (
    p.collapsed ? (
      <aside className="w-10 flex-shrink-0 border-r border-line bg-bg flex flex-col items-center pt-3">
        <button onClick={p.onToggle} title="Show case panel: trace settings, where the money ended up, client payments, taint, legend" aria-label="Show case panel" className="text-faint hover:text-fg p-1.5"><PanelLeftOpen size={16} /></button>
        {p.traced.length > 0 && <span className="mt-2 w-2 h-2 rounded-full bg-accent" title="Trace results" />}
      </aside>
    ) : (
    <>
    {/* Phones: the panel opens over the graph as a drawer; tap outside to close */}
    <button onClick={p.onToggle} aria-label="Close case panel" className="md:hidden fixed inset-0 z-40 bg-black/50" />
    <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-2xl md:static md:z-auto md:w-64 md:max-w-none md:shadow-none flex-shrink-0 border-r border-line bg-bg overflow-y-auto">
      <div className="flex items-center justify-between h-10 px-4 border-b border-line">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">Case</span>
        <button onClick={p.onToggle} title="Hide case panel" aria-label="Hide case panel" className="text-faint hover:text-fg p-1"><PanelLeftClose size={14} /></button>
      </div>
      <Section
        title="Client payments"
        right={<button onClick={p.onOpenPayments} className="text-[10px] text-accent hover:text-fg">{p.payments.length ? 'Open' : 'Add'}</button>}
      >
        {p.payments.length === 0 ? (
          <p className="text-[11px] text-muted leading-relaxed">
            Got tx hashes, wallet addresses, amounts and dates from the client? <button onClick={p.onOpenPayments} className="text-fg underline underline-offset-2 hover:text-accent">Check them on-chain</button> and trace them all at once.
          </p>
        ) : (
          <div className="space-y-1.5">
            {p.payments.slice(0, 6).map((x, i) => (
              <button key={x.id} onClick={p.onOpenPayments} className="w-full flex items-center gap-2 text-[11px] hover:bg-panel -mx-1 px-1 h-6">
                <span className="text-faint w-4">{i + 1}</span>
                <span className="font-mono text-fg truncate">{x.match ? fmtAmount(x.match.amount, x.match.asset) : x.claim.amount !== undefined ? `${x.claim.amount} ${x.claim.asset ?? ''}` : '—'}</span>
                <span className="ml-auto"><PaymentStatusBadge status={x.status} /></span>
              </button>
            ))}
            {p.payments.length > 6 && <div className="text-[10px] text-faint">+{p.payments.length - 6} more</div>}
          </div>
        )}
      </Section>
      <Section
        title="Follow the funds"
        right={p.traced.length > 0 && <button onClick={p.onClearTrace} className="text-[10px] text-faint hover:text-fg">Clear</button>}
      >
        {p.traced.length === 0 ? (
          <p className="text-[11px] text-muted leading-relaxed">
            Open an address or transaction and press <b className="text-fg font-medium">Trace</b> on a specific payment. It reads each transaction and follows the trail: the remainder of a peel chain, the main outputs of a split, a same-amount pass-through on Ethereum. Each hop says why.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="text-[11px] text-muted">{p.traced.length} traced hops. Where the money ended up:</div>
            {groupEnds(p.traceEnds).map(g => (
              <div key={g.reason}>
                <div className="text-[10px] uppercase tracking-wider text-faint mt-2 mb-1">{END_TITLE[g.reason]}</div>
                {g.items.length > 6 && <div className="text-[10px] text-faint -mt-0.5 mb-1">{g.items.length} addresses, largest first</div>}
                {g.items.slice(0, 6).map((e, i) => {
                  const l = p.labelOf(e.address)
                  return (
                    <button key={i} onClick={() => p.onSelect(e.address)} title={e.detail} className="w-full flex items-center gap-2 text-[11px] hover:bg-panel -mx-1 px-1 h-6">
                      <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', l ? ENTITY_STYLE[l.type].dot : 'bg-faint')} />
                      <span className="truncate text-fg">{name(e.address)}</span>
                      <span className="ml-auto font-mono text-accent whitespace-nowrap">{fmtAmount(e.amount, e.asset)}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 text-[11px] mt-4">
          <label className="space-y-1">
            <span className="text-faint">Max hops</span>
            <input type="number" min={1} max={20} value={p.follow.hops}
              onChange={e => p.onFollow({ ...p.follow, hops: Math.min(20, Math.max(1, +e.target.value || 1)) })}
              className="w-full h-8 px-2 bg-panel border border-line text-fg outline-none focus:border-accent" />
          </label>
          {!p.follow.adaptive && (
            <label className="space-y-1">
              <span className="text-faint">Branches per hop</span>
              <input type="number" min={1} max={6} value={p.follow.branches}
                onChange={e => p.onFollow({ ...p.follow, branches: Math.min(6, Math.max(1, +e.target.value || 1)) })}
                className="w-full h-8 px-2 bg-panel border border-line text-fg outline-none focus:border-accent" />
            </label>
          )}
        </div>
        <label className="mt-3 block space-y-1 text-[11px]">
          <span className="text-faint">Stop when the traced funds are below this share of a pooled transaction or balance</span>
          <div className="flex items-center gap-2">
            <input type="number" min={0} max={100} step={5} value={p.follow.minSharePct}
              onChange={e => p.onFollow({ ...p.follow, minSharePct: Math.min(100, Math.max(0, +e.target.value || 0)) })}
              aria-label="Minimum share of pool"
              className="w-20 h-8 px-2 bg-panel border border-line text-fg outline-none focus:border-accent" />
            <span className="text-faint">% {p.follow.minSharePct === 0 && '(off)'}</span>
          </div>
        </label>
        <label className="mt-2 flex items-start gap-2 text-[11px] text-faint cursor-pointer">
          <input type="checkbox" checked={!p.follow.adaptive} onChange={e => p.onFollow({ ...p.follow, adaptive: !e.target.checked })} className="mt-0.5 accent-[rgb(var(--accent))]" />
          <span>Follow every output (no smart pruning). Off by default: the trace reads each transaction and keeps to the trail.</span>
        </label>
      </Section>

      <Section
        title="Taint analysis"
        right={p.taint && <button onClick={p.onTaintClear} className="text-[10px] text-faint hover:text-fg">Clear</button>}
      >
        {!p.taint ? (
          <p className="text-[11px] text-muted leading-relaxed">
            Select the address that holds stolen funds and click <b className="text-fg font-medium">Taint from here</b> to see how much reached each address.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="text-[11px] text-muted">Source: <span className="font-mono text-red-500">{name(p.taint.seed)}</span></div>
            <div className="grid grid-cols-3 border border-line">
              {METHODS.map((m, i) => (
                <button key={m.id} title={m.hint} onClick={() => p.onTaintMethod(m.id)}
                  className={clsx('h-7 text-[11px] font-medium', i > 0 && 'border-l border-line', p.taint!.method === m.id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}>
                  {m.name}
                </button>
              ))}
            </div>
            {p.taintAssets.length > 1 && (
              <select value={p.taint.asset} onChange={e => p.onTaintAsset(e.target.value)}
                className="w-full h-8 px-2 bg-panel border border-line text-[11px] text-fg outline-none">
                {p.taintAssets.map(a => <option key={a}>{a}</option>)}
              </select>
            )}
            {p.taintResult && (
              p.taintResult.reached.length === 0 ? (
                <p className="text-[11px] text-faint">No tainted outflows in the loaded transactions yet. Load or follow more of the trail.</p>
              ) : (
                <div className="space-y-1.5">
                  {p.taintResult.reached.slice(0, 8).map(r => {
                    const l = p.labelOf(r.address)
                    return (
                      <button key={r.address} onClick={() => p.onSelect(r.address)} className="w-full flex items-center gap-2 text-[11px] hover:bg-panel -mx-1 px-1 h-6">
                        <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', l ? ENTITY_STYLE[l.type].dot : 'bg-faint')} />
                        <span className="truncate text-fg">{name(r.address)}</span>
                        <span className="ml-auto font-mono text-red-500 whitespace-nowrap">{fmtAmount(r.received, p.taintResult!.asset)}</span>
                      </button>
                    )
                  })}
                  <p className="text-[10px] text-faint pt-1">{p.taintResult.txsUsed} tainted transactions in loaded data. Unloaded activity is not counted.</p>
                </div>
              )
            )}
          </div>
        )}
      </Section>

      {p.clusters.length > 0 && (
        <Section title={`Clusters (${p.clusters.length})`}>
          <div className="space-y-2">
            {p.clusters.slice(0, 8).map(c => (
              <button key={c.id} onClick={() => p.onSelect(c.members[0])} className="w-full text-left text-[11px] hover:bg-panel -mx-1 px-1 py-1">
                <div className="flex justify-between">
                  <span className="font-medium text-fg">C{c.id}{c.label ? ` · ${c.label.name.replace(' (cluster)', '')}` : ''}</span>
                  <span className="text-faint">{c.members.length} addrs</span>
                </div>
                <div className="text-faint truncate">{c.evidence[0]}</div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {p.tornadoLinks.length > 0 && (
        <Section title="Tornado Cash links">
          <div className="space-y-2">
            {p.tornadoLinks.slice(0, 6).map((l, i) => (
              <button key={i} onClick={() => p.onSelect(l.withdrawer)} className="w-full text-left text-[11px] hover:bg-panel -mx-1 px-1 py-1">
                <div className="font-mono text-fg">{name(l.depositor)} → {name(l.withdrawer)}</div>
                <div className="text-faint">{l.reason} · {Math.round(l.confidence * 100)}%</div>
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Legend">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] text-muted"><span className="w-3 h-3 border-2 border-accent" />Origin</div>
          {p.legendTypes.map(t => (
            <div key={t} className="flex items-center gap-2 text-[11px] text-muted">
              <span className={clsx('w-3 h-3 border-2', ENTITY_STYLE[t].border)} />
              {ENTITY_STYLE[t].label}
            </div>
          ))}
          <div className="flex items-center gap-2 text-[11px] text-muted"><span className="w-3 border-t-2 border-dashed border-faint" />Likely change</div>
          <div className="flex items-center gap-2 text-[11px] text-muted"><span className="w-3 border-t-2 border-accent" />Traced / followed funds</div>
          <div className="flex items-center gap-2 text-[11px] text-muted"><span className="w-3 border-t-2 border-red-500" />Tainted flow</div>
          <p className="text-[10px] text-faint pt-1">Thicker lines carry more value. Click any line to see its transactions. Dashed borders are inferred labels. With an address selected, <span className="text-green-500">green</span> boxes paid it and <span className="text-red-500">red</span> boxes were paid by it.</p>
        </div>
      </Section>

    </aside>
    </>
    )
  )
}
