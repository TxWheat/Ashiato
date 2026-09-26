'use client'

import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Copy, Check, X, ExternalLink, Plus, CheckCircle2, ArrowRightFromLine, ArrowLeftToLine, Trash2, AlertTriangle, Tag,
  Shuffle,
} from 'lucide-react'
import { MyLabel } from '@/lib/my-labels'
import CommunityLabels, { Attester } from './CommunityLabels'
import { BRIDGE_NAME } from '@/lib/bridges/types'
import { InternalBadge } from './EdgeDetail'
import { EntityLabel, EntityType, NodeData, RawTransaction, transferKey } from '@/lib/types'
import { Counterparty, FlowSummary } from '@/lib/counterparties'
import { Cluster } from '@/lib/heuristics/cluster'
import { LoadedPage } from '@/lib/export'
import { ENTITY_STYLE, explorerAddressUrl, explorerTxUrl, fmtAmount, fmtBalance, fmtCompact, fmtDate, fmtFiatShort, fiatValue, MAJOR_ASSETS, topAssets, chainDot } from '@/lib/format'
import { truncate, detectChain, normaliseAddress } from '@/lib/detect-chain'

export type AddressTab = 'counterparties' | 'transactions' | 'details'

/** Assets that are never airdrop spam */
const MAJOR = MAJOR_ASSETS
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
  /** Full-history load in progress for this address */
  bulk?: { loaded: number; total?: number } | null
  /** Another address's full history is loading (one at a time) */
  bulkBusy?: boolean
  onLoadAll?: () => void
  onCancelBulk?: () => void
  /** The panel is wide enough for table layouts */
  wide?: boolean
  /**
   * Load another address's own history. Every transaction between two addresses is
   * in both histories, so a quiet counterparty reveals its relationship with a busy
   * address without paging through thousands of the busy one's transactions.
   */
  onLookupAddress?: (address: string) => Promise<void>
  /** Your own label for this address (overrides every other source) */
  myLabel?: MyLabel
  /** The label from datasets / heuristics, shown when you edit */
  baseLabel?: EntityLabel
  onSaveLabel: (label: { name: string; type: EntityType } | null) => void
  /** The connected wallet, for flagging and voting on-chain (absent = read-only) */
  attester?: Attester
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
  onRemove: () => void
  onLoadMore: () => void
  onNote: (note: string) => void
  onShowCluster: () => void
  /** txids on the traced trail: only these rows are coloured */
  tracedTxids: Set<string>
  /** Open the label editor (asked for from the node's quick actions) */
  editLabel?: boolean
  onEditLabelShown?: () => void
}

/** Short amount list: the two biggest assets, then "+N tokens" */
function amounts(rec: Record<string, number>, prices: Record<string, number>) {
  const { shown, rest } = topAssets(Object.entries(rec), prices)
  return shown.map(([asset, amt]) => fmtCompact(amt, asset)).join(' + ') + (rest ? ` +${rest} token${rest === 1 ? '' : 's'}` : '')
}

/** Load more / Load all, with progress while a full-history load runs */
function HistoryControls(p: Props) {
  const loaded = p.page?.rawTxs.length ?? 0
  const total = p.node.chain === 'btc' && p.node.txCount > 0 ? p.node.txCount : undefined
  if (p.bulk) {
    const pct = p.bulk.total ? Math.min(100, Math.round((p.bulk.loaded / p.bulk.total) * 100)) : undefined
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Loading full history… {p.bulk.loaded.toLocaleString()}{p.bulk.total ? ` of ${p.bulk.total.toLocaleString()}` : ''}
          <button onClick={p.onCancelBulk} className="ml-auto h-6 px-2 text-[10px] font-medium bg-raised hover:bg-line text-fg">Stop</button>
        </div>
        {pct !== undefined && <div className="h-1 bg-raised"><div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div>}
      </div>
    )
  }
  if (!p.page?.nextCursor) return null
  const requests = total ? Math.ceil((total - loaded) / 25) : undefined
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={p.onLoadMore} disabled={p.loadingMore} className="h-7 px-3 text-[11px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-50">
        {p.loadingMore ? 'Loading…' : 'Load more history'}
      </button>
      {p.onLoadAll && (
        <button onClick={p.onLoadAll} disabled={p.bulkBusy} title={p.bulkBusy ? 'Another address is loading its full history' : requests ? `About ${requests.toLocaleString()} requests to the block explorer` : 'Keeps loading until the full history is in'}
          className="h-7 px-3 text-[11px] font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50">
          Load all{total ? ` ${total.toLocaleString()} transactions` : ' history'}
        </button>
      )}
      {requests !== undefined && requests > 100 && <span className="text-[10px] text-faint">≈ {requests.toLocaleString()} requests, may take a few minutes</span>}
    </div>
  )
}

