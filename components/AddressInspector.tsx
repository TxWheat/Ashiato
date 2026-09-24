'use client'

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Copy, Check, ExternalLink, Plus, CheckCircle2, ArrowRightFromLine, ArrowLeftToLine, Droplets, Trash2, AlertTriangle,
} from 'lucide-react'
import { EntityLabel, NodeData, RawTransaction, transferKey } from '@/lib/types'
import { Counterparty, FlowSummary } from '@/lib/counterparties'
import { Cluster } from '@/lib/heuristics/cluster'
import { LoadedPage } from '@/lib/export'
import { ENTITY_STYLE, explorerAddressUrl, explorerTxUrl, fmtAmount, fmtBalance, fmtCompact, fmtDate, fmtFiatShort, fiatValue } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'

export type AddressTab = 'counterparties' | 'transactions' | 'details'

/** Assets that are never airdrop spam */
const MAJOR = new Set(['ETH', 'BTC', 'USDT', 'USDC', 'DAI', 'WETH', 'WBTC'])
type SortKey = 'amount' | 'txs' | 'recent'

const RISK_BAR: Record<string, string> = {
  clean: 'bg-green-500', low: 'bg-lime-500', medium: 'bg-yellow-500', high: 'bg-orange-500', critical: 'bg-red-500',
}

const HEURISTIC_NAME: Record<string, string> = {
  'deposit-address': 'Exchange deposit address',
  'coinjoin-participant': 'CoinJoin participant',
  'tornado-usage': 'Tornado Cash usage',
  'tornado-address-match': 'Tornado: address reuse',
  'tornado-gas-fingerprint': 'Tornado: gas-price fingerprint',
  'address-poisoning': 'Address poisoning attempts',
}

interface Props {
  /** Today's NZD prices, used to rank counterparties across different assets */
  prices: Record<string, number>
  node: NodeData
  page?: LoadedPage
  loading: boolean
  loadingMore: boolean
  counterparties: Counterparty[]
  onGraph: Set<string>
  tab: AddressTab
  canRemove: boolean
  tracing: boolean
  cluster?: Cluster
  taint?: { amount: number; asset: string; isSeed: boolean }
  nameOf: (a: string) => string | undefined
  labelOf: (a: string) => EntityLabel | undefined
  onTab: (t: AddressTab) => void
  onAdd: (addresses: string[]) => void
  onOpen: (address: string) => void
  onTraceTx: (tx: RawTransaction, direction: 'forward' | 'backward') => void
  summary: FlowSummary
  /** Open the relationship (flow panel) between this address and a counterparty */
  onOpenRelationship: (address: string) => void
  /** Draw one transaction on the graph as its own line */
  onShowTx: (tx: RawTransaction) => void
  onTaint: () => void
  onRemove: () => void
  onLoadMore: () => void
  onNote: (note: string) => void
  onShowCluster: () => void
}

function amounts(rec: Record<string, number>) {
  return Object.entries(rec).map(([asset, amt]) => fmtCompact(amt, asset)).join(' + ')
}

