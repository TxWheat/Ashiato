'use client'

import { useRef } from 'react'
import { clsx } from 'clsx'
import { Download, Upload, FileText, Image as ImageIcon, Share2, Table } from 'lucide-react'
import { EntityLabel, EntityType, NodeData } from '@/lib/types'
import { Cluster } from '@/lib/heuristics/cluster'
import { TornadoLink } from '@/lib/heuristics/eth/tornado'
import { TaintMethod, TaintResult } from '@/lib/taint'
import { ENTITY_STYLE, fmtAmount, fmtBalance } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'

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

const RISK_BAR: Record<string, string> = {
  clean: 'bg-green-500', low: 'bg-lime-500', medium: 'bg-yellow-500', high: 'bg-orange-500', critical: 'bg-red-500',
}

const METHODS: { id: TaintMethod; name: string; hint: string }[] = [
  { id: 'haircut', name: 'Haircut', hint: 'Proportional share (industry default)' },
  { id: 'fifo', name: 'FIFO', hint: 'First in, first out' },
  { id: 'poison', name: 'Poison', hint: 'Any contact taints all (upper bound)' },
]

export interface SidebarProps {
  origin?: NodeData
  counts: { nodes: number; edges: number; labelled: number; txs: number }
  legendTypes: EntityType[]
  auto: { depth: number; topK: number }
  onAuto: (a: { depth: number; topK: number }) => void
  taint: { seed: string; method: TaintMethod; asset: string } | null
  taintResult: TaintResult | null
  taintAssets: string[]
  onTaintMethod: (m: TaintMethod) => void
  onTaintAsset: (a: string) => void
  onTaintClear: () => void
  clusters: Cluster[]
  tornadoLinks: TornadoLink[]
  labelOf: (a: string) => EntityLabel | undefined
  onSelect: (address: string) => void
  onSaveCase: () => void
  onLoadCase: (file: File) => void
  onCsv: () => void
  onGraphml: () => void
  onPng: () => void
  onReport: () => void
}

export default function Sidebar(p: SidebarProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const o = p.origin
  const name = (a: string) => p.labelOf(a)?.name ?? truncate(a, 6)

  const ExportBtn = ({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) => (
    <button onClick={onClick} className="flex items-center gap-2 h-8 px-2.5 text-[11px] font-medium bg-raised hover:bg-line text-fg transition-colors">
      {icon}
      {children}
    </button>
  )

  return (
    <aside className="w-72 flex-shrink-0 border-r border-line bg-bg overflow-y-auto hidden md:block">
      {o && (
        <Section title="Subject">
          <code className="text-[10px] text-accent break-all block leading-relaxed">{o.address}</code>
          {o.label && (
            <div className="mt-2 flex items-center gap-2">
              <span className={clsx('w-2 h-2 rounded-full', ENTITY_STYLE[o.label.type].dot)} />
              <span className="text-sm font-medium text-fg">{o.label.name}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <div className="text-[10px] text-faint mb-0.5">Balance</div>
              <div className="text-xs font-mono text-fg">{fmtBalance(o.balance, o.chain)}</div>
            </div>
            <div>
              <div className="text-[10px] text-faint mb-0.5">Transactions</div>
              <div className="text-xs text-fg">{o.txCount.toLocaleString()}</div>
            </div>
          </div>
          {o.risk && (
            <div className="mt-4">
              <div className="flex justify-between text-[11px] mb-1.5">
                <span className="text-faint">Risk</span>
                <span className="font-mono text-fg">{o.risk.score}/100 <span className="capitalize text-muted">{o.risk.level}</span></span>
              </div>
              <div className="h-1 bg-raised">
                <div className={clsx('h-full', RISK_BAR[o.risk.level])} style={{ width: `${Math.max(2, o.risk.score)}%` }} />
              </div>
              <ul className="mt-2 space-y-1 text-[11px] text-muted list-disc pl-4">
                {o.risk.reasons.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
        </Section>
      )}

      <Section title="Auto-trace">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <label className="space-y-1">
            <span className="text-faint">Hops</span>
            <input type="number" min={1} max={6} value={p.auto.depth}
              onChange={e => p.onAuto({ ...p.auto, depth: Math.min(6, Math.max(1, +e.target.value || 1)) })}
              className="w-full h-8 px-2 bg-panel border border-line text-fg outline-none focus:border-accent" />
          </label>
          <label className="space-y-1">
            <span className="text-faint">Top per hop</span>
            <input type="number" min={1} max={8} value={p.auto.topK}
              onChange={e => p.onAuto({ ...p.auto, topK: Math.min(8, Math.max(1, +e.target.value || 1)) })}
              className="w-full h-8 px-2 bg-panel border border-line text-fg outline-none focus:border-accent" />
          </label>
        </div>
        <p className="mt-2 text-[10px] text-faint leading-relaxed">
          Select a node, then Auto-trace out or Source of funds. Stops at exchanges, deposit addresses, mixers and sanctioned wallets.
        </p>
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
          <div className="flex items-center gap-2 text-[11px] text-muted"><span className="w-3 border-t-2 border-accent" />Followed path</div>
          <div className="flex items-center gap-2 text-[11px] text-muted"><span className="w-3 border-t-2 border-red-500" />Tainted flow</div>
          <p className="text-[10px] text-faint pt-1">Thicker edges carry more value. Dashed borders are inferred labels.</p>
        </div>
      </Section>

      <Section title="Case & export">
        <div className="grid grid-cols-2 gap-2">
          <ExportBtn onClick={p.onSaveCase} icon={<Download size={12} />}>Save case</ExportBtn>
          <ExportBtn onClick={() => fileRef.current?.click()} icon={<Upload size={12} />}>Open case</ExportBtn>
          <ExportBtn onClick={p.onReport} icon={<FileText size={12} />}>Report</ExportBtn>
          <ExportBtn onClick={p.onPng} icon={<ImageIcon size={12} />}>PNG</ExportBtn>
          <ExportBtn onClick={p.onCsv} icon={<Table size={12} />}>CSV</ExportBtn>
          <ExportBtn onClick={p.onGraphml} icon={<Share2 size={12} />}>GraphML</ExportBtn>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) p.onLoadCase(f); e.target.value = '' }} />
        <p className="mt-2 text-[10px] text-faint">Case files stay on your computer. Nothing is uploaded.</p>
      </Section>

      <Section title="Stats">
        <dl className="space-y-1 text-[11px]">
          {[['Addresses on graph', p.counts.nodes], ['Fund flows', p.counts.edges], ['Labelled', p.counts.labelled], ['Transactions loaded', p.counts.txs]].map(([k, v]) => (
            <div key={k} className="flex justify-between"><dt className="text-faint">{k}</dt><dd className="text-fg">{v}</dd></div>
          ))}
        </dl>
      </Section>
    </aside>
  )
}