const LABEL_TYPES = (Object.keys(ENTITY_STYLE) as EntityType[]).filter(t => t !== 'unknown')

/** Set or change your own name and category for an address */
function LabelEditor({ mine, base, onSave, onCancel }: {
  mine?: MyLabel
  base?: EntityLabel
  onSave: (l: { name: string; type: EntityType } | null) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(mine?.name ?? base?.name ?? '')
  const [type, setType] = useState<EntityType>(mine?.type ?? (base?.type && base.type !== 'unknown' ? base.type : 'wallet'))
  return (
    <form
      onSubmit={e => { e.preventDefault(); if (name.trim()) onSave({ name, type }) }}
      className="border border-line bg-panel p-3 space-y-2"
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-faint">Your label</div>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="e.g. Scammer's wallet, Victim, Binance hot wallet" aria-label="Label name"
        className="w-full h-8 px-2 text-[12px] bg-bg border border-line text-fg placeholder:text-faint outline-none focus:border-accent" />
      <select value={type} onChange={e => setType(e.target.value as EntityType)} aria-label="Category"
        className="w-full h-8 px-1.5 text-[12px] bg-bg border border-line text-fg outline-none focus:border-accent">
        {LABEL_TYPES.map(t => <option key={t} value={t}>{ENTITY_STYLE[t].label}</option>)}
      </select>
      {base && (
        <p className="text-[10px] text-faint leading-relaxed">
          Replaces “{base.name}”{base.source ? ` (${base.source})` : ''} for you. Saved in this browser and applied wherever this address appears.
        </p>
      )}
      <div className="flex gap-1.5">
        <button type="submit" disabled={!name.trim()} className="h-7 px-3 text-[11px] font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50">Save</button>
        <button type="button" onClick={onCancel} className="h-7 px-2.5 text-[11px] font-medium bg-raised hover:bg-line text-fg">Cancel</button>
        {mine && (
          <button type="button" onClick={() => onSave(null)} className="ml-auto h-7 px-2.5 text-[11px] font-medium text-faint hover:text-red-500">
            {base ? 'Restore original' : 'Remove label'}
          </button>
        )}
      </div>
    </form>
  )
}

/** Breadcrumbs-style node visualizer: totals in and out, per asset, with transaction counts */
function FlowBoxes({ summary, wide }: { summary: FlowSummary; wide?: boolean }) {
  const box = (title: string, rec: FlowSummary['incoming'], tone: string) => {
    const rows = Object.entries(rec)
    const major = rows.filter(([a]) => MAJOR.has(a)).sort((x, y) => y[1].count - x[1].count)
    const other = rows.filter(([a]) => !MAJOR.has(a))
    return (
      <div className="border border-line px-2.5 py-1.5 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-faint mb-0.5">{title}</div>
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
  // Wide (smart expand): in → address → out in one row beside the identity
  if (wide) {
    return (
      <div className="flex items-center gap-2 w-[48%] flex-shrink-0">
        <div className="flex-1 min-w-0">{box('Incoming txs', summary.incoming, 'text-green-500')}</div>
        <span className="flex items-center text-faint" aria-hidden>→<span className="mx-1 w-3 h-3 rounded-full border-2 border-fg" />→</span>
        <div className="flex-1 min-w-0">{box('Outgoing txs', summary.outgoing, 'text-fg')}</div>
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
  const [copied, setCopied] = useState<boolean | 'failed'>(false)
  const [filter, setFilter] = useState<'in' | 'out'>('in')
  const [sort, setSort] = useState<SortKey>('amount')
  const [asset, setAsset] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(150)
  const [lookup, setLookup] = useState<{ address: string; state: 'loading' | 'done' | 'failed' } | null>(null)
  const [showSpam, setShowSpam] = useState(false)
  const [editing, setEditing] = useState(false)
  const { editLabel, onEditLabelShown } = p
  useEffect(() => {
    if (!editLabel) return
    setEditing(true)
    onEditLabelShown?.()
  }, [editLabel, onEditLabelShown])
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
    const q = query.trim().toLowerCase()
    return visibleCps
      .filter(c => Object.keys(sideOf(c)).length)
      .filter(c => !q || c.address.toLowerCase().includes(q) || (p.nameOf(c.address) ?? '').toLowerCase().includes(q))
      .filter(c => !asset || sideOf(c)[asset] !== undefined)
      .filter(c => !asset || !min || amt(c) >= min)
      .sort((x, y) => score[sort](y) - score[sort](x))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.counterparties, filter, sort, asset, minAmount, showSpam, p.prices, query, p.labelOf, p.nameOf])
  // How far back the loaded history reaches: relationships only cover what's loaded
  const loadedTimes = (p.page?.rawTxs ?? []).map(t => t.timestamp).filter(Boolean)
  const oldestLoaded = loadedTimes.length ? Math.min(...loadedTimes) : 0
  const q = query.trim().toLowerCase()
  const otherSideHits = q && !list.length
    ? visibleCps.filter(c => Object.keys(sideOf(c, filter === 'in' ? 'out' : 'in')).length && (c.address.toLowerCase().includes(q) || (p.nameOf(c.address) ?? '').toLowerCase().includes(q))).length
    : 0
  // A pasted full address that isn't in the loaded relationships: fetch its own history
  const pasted = (() => {
    const raw = query.trim()
    const chain = raw ? detectChain(raw) : null
    return chain === node.chain ? normaliseAddress(raw, chain) : null
  })()
  const pastedFound = !!pasted && p.counterparties.some(c => c.address === pasted)
  useEffect(() => {
    if (!pasted || pastedFound || pasted === node.address || !p.onLookupAddress) return
    if (lookup?.address === pasted) return
    setLookup({ address: pasted, state: 'loading' })
    p.onLookupAddress(pasted)
      .then(() => setLookup({ address: pasted, state: 'done' }))
      .catch(() => setLookup({ address: pasted, state: 'failed' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasted, pastedFound])
  // Show the match in whichever direction it is
  useEffect(() => {
    if (!pastedFound || !pasted) return
    const c = p.counterparties.find(x => x.address === pasted)
    if (c && !Object.keys(sideOf(c)).length) setFilter(filter === 'in' ? 'out' : 'in')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastedFound, pasted])
  const hiddenSpamHits = q && !showSpam
    ? p.counterparties.filter(c => isSpam(c) && (c.address.toLowerCase().includes(q) || (p.nameOf(c.address) ?? '').toLowerCase().includes(q))).length
    : 0
  const notOnGraph = list.filter(c => !p.onGraph.has(c.address))

  const copy = () => {
    // Only claim "copied" when the browser actually copied (it can refuse, e.g. without focus)
    navigator.clipboard?.writeText(node.address).then(() => setCopied(true), () => setCopied('failed'))
    setTimeout(() => setCopied(false), 1500)
  }

  const ActionBtn = ({ onClick, icon, children, disabled, title: t }: { onClick: () => void; icon: React.ReactNode; children?: React.ReactNode; disabled?: boolean; title?: string }) => (
    <button onClick={onClick} disabled={disabled} title={t} aria-label={children ? undefined : t}
      className="flex items-center justify-center gap-1.5 h-8 px-2.5 text-[11px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-40 disabled:cursor-not-allowed">
      {icon}{children}
    </button>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Identity */}
      <div className={clsx('px-4 py-3 border-b border-line flex-shrink-0', p.wide ? 'flex items-start gap-5' : 'space-y-2')}>
        <div className={clsx('space-y-2 min-w-0', p.wide && 'flex-1')}>
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider">
          <span className={clsx('w-1.5 h-1.5 rounded-full', chainDot(node.chain))} />
          <span className="text-faint">{node.chain} address</span>
          <span className={clsx('px-1.5 py-0.5', style.badge)}>{style.label}</span>
          {node.isOrigin && <span className="px-1.5 py-0.5 bg-accent/20 text-accent">origin</span>}
          {p.myLabel && <span className="px-1.5 py-0.5 bg-raised text-fg" title="You set this label">your label</span>}
        </div>
        {title && <div className="text-lg font-medium text-fg leading-tight">{title}</div>}
        <div className="flex items-start gap-2">
          <code className="text-[11px] text-muted break-all leading-relaxed flex-1">{node.address}</code>
          <button onClick={copy} title={copied === 'failed' ? 'Could not copy' : 'Copy address'} aria-label="Copy address" className={clsx('mt-0.5', copied === 'failed' ? 'text-red-500' : 'text-faint hover:text-fg')}>
            {copied === 'failed' ? <X size={13} /> : copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <a href={explorerAddressUrl(node.address, node.chain)} target="_blank" rel="noopener noreferrer" title="Open in block explorer" aria-label="Open in block explorer" className="text-faint hover:text-fg mt-0.5">
            <ExternalLink size={13} />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="text-faint">Balance <span className="font-mono text-fg">{node.isExpanded || node.isOrigin ? fmtBalance(node.balance, node.chain) : '…'}</span></span>
          <span className="text-faint">Txs <span className="text-fg">{p.page ? `${p.page.rawTxs.length.toLocaleString()} loaded` : '…'}{node.chain === 'btc' && node.txCount > 0 ? ` of ${node.txCount.toLocaleString()} on-chain` : ''}</span></span>
          {node.risk && (
            <span className="flex items-center gap-1.5 text-faint">
              Risk
              <span className="w-12 h-1 bg-raised inline-block"><span className={clsx('block h-full', RISK_BAR[node.risk.level])} style={{ width: `${Math.max(4, node.risk.score)}%` }} /></span>
              <span className="font-mono text-fg">{node.risk.score}</span>
            </span>
          )}
          <div className="flex gap-1.5 ml-auto">
          <ActionBtn onClick={() => setEditing(v => !v)} icon={<Tag size={12} />} title="Name this address yourself">{p.myLabel ? 'Edit label' : 'Label'}</ActionBtn>
          {p.canRemove && <ActionBtn onClick={p.onRemove} icon={<Trash2 size={12} />} title="Remove from graph" />}
          </div>
        </div>
        {editing && (
          <LabelEditor
            key={node.address}
            mine={p.myLabel}
            base={p.baseLabel}
            onSave={l => { p.onSaveLabel(l); setEditing(false) }}
            onCancel={() => setEditing(false)}
          />
        )}
        {BRIDGE_NAME.test(title ?? '') && (
          <p className="flex items-start gap-1.5 text-[11px] text-orange-500 border border-orange-500/40 bg-orange-500/5 px-2.5 py-2">
            <Shuffle size={12} className="mt-0.5 flex-shrink-0" />
            <span>Cross-chain swap service. Click the <b className="font-medium">line</b> from a wallet into it to see where that wallet&apos;s swap came out, on which chain and address.</span>
          </p>
        )}
        </div>
        <FlowBoxes summary={p.summary} wide={p.wide} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line flex-shrink-0 text-[12px] font-medium">
        {([
          ['counterparties', `Relationships${p.counterparties.length ? ` · ${p.counterparties.length}` : ''}`],
          ['transactions', `Transactions${p.page ? ` · ${p.page.rawTxs.length}` : ''}`],
          ['details', 'Labels & details'],
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
              <div className="grid grid-cols-2 border border-line">
                {(['in', 'out'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)} title={f === 'in' ? 'Addresses that sent funds to this one' : 'Addresses this one sent funds to'}
                    className={clsx('h-8 px-2 text-[11px] font-medium', filter === f ? (f === 'in' ? 'bg-green-500/15 text-fg' : 'bg-red-500/15 text-fg') : 'text-faint hover:text-fg')}>
                    {f === 'in' ? '↓ Incoming transactions' : '↑ Outgoing transactions'} <span className="text-faint">({dirCount(f)})</span>
                  </button>
                ))}
              </div>
              <input value={query} onChange={e => { setQuery(e.target.value); setShown(150) }} placeholder="Find an address or name…" aria-label="Find a relationship"
                className="w-full h-7 px-2 text-[11px] bg-panel border border-line text-fg placeholder:text-faint outline-none focus:border-accent" />
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
              <div className="flex items-center justify-between gap-2 text-[10px] text-faint">
                <span>
                  {list.length} {filter === 'in' ? 'incoming' : 'outgoing'} address{list.length === 1 ? '' : 'es'} · showing{' '}
                  {sort === 'amount' ? `highest cumulative ${asset || 'value'}` : sort === 'txs' ? 'most transactions' : 'most recent'}
                </span>
                {spamCount > 0 && (
                  <button onClick={() => setShowSpam(v => !v)} title="Address poisoning, fake tokens and unsolicited airdrops" className="flex-shrink-0 hover:text-fg underline underline-offset-2">
                    {showSpam ? 'Hide' : 'Show'} {spamCount} spam
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-1.5 border-b border-line text-[10px] uppercase tracking-wider text-faint">
              <span className="flex-1">{filter === 'in' ? 'Incoming address' : 'Outgoing address'} · last tx</span>
              <span>Cumulative amount</span>
              {notOnGraph.length > 0 ? (
                <button onClick={() => p.onAdd(notOnGraph.slice(0, 5).map(c => c.address))} title="Add the top addresses in this list to the graph"
                  className="h-6 px-2 normal-case tracking-normal text-[11px] font-medium bg-accent hover:bg-accent-hover text-accent-fg">
                  + Top {Math.min(5, notOnGraph.length)}
                </button>
              ) : <span className="w-7 text-center">Add</span>}
            </div>
            {list.length === 0 && (
              <div className="p-4 space-y-2 text-[12px] text-faint">
                {pasted && lookup?.address === pasted && lookup.state === 'loading' ? (
                  <p className="flex items-center gap-2"><span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" /> Not in the loaded history. Loading {truncate(pasted, 6)}’s own history to find transactions between them…</p>
                ) : pasted && lookup?.address === pasted && lookup.state === 'done' ? (
                  <p>No transactions between these addresses in {truncate(pasted, 6)}’s loaded history. If it’s also a busy address, open it and load more of its history.</p>
                ) : pasted && lookup?.address === pasted && lookup.state === 'failed' ? (
                  <p>Could not load {truncate(pasted, 6)}’s history. Try again in a moment.</p>
                ) : (
                  <p>{q ? `No ${filter === 'in' ? 'incoming' : 'outgoing'} relationship matches “${query.trim()}” in the loaded history. Paste a full address to look it up directly.` : `No ${filter === 'in' ? 'incoming' : 'outgoing'} transactions loaded.`}</p>
                )}
                {otherSideHits > 0 && (
                  <button onClick={() => setFilter(filter === 'in' ? 'out' : 'in')} className="underline underline-offset-2 hover:text-fg">
                    {otherSideHits} match{otherSideHits === 1 ? '' : 'es'} in {filter === 'in' ? 'outgoing' : 'incoming'} transactions
                  </button>
                )}
                {hiddenSpamHits > 0 && (
                  <button onClick={() => setShowSpam(true)} className="block underline underline-offset-2 hover:text-fg">
                    {hiddenSpamHits} match{hiddenSpamHits === 1 ? '' : 'es'} hidden as spam, show
                  </button>
                )}
              </div>
            )}
            {list.slice(0, shown).map(c => {
              const l = p.labelOf(c.address)
              const on = p.onGraph.has(c.address)
              return (
                <div key={c.address} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 hover:bg-panel">
                  <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', l ? ENTITY_STYLE[l.type].dot : 'bg-line')} />
                  <button onClick={() => p.onOpenRelationship(c.address)} className="min-w-0 flex-1 text-left" title={`Open the relationship with ${c.address}`}>
                    <div className={clsx('text-[12px] text-fg truncate', !p.nameOf(c.address) && 'font-mono')}>
                      {p.nameOf(c.address) ?? truncate(c.address, 8)}
                      {filter === 'out' && c.likelyChange && (
                        <span className="ml-1.5 text-[9px] px-1 bg-yellow-500/15 text-yellow-600 font-sans" title="Heuristic guess: this output returns to the same owner (change). The funds still left this address.">likely change</span>
                      )}
                    </div>
                    <div className="text-[10px] text-faint">{countOf(c)} tx{countOf(c) === 1 ? '' : 's'} · last {fmtDate(lastOf(c)).split(' ').slice(0, 3).join(' ')}</div>
                  </button>
                  <div className="text-right font-mono text-[11px] leading-tight max-w-[55%] flex-shrink-0">
                    {filter === 'in'
                      ? <div className="text-green-500" title="Received from them">↓ {amounts(c.received, p.prices)}</div>
                      : <div className="text-red-500" title="Sent to them">↑ {amounts(c.sent, p.prices)}</div>}
                    {valueOf(c) > 0 && <div className="text-[10px] text-faint" title="Value at today's prices">≈ {fmtFiatShort(valueOf(c))} NZD</div>}
                  </div>
                  <button onClick={() => !on && p.onAdd([c.address])} disabled={on} title={on ? 'On the graph' : 'Add to graph'} aria-label={on ? 'On the graph' : 'Add to graph'}
                    className={clsx('grid place-items-center w-7 h-7 flex-shrink-0', on ? 'text-accent' : 'bg-raised hover:bg-accent hover:text-accent-fg text-fg')}>
                    {on ? <CheckCircle2 size={14} /> : <Plus size={14} />}
                  </button>
                </div>
              )
            })}
            {list.length > shown && (
              <div className="p-3 flex justify-center">
                <button onClick={() => setShown(n => n + 300)} className="h-7 px-3 text-[11px] font-medium bg-raised hover:bg-line text-fg">
                  Show {Math.min(300, list.length - shown)} more of {list.length - shown}
                </button>
              </div>
            )}
            <div className="px-4 py-3 border-t border-line text-[11px] text-faint space-y-2">
              <p>
                Relationships come from the {p.page?.rawTxs.length ?? 0} transactions loaded so far
                {oldestLoaded ? `, back to ${fmtDate(oldestLoaded).split(' ').slice(0, 3).join(' ')}` : ''}.
                {p.page?.nextCursor ? ' Older counterparties appear when you load more.' : ' That is the full history.'}
              </p>
              <HistoryControls {...p} />
            </div>
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
  const txs = p.page?.rawTxs
  const me = p.node.address
  const [q, setQ] = useState('')
  const [dirFilter, setDirFilter] = useState<'all' | 'in' | 'out'>('all')
  const [onChartOnly, setOnChartOnly] = useState(false)
  const [shown, setShown] = useState(150)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // Newest first (pending on top), whatever order the pages were loaded in
  const rows = useMemo(() => [...(txs ?? [])].sort((a, b) => (b.timestamp || Infinity) - (a.timestamp || Infinity)).map(tx => {
    const sent = tx.inputs.some(x => x.address === me)
    const got = tx.outputs.some(x => x.address === me)
    const dir: 'in' | 'out' | 'self' = sent && got && !tx.outputs.some(o => o.address !== me) ? 'self' : sent ? 'out' : 'in'
    const amount = dir === 'in'
      ? tx.outputs.filter(o => o.address === me).reduce((s, o) => s + o.amount, 0)
      : tx.outputs.filter(o => o.address !== me).reduce((s, o) => s + o.amount, 0)
    // Largest first, so the main recipient shows before small outputs
    const outs = tx.outputs.filter(o => o.address !== me).sort((a, b) => b.amount - a.amount)
    const others = dir === 'in' ? [...new Set(tx.inputs.map(x => x.address))].filter(a => a !== me) : [...new Set(outs.map(o => o.address))]
    const change = new Set(dir === 'out' ? outs.filter(o => o.isChange).map(o => o.address) : [])
    return { tx, dir, amount, others, change }
  }), [txs, me])

  const needle = q.trim().toLowerCase()
  // Date range in local time, inclusive of both days; pending (no timestamp) only without a range
  const fromTs = from ? new Date(`${from}T00:00:00`).getTime() / 1000 : -Infinity
  const toTs = to ? new Date(`${to}T23:59:59`).getTime() / 1000 : Infinity
  const loadedTimes = rows.map(r => r.tx.timestamp).filter(Boolean)
  const oldest = loadedTimes.length ? Math.min(...loadedTimes) : 0
  const filtered = rows.filter(r =>
    (dirFilter === 'all' || r.dir === dirFilter) &&
    ((!from && !to) || (r.tx.timestamp >= fromTs && r.tx.timestamp <= toTs && r.tx.timestamp > 0)) &&
    (!onChartOnly || r.others.some(a => p.onGraph.has(a))) &&
    (!needle || r.tx.txid.toLowerCase().includes(needle) || r.others.some(a => a.toLowerCase().includes(needle) || (p.nameOf(a) ?? '').toLowerCase().includes(needle))))

  // Render helpers, not components: a component defined in here is a new type every render,
  // so every row of a long list would be torn down and rebuilt on each update
  const addr = (a: string, change?: boolean) => (
    <button key={a} onClick={() => p.onOpen(a)} title={change ? `${a}\nLikely change (a heuristic guess that this output returns to the same owner)` : a}
      className={clsx('truncate hover:text-accent', !p.nameOf(a) && 'font-mono', p.onGraph.has(a) ? 'text-fg font-medium' : 'text-fg')}>
      {p.nameOf(a) ?? truncate(a, 6)}
      {change && <span className="ml-1 text-[9px] px-1 bg-yellow-500/15 text-yellow-600 font-sans">change?</span>}
      {p.onGraph.has(a) && <CheckCircle2 size={10} className="inline ml-1 -mt-0.5 text-accent" />}
    </button>
  )

  const actions = (tx: RawTransaction, dir: string) => (
    <div className="flex items-center gap-1 flex-shrink-0">
      <a href={explorerTxUrl(tx.txid, tx.chain)} target="_blank" rel="noopener noreferrer" title={tx.txid} className="flex items-center gap-1 h-6 px-1.5 font-mono text-[10px] text-faint hover:text-fg">
        {tx.txid.replace(/^0x/, '').slice(0, 8)}… <ExternalLink size={9} />
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
  )

  const dirTag = (dir: string) => (
    <span className={clsx('text-[9px] font-semibold uppercase px-1.5 py-0.5 text-center', dir === 'in' ? 'bg-green-500/20 text-green-500' : dir === 'out' ? 'bg-red-500/20 text-red-500' : 'bg-raised text-muted')}>{dir}</span>
  )

  return (
    <div>
      {!!p.page?.warnings?.length && (
        <div className="px-4 py-2 border-b border-line bg-yellow-500/5 text-[11px] text-yellow-600 space-y-0.5">
          {p.page.warnings.map((w, i) => <div key={i} className="flex gap-1.5"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />{w}</div>)}
        </div>
      )}
      <div className={clsx('px-4 py-2.5 border-b border-line sticky top-0 bg-bg z-10', p.wide ? 'flex flex-wrap items-center gap-x-4 gap-y-2' : 'space-y-2')}>
        <input value={q} onChange={e => { setQ(e.target.value); setShown(150) }} placeholder="Find an address, name or tx hash…" aria-label="Find a transaction"
          className={clsx(p.wide ? 'flex-1 min-w-[220px]' : 'w-full', 'h-7 px-2 text-[11px] bg-panel border border-line text-fg placeholder:text-faint outline-none focus:border-accent')} />
        <div className="flex items-center gap-2 text-[11px]">
          <div className="flex border border-line">
            {(['all', 'in', 'out'] as const).map(d => (
              <button key={d} onClick={() => setDirFilter(d)}
                className={clsx('h-6 px-2.5 font-medium uppercase text-[10px]', dirFilter === d ? (d === 'in' ? 'bg-green-500/20 text-green-500' : d === 'out' ? 'bg-red-500/20 text-red-500' : 'bg-raised text-fg') : 'text-faint hover:text-fg')}>
                {d}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-faint cursor-pointer">
            <input type="checkbox" checked={onChartOnly} onChange={e => setOnChartOnly(e.target.checked)} className="accent-[rgb(var(--accent))]" />
            On chart only
          </label>
          <span className="ml-auto text-[10px] text-faint">{filtered.length} of {rows.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
          <span>From</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From date"
            className="h-7 px-1.5 bg-panel border border-line text-fg outline-none focus:border-accent" />
          <span>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To date"
            className="h-7 px-1.5 bg-panel border border-line text-fg outline-none focus:border-accent" />
          {(from || to) && <button onClick={() => { setFrom(''); setTo('') }} className="underline underline-offset-2 hover:text-fg">Clear</button>}
        </div>
        {from && oldest > 0 && fromTs < oldest && p.page?.nextCursor && (
          <p className="basis-full text-[10px] text-yellow-600">
            Loaded history only reaches back to {fmtDate(oldest).split(' ').slice(0, 3).join(' ')}. Load more (or Load all) to cover the start of this range.
          </p>
        )}
      </div>
      {filtered.length === 0 && <p className="p-4 text-[12px] text-faint">{rows.length ? 'No loaded transactions match.' : 'No transactions found.'}</p>}

      {p.wide && filtered.length > 0 && (
        <div className="grid grid-cols-[150px_52px_minmax(0,1fr)_170px_auto] gap-x-3 px-4 py-1.5 border-b border-line text-[10px] uppercase tracking-wider text-faint">
          <span>Date</span><span>Dir</span><span>Address</span><span className="text-right">Amount</span><span className="text-right pr-1">Tx · actions</span>
        </div>
      )}

      {filtered.slice(0, shown).map(({ tx, dir, amount, others, change }, i) => {
        const isTraced = p.tracedTxids.has(tx.txid) || p.tracedTxids.has(tx.txid.toLowerCase())
        const tint = clsx(
          !isTraced ? 'border-l-2 border-l-transparent'
            : dir === 'in' ? 'bg-green-500/[0.12] border-l-2 border-l-green-500'
              : 'bg-red-500/[0.12] border-l-2 border-l-red-500',
        )
        const value = fiatValue(amount, tx.asset, p.prices)
        const amountCell = (
          <span className={clsx('font-mono text-[12px] whitespace-nowrap', dir === 'in' ? 'text-green-500' : dir === 'out' ? 'text-fg' : 'text-muted')}>
            {dir === 'in' ? '+' : dir === 'out' ? '−' : ''}{fmtAmount(amount, tx.asset, 8)}
          </span>
        )
        const badges = (
          <>
            {tx.coinjoin && <span className="text-[9px] px-1 bg-orange-500/15 text-orange-500" title={tx.coinjoin.reasons.join('; ')}>{tx.coinjoin.kind} CoinJoin</span>}
            {tx.kind === 'internal' ? <InternalBadge /> : tx.kind === 'token' && <span className="text-[9px] px-1 bg-raised text-faint">token</span>}
          </>
        )
        if (p.wide) {
          return (
            <div key={`${transferKey(tx)}:${i}`} className={clsx('grid grid-cols-[150px_52px_minmax(0,1fr)_170px_auto] gap-x-3 items-center px-4 py-2 border-b border-line/60 hover:bg-panel', tint)}>
              <span className="text-[11px] text-faint">{tx.timestamp ? fmtDate(tx.timestamp) : 'pending'}</span>
              {dirTag(dir)}
              <div className="flex items-center gap-2 min-w-0 text-[11px]">
                {others.length ? others.slice(0, 3).map(a => addr(a, change.has(a))) : <span className="text-faint">itself</span>}
                {others.length > 3 && <span className="text-faint whitespace-nowrap">+{others.length - 3} more</span>}
                {badges}
              </div>
              <div className="text-right leading-tight">
                {amountCell}
                {value > 0 && <div className="text-[10px] text-faint">≈ {fmtFiatShort(value)} NZD</div>}
              </div>
              {actions(tx, dir)}
            </div>
          )
        }
        return (
          <div key={`${transferKey(tx)}:${i}`} className={clsx('px-4 py-3 border-b border-line/60 hover:bg-panel', tint)}>
            <div className="flex items-center gap-2">
              {dirTag(dir)}
              <span className="text-[11px] text-faint">{tx.timestamp ? fmtDate(tx.timestamp) : 'pending'}</span>
              {badges}
              <span className="ml-auto">{amountCell}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] min-w-0">
              <span className="text-faint">{dir === 'in' ? 'from' : 'to'}</span>
              {others[0] ? addr(others[0], change.has(others[0])) : <span className="text-faint">itself</span>}
              {others.length > 1 && <span className="text-faint whitespace-nowrap">+{others.length - 1} more</span>}
              <div className="ml-auto">{actions(tx, dir)}</div>
            </div>
          </div>
        )
      })}
      {filtered.length > shown && (
        <div className="p-3 flex justify-center">
          <button onClick={() => setShown(n => n + 300)} className="h-7 px-3 text-[11px] font-medium bg-raised hover:bg-line text-fg">
            Show {Math.min(300, filtered.length - shown)} more
          </button>
        </div>
      )}
      {(p.page?.nextCursor || p.bulk) && (
        <div className="p-3">
          <HistoryControls {...p} />
        </div>
      )}
    </div>
  )
}

function Details(p: Props) {
  const { node } = p
  return (
    <div className="divide-y divide-line">
      <section className="p-4">
        <CommunityLabels chain={node.chain} address={node.address} attester={p.attester} />
      </section>
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
      <section className="p-4">
        <label className="text-[10px] uppercase tracking-wider text-faint" htmlFor="note">Your note</label>
        <textarea id="note" key={node.address} defaultValue={node.note ?? ''} onBlur={e => p.onNote(e.target.value)}
          placeholder="e.g. Scammer's second wallet, per victim statement" rows={3}
          className="mt-1.5 w-full bg-bg border border-line focus:border-accent outline-none p-2 text-xs text-fg placeholder:text-faint resize-none" />
      </section>
    </div>
  )
}