/** Breadcrumbs-style node visualizer: totals in and out, per asset, with transaction counts */
function FlowBoxes({ summary }: { summary: FlowSummary }) {
  const box = (title: string, rec: FlowSummary['incoming'], tone: string) => {
    const rows = Object.entries(rec)
    const major = rows.filter(([a]) => MAJOR.has(a)).sort((x, y) => y[1].count - x[1].count)
    const other = rows.filter(([a]) => !MAJOR.has(a))
    return (
      <div className="border border-line p-2.5 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-faint mb-1.5">{title}</div>
        {rows.length === 0 && <div className="text-[11px] text-faint">None loaded</div>}
        {major.map(([asset, v]) => (
          <div key={asset} className={clsx('text-[12px] font-mono truncate', tone)}>
            {fmtCompact(v.amount, asset)} <span className="text-faint">({v.count})</span>
          </div>
        ))}
        {other.length > 0 && (
          <div className="text-[10px] text-faint mt-0.5" title={other.map(([a, v]) => `${fmtCompact(v.amount, a)} (${v.count})`).join('\n')}>
            + {other.length} other token{other.length === 1 ? '' : 's'}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {box('Incoming txs', summary.incoming, 'text-green-500')}
      {box('Outgoing txs', summary.outgoing, 'text-fg')}
    </div>
  )
}

export default function AddressInspector(p: Props) {
  const { node } = p
  const [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState<'in' | 'out'>('in')
  const [sort, setSort] = useState<SortKey>('amount')
  const [asset, setAsset] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [showSpam, setShowSpam] = useState(false)
  const type = node.label?.type ?? 'unknown'
  const style = ENTITY_STYLE[type]
  const title = node.label?.name ?? node.ens

  const totalsByAsset = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of p.counterparties) for (const [k, v] of [...Object.entries(c.received), ...Object.entries(c.sent)]) m.set(k, (m.get(k) ?? 0) + v)
    return m
  }, [p.counterparties])
  // Poisoning, fake tokens, and unsolicited airdrops of unknown tokens (never sent back)
  const isSpam = (c: Counterparty) =>
    p.labelOf(c.address)?.inferredBy === 'address-poisoning' ||
    [...Object.keys(c.received), ...Object.keys(c.sent)].every(x => x.endsWith('*')) ||
    (!Object.keys(c.sent).length && !p.labelOf(c.address) && Object.keys(c.received).every(x => !MAJOR.has(x)))
  const spamCount = p.counterparties.filter(isSpam).length
  const assets = useMemo(
    () => [...new Set(p.counterparties.flatMap(c => [...Object.keys(c.received), ...Object.keys(c.sent)]))].filter(x => !x.endsWith('*')).sort(),
    [p.counterparties]
  )

  /** The side of the relationship the current tab is about */
  const sideOf = (c: Counterparty, f = filter) => (f === 'in' ? c.received : c.sent)
  const countOf = (c: Counterparty, f = filter) => (f === 'in' ? c.receivedCount : c.sentCount)
  const lastOf = (c: Counterparty) => (filter === 'in' ? c.lastReceived : c.lastSent)
  /** NZD value today of what moved on the selected side (unpriced tokens count as 0) */
  const valueOf = (c: Counterparty) => Object.entries(sideOf(c)).reduce((v, [k, a]) => v + fiatValue(a, k, p.prices), 0)
  const visibleCps = p.counterparties.filter(c => showSpam || !isSpam(c))
  const dirCount = (f: 'in' | 'out') => visibleCps.filter(c => Object.keys(sideOf(c, f)).length).length

  const list = useMemo(() => {
    const min = parseFloat(minAmount) || 0
    const amt = (c: Counterparty) => (asset ? sideOf(c)[asset] ?? 0 : 0)
    // Across mixed assets, amounts aren't comparable, so rank by share of each asset's flow
    const share = (rec: Record<string, number>) => {
      let best = 0
      for (const [k, v] of Object.entries(rec)) best = Math.max(best, v / (totalsByAsset.get(k) || 1))
      return best
    }
    const score: Record<SortKey, (c: Counterparty) => number> = {
      // Priced flows rank by NZD value; ones with no price (unknown tokens) go after, by share of that token's flow
      amount: c => (asset ? amt(c) : valueOf(c) > 0 ? 1e15 + valueOf(c) : share(sideOf(c))),
      txs: c => countOf(c),
      recent: c => lastOf(c),
    }
    return visibleCps
      .filter(c => Object.keys(sideOf(c)).length)
      .filter(c => !asset || sideOf(c)[asset] !== undefined)
      .filter(c => !asset || !min || amt(c) >= min)
      .sort((x, y) => score[sort](y) - score[sort](x))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.counterparties, filter, sort, asset, minAmount, showSpam, p.prices])
  const notOnGraph = list.filter(c => !p.onGraph.has(c.address))

  const copy = () => {
    navigator.clipboard.writeText(node.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const ActionBtn = ({ onClick, icon, children, disabled, title: t }: { onClick: () => void; icon: React.ReactNode; children?: React.ReactNode; disabled?: boolean; title?: string }) => (
    <button onClick={onClick} disabled={disabled} title={t}
      className="flex items-center justify-center gap-1.5 h-8 px-2.5 text-[11px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-40 disabled:cursor-not-allowed">
      {icon}{children}
    </button>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Identity */}
      <div className="p-4 border-b border-line space-y-3 flex-shrink-0">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider">
          <span className={clsx('w-1.5 h-1.5 rounded-full', node.chain === 'btc' ? 'bg-orange-500' : 'bg-violet-500')} />
          <span className="text-faint">{node.chain} address</span>
          <span className={clsx('px-1.5 py-0.5', style.badge)}>{style.label}</span>
          {node.isOrigin && <span className="px-1.5 py-0.5 bg-accent/20 text-accent">origin</span>}
        </div>
        {title && <div className="text-lg font-medium text-fg leading-tight">{title}</div>}
        <div className="flex items-start gap-2">
          <code className="text-[11px] text-muted break-all leading-relaxed flex-1">{node.address}</code>
          <button onClick={copy} title="Copy address" className="text-faint hover:text-fg mt-0.5">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
          <a href={explorerAddressUrl(node.address, node.chain)} target="_blank" rel="noopener noreferrer" title="Open in block explorer" className="text-faint hover:text-fg mt-0.5">
            <ExternalLink size={13} />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="text-faint">Balance <span className="font-mono text-fg">{node.isExpanded || node.isOrigin ? fmtBalance(node.balance, node.chain) : '…'}</span></span>
          <span className="text-faint">Txs <span className="text-fg">{p.page ? `${p.page.rawTxs.length} loaded` : '…'}{node.chain === 'btc' && node.txCount > 0 ? ` / ${node.txCount.toLocaleString()}` : ''}</span></span>
          {node.risk && (
            <span className="flex items-center gap-1.5 text-faint">
              Risk
              <span className="w-12 h-1 bg-raised inline-block"><span className={clsx('block h-full', RISK_BAR[node.risk.level])} style={{ width: `${Math.max(4, node.risk.score)}%` }} /></span>
              <span className="font-mono text-fg">{node.risk.score}</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ActionBtn onClick={p.onTaint} icon={<Droplets size={12} />} title="Treat this address's funds as stolen and see where they went">Taint</ActionBtn>
          {p.canRemove && <ActionBtn onClick={p.onRemove} icon={<Trash2 size={12} />} title="Remove from graph" />}
        </div>
        <FlowBoxes summary={p.summary} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line flex-shrink-0 text-[12px] font-medium">
        {([
          ['counterparties', `Relationships${p.counterparties.length ? ` · ${p.counterparties.length}` : ''}`],
          ['transactions', `Transactions${p.page ? ` · ${p.page.rawTxs.length}` : ''}`],
          ['details', 'Details'],
        ] as [AddressTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => p.onTab(id)}
            className={clsx('flex-1 h-10 border-b-2 -mb-px transition-colors', p.tab === id ? 'border-accent text-fg' : 'border-transparent text-faint hover:text-fg')}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {p.loading && !p.page ? (
          <div className="flex items-center justify-center gap-2 h-32 text-muted text-sm">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" /> Loading activity…
          </div>
        ) : p.tab === 'counterparties' ? (
          <div>
            <div className="px-4 py-2.5 border-b border-line sticky top-0 bg-bg z-10 space-y-2">
              <div className="flex items-center gap-1.5">
                {(['in', 'out'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)} title={f === 'in' ? 'Addresses that sent funds to this one' : 'Addresses this one sent funds to'}
                    className={clsx('h-6 px-2 text-[11px] font-medium', filter === f ? 'bg-raised text-fg' : 'text-faint hover:text-fg')}>
                    {f === 'in' ? 'Senders' : 'Recipients'} · {dirCount(f)}
                  </button>
                ))}
                {notOnGraph.length > 0 && (
                  <button onClick={() => p.onAdd(notOnGraph.slice(0, 5).map(c => c.address))}
                    className="ml-auto h-6 px-2 text-[11px] font-medium bg-accent hover:bg-accent-hover text-accent-fg">
                    Add top {Math.min(5, notOnGraph.length)}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <select value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Sort counterparties"
                  className="h-7 px-1.5 bg-panel border border-line text-fg outline-none focus:border-accent">
                  <option value="amount">{filter === 'in' ? 'Most received' : 'Most sent'}{asset ? ` (${asset})` : ' (NZD value)'}</option>
                  <option value="txs">Most transactions</option>
                  <option value="recent">Most recent</option>
                </select>
                <select value={asset} onChange={e => setAsset(e.target.value)} aria-label="Asset"
                  className="h-7 px-1.5 bg-panel border border-line text-fg outline-none focus:border-accent">
                  <option value="">All assets</option>
                  {assets.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <input value={minAmount} onChange={e => setMinAmount(e.target.value.replace(/[^0-9.]/g, ''))} disabled={!asset}
                  placeholder={asset ? `Min ${asset}` : 'Pick asset for min'} aria-label="Minimum amount" inputMode="decimal"
                  className="h-7 w-full min-w-0 px-2 bg-panel border border-line text-fg placeholder:text-faint outline-none focus:border-accent disabled:opacity-50" />
              </div>
              <div className="flex items-center justify-between text-[10px] text-faint">
                <span>{list.length} shown</span>
                {spamCount > 0 && (
                  <button onClick={() => setShowSpam(v => !v)} className="hover:text-fg underline underline-offset-2">
                    {showSpam ? 'Hide' : 'Show'} {spamCount} spam (poisoning, fake tokens, airdrops)
                  </button>
                )}
              </div>
            </div>
            {list.length === 0 && <p className="p-4 text-[12px] text-faint">{filter === 'in' ? 'No senders' : 'No recipients'} in the loaded transactions.</p>}
            {list.map(c => {
              const l = p.labelOf(c.address)
              const on = p.onGraph.has(c.address)
              return (
                <div key={c.address} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 hover:bg-panel">
                  <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', l ? ENTITY_STYLE[l.type].dot : 'bg-line')} />
                  <button onClick={() => p.onOpenRelationship(c.address)} className="min-w-0 flex-1 text-left" title={`Open the relationship with ${c.address}`}>
                    <div className={clsx('text-[12px] text-fg truncate', !p.nameOf(c.address) && 'font-mono')}>{p.nameOf(c.address) ?? truncate(c.address, 8)}</div>
                    <div className="text-[10px] text-faint">{countOf(c)} tx{countOf(c) === 1 ? '' : 's'} · last {fmtDate(lastOf(c)).split(' ').slice(0, 3).join(' ')}</div>
                  </button>
                  <div className="text-right font-mono text-[11px] leading-tight">
                    {filter === 'in'
                      ? <div className="text-green-500" title="Received from them">↓ {amounts(c.received)}</div>
                      : <div className="text-red-500" title="Sent to them">↑ {amounts(c.sent)}</div>}
                    {valueOf(c) > 0 && <div className="text-[10px] text-faint" title="Value at today's prices">≈ {fmtFiatShort(valueOf(c))} NZD</div>}
                  </div>
                  <button onClick={() => !on && p.onAdd([c.address])} disabled={on} title={on ? 'On the graph' : 'Add to graph'}
                    className={clsx('grid place-items-center w-7 h-7 flex-shrink-0', on ? 'text-accent' : 'bg-raised hover:bg-accent hover:text-accent-fg text-fg')}>
                    {on ? <CheckCircle2 size={14} /> : <Plus size={14} />}
                  </button>
                </div>
              )
            })}
          </div>
        ) : p.tab === 'transactions' ? (
          <TxList {...p} />
        ) : (
          <Details {...p} />
        )}
      </div>
    </div>
  )
}

function TxList(p: Props) {
  const txs = p.page?.rawTxs ?? []
  const me = p.node.address
  return (
    <div>
      {!!p.page?.warnings?.length && (
        <div className="px-4 py-2 border-b border-line bg-yellow-500/5 text-[11px] text-yellow-600 space-y-0.5">
          {p.page.warnings.map((w, i) => <div key={i} className="flex gap-1.5"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />{w}</div>)}
        </div>
      )}
      {txs.length === 0 && <p className="p-4 text-[12px] text-faint">No transactions found.</p>}
      {txs.map((tx, i) => {
        const sent = tx.inputs.some(x => x.address === me)
        const got = tx.outputs.some(x => x.address === me)
        const dir = sent && got && !tx.outputs.some(o => o.address !== me && !o.isChange) ? 'self' : sent ? 'out' : 'in'
        const amount = dir === 'in'
          ? tx.outputs.filter(o => o.address === me).reduce((s, o) => s + o.amount, 0)
          : tx.outputs.filter(o => o.address !== me && !o.isChange).reduce((s, o) => s + o.amount, 0)
        const others = dir === 'in' ? [...new Set(tx.inputs.map(x => x.address))].filter(a => a !== me) : tx.outputs.filter(o => o.address !== me && !o.isChange).map(o => o.address)
        const first = others[0]
        return (
          <div key={`${transferKey(tx)}:${i}`} className="px-4 py-3 border-b border-line/60 hover:bg-panel">
            <div className="flex items-center gap-2">
              <span className={clsx('text-[9px] font-medium uppercase px-1.5 py-0.5', dir === 'in' ? 'bg-green-500/15 text-green-500' : dir === 'out' ? 'bg-red-500/15 text-red-500' : 'bg-raised text-muted')}>{dir}</span>
              <span className="text-[11px] text-faint">{fmtDate(tx.timestamp)}</span>
              {tx.coinjoin && <span className="text-[9px] px-1 bg-orange-500/15 text-orange-500" title={tx.coinjoin.reasons.join('; ')}>{tx.coinjoin.kind} CoinJoin</span>}
              {tx.kind && tx.kind !== 'normal' && <span className="text-[9px] px-1 bg-raised text-faint">{tx.kind}</span>}
              <span className={clsx('ml-auto font-mono text-[12px]', dir === 'in' ? 'text-green-500' : dir === 'out' ? 'text-fg' : 'text-muted')}>
                {dir === 'in' ? '+' : dir === 'out' ? '−' : ''}{fmtAmount(amount, tx.asset, 8)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px]">
              <span className="text-faint">{dir === 'in' ? 'from' : 'to'}</span>
              {first ? (
                <button onClick={() => p.onOpen(first)} className={clsx('truncate text-fg hover:text-accent', !p.nameOf(first) && 'font-mono')} title={first}>
                  {p.nameOf(first) ?? truncate(first, 6)}
                </button>
              ) : <span className="text-faint">itself</span>}
              {others.length > 1 && <span className="text-faint whitespace-nowrap">+{others.length - 1} more</span>}
              <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                <a href={explorerTxUrl(tx.txid, tx.chain)} target="_blank" rel="noopener noreferrer" title={tx.txid} className="flex items-center gap-1 h-6 px-1.5 font-mono text-[10px] text-faint hover:text-fg">
                  {tx.txid.slice(0, 8)}… <ExternalLink size={9} />
                </a>
                <button onClick={() => p.onShowTx(tx)} title="Draw this transaction on the graph as its own line"
                  className="flex items-center gap-1 h-6 px-1.5 text-[10px] font-medium bg-raised hover:bg-line text-fg">
                  <Plus size={10} /> Graph
                </button>
                {dir !== 'out' && (
                  <button onClick={() => p.onTraceTx(tx, 'backward')} disabled={p.tracing} title="Walk these funds back to their source"
                    className="flex items-center gap-1 h-6 px-1.5 text-[10px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-40">
                    <ArrowLeftToLine size={10} /> Source
                  </button>
                )}
                {dir !== 'in' && (
                  <button onClick={() => p.onTraceTx(tx, 'forward')} disabled={p.tracing} title="Follow this payment onward"
                    className="flex items-center gap-1 h-6 px-1.5 text-[10px] font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-40">
                    Trace <ArrowRightFromLine size={10} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
      {p.page?.nextCursor && (
        <div className="p-3 flex justify-center">
          <button onClick={p.onLoadMore} disabled={p.loadingMore} className="h-8 px-4 text-[11px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-50">
            {p.loadingMore ? 'Loading…' : 'Load older transactions'}
          </button>
        </div>
      )}
    </div>
  )
}

function Details(p: Props) {
  const { node } = p
  return (
    <div className="divide-y divide-line">
      {node.label && (
        <section className="p-4 space-y-1 text-[11px]">
          <div className="text-[10px] uppercase tracking-wider text-faint mb-1">Label</div>
          <div className="text-[13px] font-medium text-fg">{node.label.name}</div>
          {node.label.inferredBy && <p className="text-muted">Inferred by the {node.label.inferredBy} heuristic · {Math.round((node.label.confidence ?? 0) * 100)}% confidence</p>}
          {node.label.source && (
            <p className="text-faint">Source: {node.label.sourceUrl?.startsWith('http')
              ? <a href={node.label.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">{node.label.source}</a>
              : node.label.source}</p>
          )}
        </section>
      )}
      {node.ens && (
        <section className="p-4 text-[11px]">
          <div className="text-[10px] uppercase tracking-wider text-faint mb-1">ENS</div>
          <span className="text-fg font-medium">{node.ens}</span> <span className="text-faint">(verified primary name)</span>
        </section>
      )}
      {node.risk && (
        <section className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-faint mb-2">Risk {node.risk.score}/100 · <span className="capitalize">{node.risk.level}</span></div>
          <ul className="space-y-1 text-[11px] text-muted list-disc pl-4">{node.risk.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </section>
      )}
      {!!node.findings?.length && (
        <section className="p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-faint">Heuristic findings</div>
          {node.findings.map((f, i) => (
            <div key={i}>
              <div className="flex justify-between text-xs font-medium text-fg">
                <span>{HEURISTIC_NAME[f.heuristic] ?? f.heuristic}</span>
                <span className="font-mono text-faint">{Math.round(f.confidence * 100)}%</span>
              </div>
              <ul className="mt-1 space-y-0.5 text-[11px] text-muted list-disc pl-4">{f.reasons.map((r, k) => <li key={k}>{r}</li>)}</ul>
            </div>
          ))}
        </section>
      )}
      {p.cluster && (
        <section className="p-4 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-faint">Cluster C{p.cluster.id} · {p.cluster.members.length} addresses</span>
            <button onClick={p.onShowCluster} className="text-[11px] text-accent hover:underline">Show on graph</button>
          </div>
          {p.cluster.label && <div className="text-xs text-fg">Controlled by: {p.cluster.label.name.replace(' (cluster)', '')}</div>}
          <ul className="space-y-0.5 text-[11px] text-muted list-disc pl-4">{p.cluster.evidence.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </section>
      )}
      {p.taint && (
        <section className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-faint mb-1">Taint</div>
          <div className="text-xs font-mono text-red-500">{p.taint.isSeed ? 'This address is the taint source' : `${fmtAmount(p.taint.amount, p.taint.asset, 8)} tainted received`}</div>
        </section>
      )}
      <section className="p-4">
        <label className="text-[10px] uppercase tracking-wider text-faint" htmlFor="note">Your note</label>
        <textarea id="note" key={node.address} defaultValue={node.note ?? ''} onBlur={e => p.onNote(e.target.value)}
          placeholder="e.g. Scammer's second wallet, per victim statement" rows={3}
          className="mt-1.5 w-full bg-bg border border-line focus:border-accent outline-none p-2 text-xs text-fg placeholder:text-faint resize-none" />
      </section>
    </div>
  )
}
