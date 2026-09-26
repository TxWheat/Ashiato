'use client'

import { clsx } from 'clsx'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Undo2, X, MousePointerClick, EyeOff, ChevronsLeft, ChevronsRight, Repeat, Wallet, Mail } from 'lucide-react'
import { Chain, EdgeData, EntityLabel, EntityType, NodeData, RawTransaction, TraceResult, TxIO, TxLookup, transferKey } from '@/lib/types'
import { normaliseAddress, detectChain, truncate } from '@/lib/detect-chain'
import { aggregateEdges, txEdges } from '@/lib/graph'
import { counterparties as findCounterparties, flowSummary } from '@/lib/counterparties'
import { clusterAddresses } from '@/lib/heuristics/cluster'
import { tornadoLinks as findTornadoLinks } from '@/lib/heuristics/eth/tornado'
import { BtcTxInfo, Direction, followFunds, Lot, seedsFromTx, backSeedsFromTx, TracedFlow, TraceEnd } from '@/lib/follow'
import { saveCase as saveChartToBrowser, getCase as getSavedChart, newCaseId } from '@/lib/saved-cases'
import { collapseChains } from '@/lib/collapse'
import { CheckedPayment, PaymentMatch, choosePayment, judgePayment, parseClientPayments, seedsFromPayments, transfersOf } from '@/lib/client-payments'
import ClientPaymentsDialog from '@/components/ClientPayments'
import SummaryDialog from '@/components/SummaryDialog'
import { summaryFacts } from '@/lib/summary-facts'
import { useMyLabels, myLabelKey, toEntityLabel } from '@/lib/my-labels'
import { CASE_VERSION, CaseFile, LoadedPage, download, downloadDataUrl, flowsToCsv, parseCase, toGraphml } from '@/lib/export'
import { buildReport } from '@/lib/report'
import { ENTITY_STYLE, chainDot, fmtCompact, fmtDay, explorerAddressUrl } from '@/lib/format'
import AddressInspector, { AddressTab } from '@/components/AddressInspector'
import TxInspector from '@/components/TxInspector'
import EdgeDetail from '@/components/EdgeDetail'
import CasePanel, { FollowSettings } from '@/components/CasePanel'
import SaveChartButton from '@/components/SaveChartButton'
import ExportMenu from '@/components/ExportMenu'
import SearchForm from '@/components/SearchForm'
import { AccountButton } from '@/components/SignIn'
import AlertsBell from '@/components/AlertsBell'
import { useAuth } from '@/components/Providers'
import { SettingsButton, useSettings } from '@/components/Settings'
import { PricingContext } from '@/components/Pricing'
import type { Pricing, PriceHistory } from '@/lib/prices'
import type { Attester } from '@/components/CommunityLabels'
import { useWalletClient } from 'wagmi'
import { signLabel, signRevoke, signVote } from '@/lib/attest/sign'
import BridgeHops from '@/components/BridgeHops'
import { isChain, isEvm } from '@/lib/evm'
import { BRIDGE_NAME, CrossChainHop, chainDisplay, lookupService } from '@/lib/bridges/types'
import type { GraphApi, XY } from '@/components/TraceGraph'
import type { NodeAction } from '@/components/NodeMenu'
import type { Annotation } from '@/lib/annotations'
import type { AddressNodeData, TxHubData } from '@/components/AddressNode'

const TraceGraph = dynamic(() => import('@/components/TraceGraph'), { ssr: false })

type Selection = { kind: 'address'; id: string } | { kind: 'flow'; from: string; to: string } | { kind: 'tx'; id: string } | null

interface Snapshot {
  visible: Set<string>
  followedPairs: Set<string>
  traced: TracedFlow[]
  traceEnds: TraceEnd[]
}

/** Trails end at cash-out points and mixers */
const STOP_AT: EntityType[] = ['exchange', 'deposit', 'mixer', 'coinjoin', 'sanctioned', 'defi', 'bridge']
/** Older pages loaded per address while following funds */
const MAX_EXTRA_PAGES = 5
/** Trace ends that are not part of the drawn trail */
const OFF_TRAIL: TraceEnd['reason'][] = ['peel', 'split']

/** Drops exact repeats (running the same trace twice), keeping genuinely different lots */
function mergeEnds(ends: TraceEnd[]): TraceEnd[] {
  const m = new Map<string, TraceEnd>()
  for (const e of ends) m.set(`${e.address}|${e.reason}|${e.asset}|${e.amount.toFixed(8)}`, e)
  return [...m.values()]
}

/** Same hop traced twice (re-running a trace) must not double the traced amount */
function uniqueFlows(flows: TracedFlow[]): TracedFlow[] {
  const m = new Map<string, TracedFlow>()
  for (const f of flows) m.set(`${f.txid}|${f.from}|${f.to}|${f.asset}|${f.amount.toFixed(8)}`, f)
  return [...m.values()]
}

/** BTC addresses with at most this many transactions load their full history automatically */
const AUTO_FULL_HISTORY_BTC = 500
/** Participants of a searched transaction put on the graph straight away (per side) */
const TX_PARTICIPANTS = 6

/** A URL reduced to what decides which trace/case is shown */
function urlKey(url: string): string {
  const q = new URLSearchParams(url.split('?')[1] ?? '')
  return [q.get('address') ?? '', (q.get('tx') ?? '').toLowerCase(), q.get('chain') ?? '', q.get('case') ?? ''].join('|')
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(body.error ?? `HTTP ${res.status}`, res.status)
  return body as T
}

const fetchTrace = (address: string, chain: Chain, cursor?: string) =>
  getJson<TraceResult>(`/api/${chain}/${encodeURIComponent(address)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)

/** Normalises the BTC and ETH transaction endpoints into one shape */
async function fetchTxLookup(txid: string, chain: Chain): Promise<TxLookup> {
  if (chain !== 'btc') return getJson<TxLookup>(`/api/tx/${chain}/${txid}`)
  const info = await getJson<BtcTxInfo>(`/api/tx/btc/${txid}`)
  return { chain: 'btc', txid: info.tx.txid, timestamp: info.tx.timestamp, transfers: [info.tx], labels: info.labels, ens: {}, spentBy: info.spentBy }
}

/** Senders and recipients of a looked-up transaction, largest first */
function txParticipants(l: TxLookup) {
  const ins = new Map<string, number>()
  const outs = new Map<string, number>()
  for (const t of l.transfers) {
    const inTotal = t.inputs.reduce((s, i) => s + i.amount, 0)
    for (const i of t.inputs) ins.set(i.address, (ins.get(i.address) ?? 0) + (inTotal ? i.amount : t.outputs[0]?.amount ?? 0))
    for (const o of t.outputs) outs.set(o.address, (outs.get(o.address) ?? 0) + o.amount)
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a)
  return { inputs: top(ins), outputs: top(outs) }
}

function toHub(l: TxLookup): TxHubData {
  const inputs: TxHubData['inputs'] = []
  const outputs: TxHubData['outputs'] = []
  for (const t of l.transfers) {
    const inTotal = t.inputs.reduce((s, i) => s + i.amount, 0)
    for (const i of t.inputs) inputs.push({ address: i.address, amount: inTotal ? i.amount : t.outputs[0]?.amount ?? 0, asset: t.asset })
    for (const o of t.outputs) outputs.push({ address: o.address, amount: o.amount, asset: t.asset })
  }
  return { txid: l.txid, chain: l.chain, label: `${l.txid.replace(/^0x/, '').slice(0, 6)}…${l.txid.slice(-4)}`, inputs, outputs }
}

/** Tracing needs an account, so cases are always saved. Signing in continues to this same trace. */
function TracePageInner() {
  const { address, enabled, busy, error, signIn } = useAuth()
  const params = useSearchParams()
  // Sign-in not configured on this server (e.g. local development): open as before
  if (!enabled) return <TraceWorkspace />
  if (address === undefined) {
    return <div className="h-screen grid place-items-center bg-bg"><div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
  }
  if (address) return <TraceWorkspace />
  const what = params.get('tx') ?? params.get('address')
  const name = params.get('name')
  return (
    <div className="min-h-screen grid place-items-center bg-bg px-4">
      <div className="w-full max-w-md border border-line bg-panel p-6 space-y-5">
        <Link href="/" className="block text-[13px] font-medium tracking-[0.24em] text-fg">ASHIATO</Link>
        <div className="space-y-2">
          <h1 className="text-xl font-medium text-fg">Sign in to trace</h1>
          <p className="text-sm text-muted leading-relaxed">
            Every trace is saved to your account, so nothing is lost. Signing in is free and never sends a transaction.
          </p>
          {what && (
            <p className="text-xs text-faint">
              Then we&apos;ll open {name ? <>“<span className="text-fg">{name}</span>” for </> : ''}<span className="font-mono text-muted">{truncate(what, 8)}</span>.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => signIn()} disabled={busy}
            className="inline-flex items-center gap-2 h-11 px-5 text-sm font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50">
            <Wallet size={15} /> {busy ? 'Check your wallet…' : 'Connect wallet'}
          </button>
          <button onClick={() => signIn()} disabled={busy}
            className="inline-flex items-center gap-2 h-11 px-5 text-sm font-medium border border-line hover:border-accent text-fg disabled:opacity-50">
            <Mail size={15} /> Sign in with email
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </div>
  )
}

function TraceWorkspace() {
  const params = useSearchParams()
  const router = useRouter()
  const { address: authAddress } = useAuth()

  // The connected wallet signs community labels and votes (free: a signature, no transaction)
  const { data: walletClient } = useWalletClient()
  const attester = useMemo<Attester | undefined>(() => walletClient ? {
    address: walletClient.account.address.toLowerCase(),
    label: l => signLabel(walletClient, l),
    vote: (uid, v) => signVote(walletClient, uid, v),
    revoke: uid => signRevoke(walletClient, uid),
  } : undefined, [walletClient])
  const rawAddress = params.get('address') ?? ''
  const originTx = (params.get('tx') ?? '').toLowerCase()
  const chainParam = params.get('chain') as Chain | null
  const originChain: Chain | null = isChain(chainParam) ? chainParam : originTx ? (originTx.startsWith('0x') ? 'eth' : 'btc') : detectChain(rawAddress)
  const originAddress = !originTx && originChain ? normaliseAddress(rawAddress, originChain) : ''
  const originKey = originTx || originAddress

  // What we know about each address, and which ones the user has put on the graph
  const [known, setKnown] = useState<Map<string, NodeData>>(new Map())
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [pages, setPages] = useState<Map<string, LoadedPage>>(new Map())
  const [hubs, setHubs] = useState<Map<string, TxLookup>>(new Map())
  const [followedPairs, setFollowedPairs] = useState<Set<string>>(new Set())
  /** Per-transaction edge ids drawn individually instead of as a relationship line */
  const [itemizedIds, setItemizedIds] = useState<Set<string>>(new Set())
  /** What the client says they paid, checked against the chain */
  const [payments, setPayments] = useState<CheckedPayment[]>([])
  const [paymentsOpen, setPaymentsOpen] = useState(false)
  const [checking, setChecking] = useState<string | null>(null)
  const intake = params.get('intake') === '1'
  /** Address pairs whose link the user hid from the graph */
  const [hiddenLinks, setHiddenLinks] = useState<Set<string>>(new Set())
  /** Cross-chain swaps put on the graph (a service's order records link the two chains) */
  const [bridgeHops, setBridgeHops] = useState<(CrossChainHop & { via: string; sender?: string; bridge?: string })[]>([])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [traced, setTraced] = useState<TracedFlow[]>([])
  const [traceEnds, setTraceEnds] = useState<TraceEnd[]>([])
  const [history, setHistory] = useState<Snapshot[]>([])

  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [loadingAddrs, setLoadingAddrs] = useState<Set<string>>(new Set())
  const [loadingMore, setLoadingMore] = useState(false)

  const [selection, setSelection] = useState<Selection>(null)
  const [tab, setTab] = useState<AddressTab>('transactions')
  // The left case panel starts hidden so the graph gets the room; your choice is remembered
  const [caseCollapsed, setCaseCollapsed] = useState(true)
  useEffect(() => {
    try { if (localStorage.getItem('ashiato.caseOpen') === '1') setCaseCollapsed(false) } catch { /* storage blocked */ }
  }, [])

  const [follow, setFollow] = useState<FollowSettings>({ hops: 10, branches: 3, adaptive: true, minSharePct: 35 })
  const [traceStatus, setTraceStatus] = useState<string | null>(null)
  const traceCancel = useRef(false)
  const restoring = useRef<string | null>(null)
  /** Node positions on the canvas (shared with the graph, saved with the chart) */
  const positionsRef = useRef(new Map<string, XY>())
  // Right panel width: drag to resize, or expand for a wide table view (remembered)
  const [panelW, setPanelW] = useState(400)
  const [panelExpanded, setPanelExpanded] = useState(false)
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem('cryptotracer.panelWidth'))
      if (w >= 320) setPanelW(w)
    } catch { /* storage blocked */ }
  }, [])
  const panelCss = panelExpanded ? 'min(1180px, 78vw)' : `min(${panelW}px, 70vw)`
  // Phones always get the stacked list: the wide table (smart expand) doesn't fit
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  const panelWide = !narrow && (panelExpanded || panelW >= 680)
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    setResizing(true)
    const move = (ev: MouseEvent) => {
      const w = Math.max(320, Math.min(window.innerWidth * 0.8, window.innerWidth - ev.clientX))
      setPanelExpanded(false)
      setPanelW(Math.round(w))
    }
    const up = () => {
      setResizing(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setPanelW(w => {
        try { localStorage.setItem('cryptotracer.panelWidth', String(w)) } catch { /* storage blocked */ }
        return w
      })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  /** The browser-saved chart this view came from, so Save updates it */
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const changeCount = useRef(0)
  /** Set when state is replaced wholesale (open / reset) so it doesn't count as an edit */
  const skipChange = useRef(false)
  const [autosave, setAutosaveState] = useState(true)
  useEffect(() => {
    try { setAutosaveState(localStorage.getItem('cryptotracer.autosave') !== '0') } catch { /* storage blocked */ }
  }, [])
  const setAutosave = (on: boolean) => {
    setAutosaveState(on)
    try { localStorage.setItem('cryptotracer.autosave', on ? '1' : '0') } catch { /* storage blocked */ }
  }
  const graphApi = useRef<GraphApi | null>(null)

  // Refs mirror state for use inside long-running async traces
  const pagesRef = useRef(pages)
  const knownRef = useRef(known)
  const btcTxCache = useRef(new Map<string, BtcTxInfo>())
  const btcLabels = useRef(new Map<string, EntityLabel>())

  // Today's prices in the display currency (Settings)
  const { currency, atTransfer } = useSettings()
  const [prices, setPrices] = useState<Record<string, number>>({})
  useEffect(() => {
    const c = currency.toLowerCase()
    let stale = false
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,tron,binancecoin,polygon-ecosystem-token&vs_currencies=${c}`)
      .then(r => r.json())
      .then(d => {
        if (stale) return
        const eth = d.ethereum?.[c] ?? 0, btc = d.bitcoin?.[c] ?? 0, bnb = d.binancecoin?.[c] ?? 0, pol = d['polygon-ecosystem-token']?.[c] ?? 0
        setPrices({ BTC: btc, WBTC: btc, BTCB: btc, ETH: eth, WETH: eth, TRX: d.tron?.[c] ?? 0, USD: d.tether?.[c] ?? 0, BNB: bnb, WBNB: bnb, POL: pol, WPOL: pol })
      })
      .catch(() => {})
    return () => { stale = true }
  }, [currency])
  // Daily price history, to value each transfer at the time it moved (Settings)
  const [priceHistory, setPriceHistory] = useState<PriceHistory | null>(null)
  useEffect(() => {
    let stale = false
    setPriceHistory(null)
    fetch(`/api/prices/history?currency=${currency}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!stale && d?.prices) setPriceHistory(d.prices) })
      .catch(() => {})
    return () => { stale = true }
  }, [currency])
  const pricing = useMemo<Pricing>(() => ({ today: prices, history: priceHistory, atTransfer }), [prices, priceHistory, atTransfer])

  // One timer: an older toast's timeout must not cut a newer one short
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flash = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 5000)
  }, [])

  const setKnownNow = (next: Map<string, NodeData>) => {
    knownRef.current = next
    setKnown(next)
  }

  /**
   * Merges a page into state. `add` = addresses to put on the graph. Background loads pass []
   * so an address the user removed while its page was loading stays removed.
   */
  const absorb = useCallback((result: TraceResult, add: string[], append = false) => {
    const next = new Map(knownRef.current)
    for (const n of result.nodes) {
      const ex = next.get(n.address)
      if (n.address === result.address) {
        next.set(n.address, {
          ...(ex ?? n),
          balance: n.balance,
          // A later page only counts its own transactions
          txCount: append && ex ? Math.max(ex.txCount, n.txCount) : n.txCount,
          risk: n.risk,
          findings: n.findings,
          ens: n.ens ?? ex?.ens,
          label: ex?.label && !ex.label.inferredBy ? ex.label : n.label ?? ex?.label,
          isExpanded: true,
          isOrigin: n.address === originAddress,
        })
      } else if (!ex) {
        next.set(n.address, { ...n, isOrigin: false })
      } else if ((!ex.label && n.label) || (!ex.ens && n.ens)) {
        next.set(n.address, { ...ex, label: ex.label ?? n.label, ens: ex.ens ?? n.ens })
      }
    }
    setKnownNow(next)
    const ex = pagesRef.current.get(result.address)
    const seen = new Set<string>()
    const rawTxs = (append && ex ? [...ex.rawTxs, ...result.rawTxs] : result.rawTxs).filter(t => {
      const k = transferKey(t)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
      // Pages don't arrive in date order (Tron merges two lists; saved cases reload on top), so sort
      .sort((a, b) => (b.timestamp || Infinity) - (a.timestamp || Infinity))
    pagesRef.current = new Map(pagesRef.current).set(result.address, { rawTxs, nextCursor: result.nextCursor, warnings: result.warnings })
    setPages(pagesRef.current)
    if (add.length) setVisible(prev => new Set([...prev, ...add]))
  }, [originAddress])

  /** Registers a looked-up transaction: its participants become known (with labels / ENS) */
  const absorbTx = useCallback((l: TxLookup) => {
    const next = new Map(knownRef.current)
    for (const t of l.transfers) {
      for (const io of [...t.inputs, ...t.outputs]) {
        if (!io.address) continue
        const ex = next.get(io.address)
        const label = ex?.label ?? l.labels[io.address]
        const ens = ex?.ens ?? l.ens[io.address]
        if (!ex) next.set(io.address, { address: io.address, chain: l.chain, label, ens, balance: 0, txCount: 0, isOrigin: false })
        else if (label !== ex.label || ens !== ex.ens) next.set(io.address, { ...ex, label, ens })
      }
    }
    for (const [a, lab] of Object.entries(l.labels)) btcLabels.current.set(a, lab)
    setKnownNow(next)
    setHubs(prev => new Map(prev).set(l.txid, l))
  }, [])

  /**
   * Bumped whenever the case is replaced wholesale (new search, start over, opened case):
   * async work started for the previous case drops its results, and the graph starts fresh.
   */
  const caseGen = useRef(0)
  const [caseRev, setCaseRev] = useState(0)
  const newCase = () => {
    caseGen.current++
    setCaseRev(caseGen.current)
    traceCancel.current = true
    bulkCancel.current = true
    autoLoaded.current.clear()
    setTraceStatus(null)
    setPinned(new Set())
    setExpandedChains(new Set())
  }

  const resetState = () => {
    newCase()
    positionsRef.current.clear()
    savedOrigin.current = null
    setSaved(null)
    setDirty(false)
    setLastSavedAt(null)
    setKnownNow(new Map())
    setVisible(new Set())
    pagesRef.current = new Map()
    setPages(pagesRef.current)
    setHubs(new Map())
    setFollowedPairs(new Set())
    setItemizedIds(new Set())
    setHiddenLinks(new Set())
    setPayments([])
    setBridgeHops([])
    setAnnotations([])
    setTraced([])
    setTraceEnds([])
    setHistory([])
    setSelection(null)
  }

  const loadOrigin = useCallback(async () => {
    if (intake && !originTx && !originAddress) {
      // Started from "Check client payments": nothing to load until they're checked
      resetState()
      setInitialLoading(false)
      setPaymentsOpen(true)
      return
    }
    if (!originChain || (!originTx && !originAddress)) {
      setError('Not a valid Bitcoin, Ethereum or Tron address or transaction')
      setInitialLoading(false)
      return
    }
    setInitialLoading(true)
    setError('')
    resetState()
    const gen = caseGen.current
    try {
      if (originTx) {
        // A bare 64-hex hash is Bitcoin or Tron; try Tron when Bitcoin has no such tx
        let l: TxLookup
        try {
          l = await fetchTxLookup(originTx, originChain)
        } catch (e) {
          if (originChain !== 'btc') throw e
          l = await fetchTxLookup(originTx, 'tron').catch(() => { throw e })
          if (caseGen.current !== gen) return
          restoring.current = urlKey(`/trace?tx=${originTx}&chain=tron`)
          router.replace(`/trace?tx=${originTx}&chain=tron`)
        }
        // Another search (or Start over) began while this one loaded
        if (caseGen.current !== gen) return
        absorbTx(l)
        const { inputs, outputs } = txParticipants(l)
        setVisible(new Set([...inputs.slice(0, TX_PARTICIPANTS), ...outputs.slice(0, TX_PARTICIPANTS)]))
        setSelection({ kind: 'tx', id: l.txid })
      } else {
        const r = await fetchTrace(originAddress, originChain)
        if (caseGen.current !== gen) return
        // Start with just the address; the user adds counterparties from the panel
        absorb(r, [r.address])
        setSelection({ kind: 'address', id: r.address })
        setTab('transactions')
      }
    } catch (e) {
      if (caseGen.current === gen) setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      if (caseGen.current === gen) setInitialLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originAddress, originTx, originChain, absorb, absorbTx])

  const caseParam = params.get('case')
  useEffect(() => {
    // Skip only the exact URL we just wrote ourselves (a save or a restore), never a new search
    const skip = restoring.current
    restoring.current = null
    if (skip && skip === urlKey(`/trace?${params.toString()}`)) return
    if (caseParam) {
      if (saved?.id === caseParam) return // already open (just saved, or the URL was tidied)
      getSavedChart(caseParam)
        .then(r => {
          if (!r) throw new Error('That case was not found. It may have been deleted, or saved in another browser or account.')
          applyCase(parseCase(JSON.stringify(r.data)), { id: caseParam, name: r.name })
        })
        .catch(e => {
          setError(e instanceof Error ? e.message : 'Could not open the saved chart')
          setInitialLoading(false)
        })
      return
    }
    loadOrigin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, originChain, caseParam])

  const setBusy = (addr: string, busy: boolean) =>
    setLoadingAddrs(prev => {
      const n = new Set(prev)
      if (busy) n.add(addr)
      else n.delete(addr)
      return n
    })

  const chainOf = useCallback((a: string): Chain => known.get(a)?.chain ?? originChain ?? 'btc', [known, originChain])

  // Your own labels win over every other source, wherever the address appears
  const { labels: myLabels, setLabel: setMyLabel } = useMyLabels()
  const myLabelOf = useCallback((a: string) => myLabels[myLabelKey(chainOf(a), a)], [myLabels, chainOf])
  const mine = useCallback((a: string) => {
    const l = myLabelOf(a)
    return l ? toEntityLabel(l) : undefined
  }, [myLabelOf])

  /** Loads an address's first page if we don't have it yet */
  const ensurePage = useCallback(async (addr: string): Promise<LoadedPage | null> => {
    const have = pagesRef.current.get(addr)
    if (have && !have.trimmed) return have
    setBusy(addr, true)
    try {
      // A page saved without its full history: fetch it again, keeping what the graph used
      absorb(await fetchTrace(addr, knownRef.current.get(addr)?.chain ?? originChain ?? 'btc'), [], !!have)
      return pagesRef.current.get(addr) ?? null
    } catch (e) {
      flash(`${truncate(addr, 6)}: ${e instanceof Error ? e.message : 'failed to load'}`)
      return null
    } finally {
      setBusy(addr, false)
    }
  }, [absorb, flash, originChain])

  /** Puts addresses on the graph, creating bare nodes for ones only seen inside transactions */
  const showOnGraph = useCallback((addrs: string[]) => {
    const missing = addrs.filter(a => !knownRef.current.has(a))
    if (missing.length) {
      const next = new Map(knownRef.current)
      for (const a of missing) next.set(a, { address: a, chain: detectChain(a) ?? originChain ?? 'btc', label: btcLabels.current.get(a), balance: 0, txCount: 0, isOrigin: false })
      setKnownNow(next)
    }
    setVisible(prev => new Set([...prev, ...addrs]))
  }, [originChain])

  const snapshot = useCallback(() => {
    setHistory(prev => [...prev.slice(-29), { visible: new Set(visible), followedPairs: new Set(followedPairs), traced, traceEnds }])
  }, [visible, followedPairs, traced, traceEnds])

  const undo = () => {
    const last = history[history.length - 1]
    if (!last) return
    setVisible(last.visible)
    setFollowedPairs(last.followedPairs)
    setTraced(last.traced)
    setTraceEnds(last.traceEnds)
    setHistory(history.slice(0, -1))
  }

  /** Select an address (adding it to the graph if needed) and load its activity */
  const openAddress = (addr: string) => {
    if (!visible.has(addr)) {
      snapshot()
      showOnGraph([addr])
    }
    setSelection({ kind: 'address', id: addr })
    ensurePage(addr)
  }

  /** Quick actions from the menu around a clicked node */
  const [labelFor, setLabelFor] = useState<string | null>(null)
  const nodeAction = (addr: string, action: NodeAction) => {
    switch (action) {
      case 'transactions': // Smart expand: the wide table view
        openAddress(addr); setTab('transactions'); setPanelExpanded(true); break
      case 'relationships':
        openAddress(addr); setTab('counterparties'); setPanelExpanded(false); break
      case 'details':
        openAddress(addr); setTab('details'); setPanelExpanded(false); break
      case 'label':
        openAddress(addr); setPanelExpanded(false); setLabelFor(addr); break
      case 'copy':
        navigator.clipboard?.writeText(addr).then(() => flash('Address copied'), () => flash('Could not copy'))
        break
      case 'explorer':
        window.open(explorerAddressUrl(addr, chainOf(addr)), '_blank', 'noopener,noreferrer'); break
      case 'remove':
        if (addr === originAddress) flash("The case's starting address can't be removed")
        else removeNode(addr)
        break
      case 'watch':
        toggleWatch(addr); break
    }
  }

  // Watch alerts (Pro): addresses this account watches, address → watch id
  const [watches, setWatches] = useState<Map<string, string>>(new Map())
  const watched = useMemo(() => new Set(watches.keys()), [watches])
  useEffect(() => {
    if (!authAddress) return
    fetch('/api/watches').then(r => (r.ok ? r.json() : null)).then(b => {
      if (b?.watches) setWatches(new Map(b.watches.map((w: { address: string; id: string }) => [w.address, w.id])))
    }).catch(() => {})
  }, [authAddress])
  const toggleWatch = async (addr: string) => {
    const id = watches.get(addr)
    if (id) {
      setWatches(m => { const n = new Map(m); n.delete(addr); return n })
      await fetch(`/api/watches?id=${id}`, { method: 'DELETE' }).catch(() => {})
      flash('Stopped watching this address')
      return
    }
    flash('Watching… checking the address')
    const res = await fetch('/api/watches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: chainOf(addr), address: addr, label: nameOf(addr) }) }).catch(() => null)
    const body = await res?.json().catch(() => ({})) ?? {}
    if (res?.ok) {
      setWatches(m => new Map(m).set(addr, body.watch.id))
      flash('Watching: you will get an alert (the bell, top right) when funds move')
    } else flash(res?.status === 402 ? 'Watch alerts are part of Pro (see Pricing)' : body.error ?? 'Could not watch this address')
  }

  const addToGraph = (addrs: string[]) => {
    const fresh = addrs.filter(a => !visible.has(a))
    if (!fresh.length) return
    snapshot()
    showOnGraph(fresh)
    if (selection?.kind === 'address') setFollowedPairs(prev => new Set([...prev, ...fresh.map(a => pairKey(selection.id, a))]))
  }

  // ── Full history ─────────────────────────────────────────────────────────
  // Small Bitcoin addresses load their whole history automatically; big ones
  // (thousands of txs = hundreds of 25-tx Esplora requests) on request, with progress.
  const [bulk, setBulk] = useState<{ addr: string; loaded: number; total?: number } | null>(null)
  const bulkCancel = useRef(false)
  const bulkBusy = useRef(false)
  const autoLoaded = useRef(new Set<string>())

  const loadAllFor = useCallback(async (addr: string) => {
    if (bulkBusy.current) return
    bulkBusy.current = true
    bulkCancel.current = false
    const chain = knownRef.current.get(addr)?.chain ?? originChain ?? 'btc'
    const total = chain === 'btc' ? knownRef.current.get(addr)?.txCount : undefined
    const gen = caseGen.current
    try {
      let page = pagesRef.current.get(addr)
      setBulk({ addr, loaded: page?.rawTxs.length ?? 0, total })
      while (page?.nextCursor && !bulkCancel.current) {
        const next = await fetchTrace(addr, chain, page.nextCursor)
        if (caseGen.current !== gen) break
        absorb(next, [], true)
        page = pagesRef.current.get(addr)
        setBulk({ addr, loaded: page?.rawTxs.length ?? 0, total })
      }
    } catch (e) {
      flash(e instanceof Error ? `Stopped loading history: ${e.message}` : 'Stopped loading history')
    } finally {
      bulkBusy.current = false
      setBulk(null)
    }
  }, [absorb, originChain, flash])

  useEffect(() => {
    if (bulkBusy.current) return
    for (const [addr, page] of pages) {
      const n = known.get(addr)
      if (!page.nextCursor || n?.chain !== 'btc' || autoLoaded.current.has(addr)) continue
      if (n.txCount > 0 && n.txCount <= AUTO_FULL_HISTORY_BTC) {
        autoLoaded.current.add(addr)
        loadAllFor(addr)
        return // one at a time; the next runs when this one's pages land
      }
    }
  }, [pages, known, loadAllFor])

  /** Loads the next page of history for each address that has more */
  const loadMoreFor = async (addrs: string[]) => {
    setLoadingMore(true)
    try {
      for (const addr of addrs) {
        // Esplora returns only 25 BTC transactions per call, so fetch 4 pages per click
        const pagesPerClick = chainOf(addr) === 'btc' ? 4 : 1
        for (let i = 0; i < pagesPerClick; i++) {
          const cursor = pagesRef.current.get(addr)?.nextCursor
          if (!cursor) break
          absorb(await fetchTrace(addr, chainOf(addr), cursor), [], true)
        }
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }
  const loadMore = () => (selection?.kind === 'address' ? loadMoreFor([selection.id]) : undefined)

  /**
   * Every transaction between A and B is in both histories, so once either side's
   * full history is loaded the relationship is complete. Otherwise load the side
   * that's missing first (cheap), then older pages of both.
   */
  const pairHistory = (a: string, b: string) => {
    const full = [a, b].find(x => pages.get(x) && !pages.get(x)!.nextCursor)
    const count = (x: string) => pages.get(x)?.rawTxs.length ?? 0
    const nm = (x: string) => nameOf(x) ?? truncate(x, 6)
    if (full) {
      return {
        canLoadMore: false,
        historyNote: `All transactions between these addresses are loaded: ${nm(full)}'s full history (${count(full)} transactions) is loaded.`,
        onLoadMore: () => {},
      }
    }
    const missing = [a, b].filter(x => !pages.get(x))
    return {
      canLoadMore: true,
      historyNote: missing.length
        ? `${missing.map(nm).join(' and ')}'s history isn't loaded yet; it may hold more transactions between them.`
        : `Only the latest ${count(a)} of ${nm(a)}'s and ${count(b)} of ${nm(b)}'s transactions are loaded. Load more fetches older ones for both.`,
      onLoadMore: async () => {
        if (!missing.length) return loadMoreFor([a, b].filter(x => pages.get(x)?.nextCursor))
        setLoadingMore(true)
        try {
          for (const x of missing) await ensurePage(x)
        } finally {
          setLoadingMore(false)
        }
      },
    }
  }

  const removeNode = (addr: string) => {
    snapshot()
    // Everything still on screen stays on screen: without this, removing one node can turn a
    // neighbour into a pass-through that then folds into a collapsed chain and vanishes too
    setPinned(prev => {
      const n = new Set(prev)
      for (const x of drawnNodes) if (x.address !== addr) n.add(x.address)
      n.delete(addr)
      return n
    })
    setVisible(prev => {
      const n = new Set(prev)
      n.delete(addr)
      return n
    })
    setSelection(originAddress && addr !== originAddress ? { kind: 'address', id: originAddress } : originTx ? { kind: 'tx', id: originTx } : null)
  }

  // ── Follow the funds ─────────────────────────────────────────────────────
  const addressTxs = useCallback(async (addr: string, since: number): Promise<RawTransaction[]> => {
    // A trimmed page (from a slimmed saved case) is reloaded before tracing through it
    let page = (pagesRef.current.get(addr)?.trimmed ? null : pagesRef.current.get(addr)) ?? (await ensurePage(addr))
    if (!page) throw new Error(`Could not load ${truncate(addr, 6)}`)
    const chain = knownRef.current.get(addr)?.chain ?? originChain ?? 'eth'
    for (let i = 0; i < MAX_EXTRA_PAGES && page.nextCursor; i++) {
      const stamps = page.rawTxs.map(t => t.timestamp).filter(Boolean)
      const oldest = stamps.length ? Math.min(...stamps) : 0
      if (oldest && oldest <= since) break
      absorb(await fetchTrace(addr, chain, page.nextCursor), [], true)
      page = pagesRef.current.get(addr)!
    }
    return page.rawTxs
  }, [absorb, ensurePage, originChain])

  const btcTx = useCallback(async (txid: string): Promise<BtcTxInfo> => {
    const hit = btcTxCache.current.get(txid)
    if (hit) return hit
    const info = await getJson<BtcTxInfo>(`/api/tx/btc/${txid}`)
    for (const [a, l] of Object.entries(info.labels)) btcLabels.current.set(a, l)
    btcTxCache.current.set(txid, info)
    return info
  }, [])

  // ── Client payments ──────────────────────────────────────────────────────
  /** An address's history back to `since` (loads older pages as needed) */
  const historyUntil = async (addr: string, chain: Chain, since: number): Promise<RawTransaction[]> => {
    let page = pagesRef.current.get(addr)
    if (!page) {
      absorb(await fetchTrace(addr, chain), [], false)
      page = pagesRef.current.get(addr)
    }
    for (let i = 0; i < 20 && page?.nextCursor; i++) {
      const stamps = page.rawTxs.map(t => t.timestamp).filter(Boolean)
      if (stamps.length && Math.min(...stamps) <= since) break
      setChecking(`Loading older history of ${truncate(addr, 6)}…`)
      absorb(await fetchTrace(addr, chain, page.nextCursor), [], true)
      page = pagesRef.current.get(addr)
    }
    return page?.rawTxs ?? []
  }

  const checkPayments = async (text: string) => {
    const claims = parseClientPayments(text)
    if (!claims.length) return
    const base = Date.now().toString(36)
    for (const [i, c] of claims.entries()) {
      const id = `${base}${i}`
      setChecking(`Checking payment ${i + 1} of ${claims.length}…`)
      let result: CheckedPayment
      try {
        if (!c.txid && !c.address) {
          result = { id, claim: c, status: 'error', notes: [] }
        } else if (c.txid) {
          // A bare 64-hex hash is Bitcoin (Tron hashes look the same; tried next)
          const chains: Chain[] = c.chain ? [c.chain] : ['btc', 'tron']
          let found: PaymentMatch[] | null = null
          // Not found (404) or not that chain's format (400) means try the next chain;
          // anything else (node down, rate limit) means we couldn't check, not "not found"
          let failure: Error | null = null
          for (const ch of chains) {
            try {
              found = transfersOf((await fetchTxLookup(c.txid, ch)).transfers)
              break
            } catch (e) {
              if (!(e instanceof HttpError && (e.status === 404 || e.status === 400))) failure = e instanceof Error ? e : new Error('Could not check')
            }
          }
          result = found ? judgePayment(c, found, id)
            : failure ? { id, claim: c, status: 'error', notes: [failure.message] }
              : { id, claim: c, status: 'not-found', notes: ['Transaction not found'] }
        } else {
          const chain = detectChain(c.address!)!
          // With a date, page back far enough to cover it; without one, the latest history
          const txs = await historyUntil(c.address!, chain, c.date !== undefined ? c.date - 4 * 86400 : Number.POSITIVE_INFINITY)
          result = judgePayment(c, transfersOf(txs), id)
        }
      } catch (e) {
        result = { id, claim: c, status: 'error', notes: [e instanceof Error ? e.message : 'Could not check'] }
      }
      setPayments(prev => [...prev, result])
    }
    setChecking(null)
  }

  const traceAllPayments = () => {
    const seed = seedsFromPayments(payments)
    if (!seed.lots.length) return
    setPaymentsOpen(false)
    // Started without an address: the first recipient becomes the case's anchor
    if (!originKey) {
      const first = seed.lots[0]
      restoring.current = urlKey(`/trace?address=${encodeURIComponent(first.address)}&chain=${first.chain}`)
      router.replace(`/trace?address=${encodeURIComponent(first.address)}&chain=${first.chain}`)
    }
    runFollow('forward', seed)
  }

  const runFollow = async (direction: Direction, seed: { lots: Lot[]; flows: TracedFlow[]; ends?: TraceEnd[] }) => {
    if (!seed.lots.length) {
      flash('Nothing to trace from here')
      return
    }
    snapshot()
    traceCancel.current = false
    const gen = caseGen.current
    const before = traced
    const show = (flows: TracedFlow[]) => {
      // A different case was opened mid-trace: never write this trail into it
      if (caseGen.current !== gen) return
      const real = flows.filter(f => f.from && f.to)
      setTraced(uniqueFlows([...before, ...real]))
      showOnGraph([...new Set(real.flatMap(f => [f.from, f.to]))])
    }
    show(seed.flows)
    setTraceStatus(direction === 'forward' ? 'Following the funds…' : 'Walking back to the source…')
    try {
      const res = await followFunds(
        seed.lots,
        {
          direction, maxHops: follow.hops, maxBranches: follow.branches, stopAt: STOP_AT, adaptive: follow.adaptive, minShare: follow.minSharePct / 100,
          // A cross-chain swap ends the trail here; the link's Bridgers box shows where it went
          stopWhen: l => BRIDGE_NAME.test(l.name),
        },
        // Your own labels count too: a wallet you marked as an exchange ends the trail there
        { addressTxs, btcTx, labelOf: a => mine(a) ?? knownRef.current.get(a)?.label ?? btcLabels.current.get(a) },
        (msg, partial) => {
          if (caseGen.current !== gen) return
          setTraceStatus(msg)
          show([...seed.flows, ...partial.flows])
        },
        () => traceCancel.current
      )
      if (caseGen.current !== gen) return
      const flows = [...seed.flows, ...res.flows].filter(f => f.from && f.to)
      show(flows)
      // Addresses the trail stopped at belong on the graph; peeled-off payments and minor
      // splits were deliberately not followed, so they stay in the side list only
      showOnGraph(res.ends.filter(e => !OFF_TRAIL.includes(e.reason)).map(e => e.address))
      setTraceEnds(prev => mergeEnds([...prev, ...(seed.ends ?? []), ...res.ends]))
      const cashOut = res.ends.filter(e => e.reason === 'entity').length
      flash(`Traced ${flows.length} hop${flows.length === 1 ? '' : 's'}${cashOut ? ` · reached ${cashOut} exchange/mixer/sanctioned endpoint${cashOut === 1 ? '' : 's'}` : ''}`)
    } catch (e) {
      if (caseGen.current === gen) flash(e instanceof Error ? e.message : 'Trace failed')
    } finally {
      if (caseGen.current === gen) setTraceStatus(null)
    }
  }

  /** Transaction-level: follow one output (or all) onward */
  const traceTxOut = (tx: RawTransaction, to?: string) => {
    const from = isEvm(tx.chain) ? tx.inputs[0]?.address ?? '' : ''
    runFollow('forward', seedsFromTx(tx, from, to, follow.adaptive))
  }

  /** Transaction-level: walk one input (or all) back to its source */
  const traceTxIn = (tx: RawTransaction, input?: TxIO) => {
    if (isEvm(tx.chain)) {
      runFollow('backward', backSeedsFromTx(tx, tx.outputs[0].address, input?.address))
      return
    }
    const lots: Lot[] = (input ? [input] : tx.inputs).map(i => {
      const [ptx, pvout] = (i.prev ?? '').split(':')
      return { chain: 'btc', address: i.address, asset: 'BTC', amount: i.amount, time: tx.timestamp, via: ptx || undefined, vout: pvout ? +pvout : undefined, hop: 0 }
    })
    runFollow('backward', { lots, flows: [] })
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const hubTxs = useMemo(() => [...hubs.values()].flatMap(h => h.transfers), [hubs])
  const allTxs = useMemo(() => [...[...pages.values()].flatMap(p => p.rawTxs), ...hubTxs], [pages, hubTxs])

  const perTx = useMemo(
    () => [...pages.entries()].flatMap(([addr, p]) => txEdges(addr, chainOf(addr), p.rawTxs)),
    [pages, chainOf]
  )
  const allEdges = useMemo(() => aggregateEdges(perTx), [perTx])

  const labelOf = useCallback((a: string): EntityLabel | undefined => mine(a) ?? known.get(a)?.label ?? btcLabels.current.get(a), [known, mine])
  const ensOf = useCallback((a: string) => known.get(a)?.ens, [known])

  const clusters = useMemo(() => {
    const labels = new Map<string, EntityLabel | undefined>()
    known.forEach((n, a) => labels.set(a, n.label))
    return clusterAddresses(allTxs, labels)
  }, [allTxs, known])

  const tornado = useMemo(() => (originChain === 'eth' ? findTornadoLinks(allTxs, labelOf) : []), [allTxs, labelOf, originChain])


  const selectedAddress = selection?.kind === 'address' ? selection.id : null

  // Ends at a wallet now known (or labelled by you) as an exchange/mixer read as 'reached' it,
  // even if the trace ran before the label existed
  const displayEnds = useMemo(() => traceEnds.map(e => {
    if (e.reason === 'entity') return e
    const l = mine(e.address) ?? known.get(e.address)?.label
    return l && STOP_AT.includes(l.type) ? { ...e, reason: 'entity' as const, detail: `Reached ${l.name} (${l.type})` } : e
  }), [traceEnds, known, mine])

  const graphNodes: AddressNodeData[] = useMemo(() => {
    // An exchange pools everyone's money: ending there is 'reached', not 'pooled'
    const pooledAt = new Map(displayEnds.filter(e => e.reason === 'diluted' && e.share !== undefined).map(e => [e.address, e.share!]))
    return [...visible].flatMap(a => {
      const n = known.get(a)
      if (!n) return []
      const cluster = clusters.byAddress.get(a)
      return [{
        ...n,
        label: mine(a) ?? n.label ?? btcLabels.current.get(a) ?? cluster?.label,
        isOrigin: a === originAddress,
        clusterId: cluster?.id,
        view: {
          clusterSize: cluster?.members.length,
          loading: loadingAddrs.has(a),
          pooled: pooledAt.get(a),
        },
      }]
    })
  }, [visible, known, clusters, loadingAddrs, originAddress, displayEnds, mine])

  const graphEdges = useMemo(() => {
    const ids = new Set(graphNodes.map(n => n.address))
    return allEdges.filter(e => ids.has(e.source) && ids.has(e.target) && !hiddenLinks.has(pairKey(e.source, e.target)))
  }, [allEdges, graphNodes, hiddenLinks])
  const graphTraced = useMemo(() => traced.filter(f => !hiddenLinks.has(pairKey(f.from, f.to))), [traced, hiddenLinks])

  // Long pass-through runs (peel chains, relays) drawn as one line; the hops stay in the data
  const [collapseOn, setCollapseOn] = useState(true)
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set())
  /** Addresses never folded into a chain (they were on screen when you removed something) */
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const collapsed = useMemo(() => {
    if (!collapseOn) return { chains: [], hidden: new Set<string>() }
    // Selection isn't part of this: clicking a node must never fold or unfold chains (that moves nodes)
    const keep = new Set<string>([originAddress, ...pinned].filter(Boolean))
    for (const n of graphNodes) if (n.label || n.note) keep.add(n.address)
    return collapseChains({ nodes: graphNodes.map(n => n.address), edges: graphEdges, traced: graphTraced, keep, expanded: expandedChains })
  }, [collapseOn, graphNodes, graphEdges, graphTraced, expandedChains, originAddress, pinned])
  // Opening an address hidden inside a collapsed chain (from search or a list) keeps it out for good
  useEffect(() => {
    if (selectedAddress && collapsed.hidden.has(selectedAddress)) setPinned(prev => new Set(prev).add(selectedAddress))
  }, [selectedAddress, collapsed])
  const drawn = useMemo(() => {
    const h = collapsed.hidden
    if (!h.size) return null
    return {
      nodes: graphNodes.filter(n => !h.has(n.address)),
      edges: graphEdges.filter(e => !h.has(e.source) && !h.has(e.target)),
      traced: graphTraced.filter(f => !h.has(f.from) && !h.has(f.to)),
    }
  }, [collapsed, graphNodes, graphEdges, graphTraced])
  const drawnNodes = drawn?.nodes ?? graphNodes
  // The layout is never re-done wholesale: collapsing chains, removing or adding nodes keeps
  // everything where it is (collapsed chains pull their end in), and the zoom where the user left it
  /** Bumped when a view toggle (collapse / expand) adds or hides nodes, so the zoom stays put */
  const [quietRev, setQuietRev] = useState(0)
  /** One traced transaction goes, with whatever was traced onward from it and from nothing else */
  const removeTraced = (flow: TracedFlow) => {
    snapshot()
    const same = (f: TracedFlow) => f.txid === flow.txid && f.from === flow.from && f.to === flow.to
    let left = traced.filter(f => !same(f))
    const queue = [flow]
    while (queue.length) {
      const cut = queue.shift()!
      // Other traced money still reaches this address: its onward trail stays
      if (left.some(f => f.to === cut.to && f.from !== cut.to)) continue
      const onward = left.filter(f => f.from === cut.to && f.hop > cut.hop && f.time >= cut.time)
      left = left.filter(f => !onward.includes(f))
      queue.push(...onward)
    }
    setTraced(left)
    flash(`Removed ${traced.length - left.length} traced transaction${traced.length - left.length === 1 ? '' : 's'}`)
  }
  const hideLink = (a: string, b: string) => {
    setHiddenLinks(prev => new Set(prev).add(pairKey(a, b)))
    setSelection(null)
  }

  // One line per (from, to): several swaps to the same destination are summed, not stacked
  const graphBridges = useMemo(() => {
    const groups = new Map<string, typeof bridgeHops>()
    for (const h of bridgeHops) groups.set(`${h.via}|${h.toAddress}`, [...(groups.get(`${h.via}|${h.toAddress}`) ?? []), h])
    const sum = (hs: typeof bridgeHops, amt: (h: CrossChainHop) => number, asset: (h: CrossChainHop) => string) => {
      const m = new Map<string, number>()
      for (const h of hs) m.set(asset(h), (m.get(asset(h)) ?? 0) + amt(h))
      return [...m].map(([a, v]) => fmtCompact(v, a)).join(' + ')
    }
    return [...groups.values()].map(hs => {
      const h = hs[0]
      const fromChains = [...new Set(hs.map(x => chainDisplay(x.fromChainName)))]
      const times = hs.map(x => x.time).filter((t): t is number => !!t)
      return {
        id: hs.map(x => x.orderId).join('+'),
        from: h.via,
        to: h.toAddress,
        line1: `${sum(hs, x => x.fromAmount, x => x.fromAsset)} → ${sum(hs, x => x.toAmount, x => x.toAsset)} (${chainDisplay(h.toChainName)})`,
        line2: `via ${h.service}${hs.length > 1 ? ` · ${hs.length} swaps` : ''}${fromChains.length > 1 || fromChains[0] !== 'Ethereum' ? ` · from ${fromChains.join(' + ')}` : ''}${times.length ? ` · ${fmtDay(Math.min(...times))}` : ''}`,
      }
    })
  }, [bridgeHops])
  const graphHubs = useMemo(() => [...hubs.values()].map(toHub), [hubs])

  /** Transactions on the trail, coloured in the address panel: traced steps, ones you added, and cross-chain
   *  swaps added to the graph (money into the bridge and out on the other chain). Bridges
   *  write hashes with or without 0x and in either case, so each is stored every way. */
  const tracedTxids = useMemo(() => {
    const ids = new Set(traced.map(f => f.txid))
    // Transactions you put on the graph yourself ('+ Graph', ticked in a link) are on the trail too
    for (const id of itemizedIds) ids.add(id.split('|')[0])
    for (const h of bridgeHops) {
      for (const raw of [h.fromHash, h.toHash]) {
        if (!raw) continue
        const bare = raw.toLowerCase().replace(/^0x/, '')
        ids.add(raw).add(bare).add(`0x${bare}`)
      }
    }
    return ids
  }, [traced, bridgeHops, itemizedIds])

  const legendTypes = useMemo(() => {
    const present = new Set(graphNodes.map(n => n.label?.type).filter(Boolean) as EntityType[])
    return (Object.keys(ENTITY_STYLE) as EntityType[]).filter(t => present.has(t) || ['exchange', 'deposit', 'mixer', 'sanctioned', 'scam', 'unknown'].includes(t))
  }, [graphNodes])

  const nodeMap = useMemo(() => new Map(graphNodes.map(n => [n.address, n as NodeData])), [graphNodes])
  const nameOf = useCallback((a: string) => nodeMap.get(a)?.label?.name ?? labelOf(a)?.name ?? ensOf(a), [nodeMap, labelOf, ensOf])

  const selectedNode = selectedAddress
    ? graphNodes.find(n => n.address === selectedAddress) ??
      (known.get(selectedAddress) && { ...known.get(selectedAddress)!, label: mine(selectedAddress) ?? known.get(selectedAddress)!.label })
    : undefined
  const selectedCounterparties = useMemo(() => (selectedAddress ? findCounterparties(selectedAddress, allEdges) : []), [selectedAddress, allEdges])

  // Both directions between the selected pair
  const edgeRows = useMemo(() => {
    if (selection?.kind !== 'flow') return []
    const { from: a, to: b } = selection
    const seen = new Set<string>()
    return perTx.filter(e => {
      const hit = (e.source === a && e.target === b) || (e.source === b && e.target === a)
      if (!hit || seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })
  }, [perTx, selection])

  const itemizedEdges = useMemo(() => {
    if (!itemizedIds.size) return []
    const seen = new Set<string>()
    return perTx.filter(e => itemizedIds.has(e.id) && !hiddenLinks.has(pairKey(e.source, e.target)) && !seen.has(e.id) && seen.add(e.id))
  }, [perTx, itemizedIds, hiddenLinks])

  // Delete / Backspace hides the selected link, but only while you're on the graph or its
  // panel (not typing, and not in a dialog such as client payments)
  useEffect(() => {
    if (selection?.kind !== 'flow') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const onGraph = t === document.body || !!t.closest('.react-flow, [data-panel="inspector"]')
      if ((e.key === 'Delete' || e.key === 'Backspace') && onGraph && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault()
        hideLink(selection.from, selection.to)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection])

  const selectFlow = useCallback((from: string, to: string) => setSelection({ kind: 'flow', from, to }), [])

  const txForRow = (row: EdgeData): RawTransaction | undefined =>
    allTxs.find(t => t.txid === row.txid && t.asset === row.asset && t.inputs.some(i => i.address === row.source) && t.outputs.some(o => o.address === row.target))

  // ── Case files & exports ─────────────────────────────────────────────────
  const fileBase = `trace-${originChain}-${originKey.replace(/^0x/, '').slice(0, 10)}`

  /** Everything needed to reopen this chart exactly as it is */
  const buildCase = (): CaseFile | null =>
    originChain
      ? {
          version: CASE_VERSION,
          savedAt: new Date().toISOString(),
          origin: { address: originKey, chain: originChain },
          originKind: originTx ? 'tx' : 'address',
          // Your labels travel with the case (e.g. to another computer)
          known: [...known.values()].map(n => (mine(n.address) ? { ...n, label: mine(n.address) } : n)),
          visible: [...visible],
          pages: Object.fromEntries(pages),
          hubs: [...hubs.values()],
          followedPairs: [...followedPairs],
          traced,
          traceEnds,
          positions: Object.fromEntries([...positionsRef.current].filter(([a]) => visible.has(a) || hubs.has(a.replace(/^tx:/, '')))),
          itemizedIds: [...itemizedIds],
          hiddenLinks: [...hiddenLinks],
          clientPayments: payments,
          bridgeHops,
          annotations,
        }
      : null

  const saveCaseFile = () => {
    const c = buildCase()
    if (c) download(`${fileBase}.case.json`, JSON.stringify(c), 'application/json')
  }

  const caseUrl = (c: Pick<CaseFile, 'origin' | 'originKind'>, id?: string) =>
    (c.originKind === 'tx' ? `/trace?tx=${c.origin.address}&chain=${c.origin.chain}` : `/trace?address=${encodeURIComponent(c.origin.address)}&chain=${c.origin.chain}`) +
    (id ? `&case=${encodeURIComponent(id)}` : '')

  /** The origin of the open saved case, so auto-save can't write another trace into it */
  const savedOrigin = useRef<string | null>(null)

  const applyCase = (c: CaseFile, from?: { id: string; name: string }) => {
    newCase()
    skipChange.current = true
    savedOrigin.current = from ? c.origin.address : null
    setSaved(from ?? null)
    setLastSavedAt(from ? Date.parse(c.savedAt) : null)
    setDirty(false)
    positionsRef.current.clear()
    for (const [id, pos] of Object.entries(c.positions ?? {})) positionsRef.current.set(id, pos)
    setKnownNow(new Map(c.known.map(n => [n.address, n])))
    // Older cases put peeled-off payments on the chart; take those off unless they're on the trail
    const trail = new Set((c.traced ?? []).flatMap(f => [f.from, f.to]))
    const offTrail = new Set((c.traceEnds ?? []).filter(e => OFF_TRAIL.includes(e.reason) && !trail.has(e.address)).map(e => e.address))
    setVisible(new Set(c.visible.filter(a => !offTrail.has(a) || a === c.origin.address)))
    pagesRef.current = new Map(Object.entries(c.pages))
    setPages(pagesRef.current)
    setHubs(new Map((c.hubs ?? []).map(h => [h.txid, h])))
    setFollowedPairs(new Set(c.followedPairs))
    setItemizedIds(new Set(c.itemizedIds ?? []))
    setHiddenLinks(new Set(c.hiddenLinks ?? []))
    setPayments(c.clientPayments ?? [])
    setBridgeHops(c.bridgeHops ?? [])
    setAnnotations(c.annotations ?? [])
    setTraced(uniqueFlows(c.traced ?? []))
    setTraceEnds(mergeEnds(c.traceEnds ?? []))
    setHistory([])
    setError('')
    setInitialLoading(false)
    const isTx = c.originKind === 'tx'
    setSelection(isTx ? { kind: 'tx', id: c.origin.address } : { kind: 'address', id: c.origin.address })
    // Keep the case in the URL so a refresh or bookmark reopens (and keeps saving) the same case
    const url = caseUrl(c, from?.id)
    if (c.origin.address !== originKey || (params.get('case') ?? undefined) !== from?.id) {
      restoring.current = urlKey(url)
      router.replace(url)
    }
  }

  const loadCaseFile = async (file: File) => {
    try {
      const c = parseCase(await file.text())
      applyCase(c)
      flash(`Opened case saved ${new Date(c.savedAt).toLocaleString()}`)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not open case file')
    }
  }

  /**
   * Save the case in this browser. Saving again updates the same case; `asNew`
   * (Save as…) copies it under a new name. Auto-save calls this quietly.
   */
  const saveChart = async (name: string, opts: { asNew?: boolean; quiet?: boolean } = {}) => {
    const c = buildCase()
    if (!c) return
    // Safety net: auto-save never writes a different trace over an open case
    if (opts.quiet && saved && savedOrigin.current && savedOrigin.current !== c.origin.address) return
    const isNew = opts.asNew || !saved
    const id = isNew ? newCaseId() : saved!.id
    const counterAtSave = changeCount.current
    setSaving(true)
    try {
      await saveChartToBrowser(id, name, c)
      setSaved({ id, name })
      savedOrigin.current = c.origin.address
      setLastSavedAt(Date.now())
      if (changeCount.current === counterAtSave) setDirty(false)
      if (isNew || params.get('case') !== id) {
        restoring.current = urlKey(caseUrl(c, id))
        router.replace(caseUrl(c, id))
      }
      if (!opts.quiet) flash(isNew ? `Case “${name}” created. It now saves automatically${autosave ? '' : ' when you press Save'}.` : `Saved “${name}”`)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save the case')
    } finally {
      setSaving(false)
    }
  }
  const saveRef = useRef(saveChart)
  saveRef.current = saveChart

  // A case started from search arrives with its name (?name=): save it under that name once loaded
  const nameParam = params.get('name')
  const named = useRef(false)
  useEffect(() => {
    if (!nameParam || named.current || initialLoading || error || saved) return
    named.current = true
    saveRef.current(nameParam.slice(0, 80), { asNew: true })
  }, [nameParam, initialLoading, error, saved])

  // Anything that changes the case marks it unsaved; auto-save writes it 1.5 s after the last change
  const [layoutRev, setLayoutRev] = useState(0)
  useEffect(() => {
    if (skipChange.current) {
      skipChange.current = false
      return
    }
    changeCount.current++
    setDirty(true)
  }, [known, visible, pages, hubs, followedPairs, itemizedIds, hiddenLinks, payments, traced, traceEnds, layoutRev, myLabels, bridgeHops, annotations])
  useEffect(() => {
    if (!autosave || !saved || !dirty || initialLoading) return
    const t = setTimeout(() => saveRef.current(saved.name, { quiet: true }), 1500)
    return () => clearTimeout(t)
  }, [autosave, saved, dirty, initialLoading, layoutRev, known, visible, itemizedIds, hiddenLinks, traced])

  // Warn before leaving a case with changes that auto-save won't catch
  useEffect(() => {
    if (!dirty || !saved || autosave) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, saved, autosave])

  // Plain-English summary (Pro): kept for this session so the report can include it
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  useEffect(() => setSummary(null), [traced])

  const openReport = (withSummary = summary) => {
    if (!originChain) return
    const html = buildReport({ origin: originKey, chain: originChain, nodes: nodeMap, edges: graphEdges, traced, traceEnds, nameOf, payments, summary: withSummary ?? undefined })
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const exportPng = async () => {
    const data = await graphApi.current?.exportPng().catch(() => null)
    if (data) downloadDataUrl(`${fileBase}.png`, data)
    else flash('Could not render the graph image')
  }

  // ── Inspector ────────────────────────────────────────────────────────────
  const inspector = (() => {
    if (selection?.kind === 'address' && selectedNode) {
      const a = selectedNode.address
      return (
        <AddressInspector
          // Filters, searches, paging and the label editor belong to one address
          key={a}
          attester={attester}
          node={selectedNode}
          prices={prices}
          page={pages.get(a)}
          loading={loadingAddrs.has(a)}
          loadingMore={loadingMore}
          counterparties={selectedCounterparties}
          summary={flowSummary(a, allEdges)}
          onOpenRelationship={other => {
            if (!visible.has(other)) {
              snapshot()
              showOnGraph([other])
            }
            // Opening a relationship on purpose brings its link back if it was hidden
            setHiddenLinks(prev => {
              if (!prev.has(pairKey(a, other))) return prev
              const next = new Set(prev)
              next.delete(pairKey(a, other))
              return next
            })
            setSelection({ kind: 'flow', from: a, to: other })
          }}
          onShowTx={tx => {
            // Draw this transaction's legs that touch the address as individual lines
            const legs = perTx.filter(e => e.txid === tx.txid && e.asset === tx.asset && (e.source === a || e.target === a))
            if (!legs.length) return
            addToGraph(legs.map(e => (e.source === a ? e.target : e.source)))
            setItemizedIds(prev => new Set([...prev, ...legs.map(e => e.id)]))
          }}
          onGraph={visible}
          tracedTxids={tracedTxids}
          tab={tab}
          canRemove={a !== originAddress}
          tracing={!!traceStatus}
          cluster={clusters.byAddress.get(a)}
          nameOf={nameOf}
          labelOf={labelOf}
          onTab={setTab}
          onAdd={addToGraph}
          onOpen={openAddress}
          onTraceTx={(tx, dir) => runFollow(dir, dir === 'forward' ? seedsFromTx(tx, a, undefined, follow.adaptive) : backSeedsFromTx(tx, a))}
          onRemove={() => removeNode(a)}
          editLabel={labelFor === a}
          onEditLabelShown={() => setLabelFor(null)}
          onLoadMore={loadMore}
          wide={panelWide}
          bulk={bulk?.addr === a ? bulk : null}
          bulkBusy={!!bulk && bulk.addr !== a}
          onLoadAll={() => loadAllFor(a)}
          onCancelBulk={() => { bulkCancel.current = true }}
          onLookupAddress={async other => {
            if (!(await ensurePage(other))) throw new Error('lookup failed')
          }}
          myLabel={myLabelOf(a)}
          baseLabel={known.get(a)?.label ?? btcLabels.current.get(a)}
          onSaveLabel={l => setMyLabel(selectedNode.chain, a, l)}
          onNote={note => {
            const n = knownRef.current.get(a)
            if (n) setKnownNow(new Map(knownRef.current).set(a, { ...n, note: note.trim() || undefined }))
          }}
          onShowCluster={() => {
            const c = clusters.byAddress.get(a)
            if (c) addToGraph(c.members)
          }}
        />
      )
    }
    if (selection?.kind === 'flow') {
      return (
        <EdgeDetail
          key={pairKey(selection.from, selection.to)}
          a={selection.from}
          b={selection.to}
          chain={originChain ?? 'btc'}
          rows={edgeRows}
          itemized={itemizedIds}
          initialTab={edgeRows.some(r => itemizedIds.has(r.id)) ? 'transactions' : 'relationship'}
          {...pairHistory(selection.from, selection.to)}
          loadingMore={loadingMore}
          onToggleItem={id => setItemizedIds(prev => {
            const n = new Set(prev)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            return n
          })}
          onItemize={ids => setItemizedIds(prev => {
            const n = new Set(prev)
            for (const r of edgeRows) n.delete(r.id)
            for (const id of ids ?? []) n.add(id)
            return n
          })}
          traced={traced.filter(f => (f.from === selection.from && f.to === selection.to) || (f.from === selection.to && f.to === selection.from))}
          prices={prices}
          busy={!!traceStatus}
          nameOf={nameOf}
          onSelect={openAddress}
          onTraceForward={row => {
            const tx = txForRow(row)
            if (tx) runFollow('forward', seedsFromTx(tx, row.source, row.target))
            else flash('Transaction not loaded')
          }}
          onTraceBack={row => {
            const tx = txForRow(row)
            if (tx) runFollow('backward', backSeedsFromTx(tx, row.target, row.source))
            else flash('Transaction not loaded')
          }}
          onClose={() => setSelection(null)}
          onHide={() => hideLink(selection.from, selection.to)}
          onRemoveTraced={removeTraced}
          extra={(() => {
            // Swaps: a transaction on this link paid the sender a different asset back (DEX, UniswapX, 1inch…)
            const swaps = edgeRows.flatMap(r => {
              const back = allTxs.filter(t => (r.txids ?? [r.txid]).includes(t.txid) && t.outputs.some(o => o.address === r.source) &&
                t.inputs[0]?.address !== r.source && t.asset !== r.asset && !t.asset.endsWith('*') && (t.outputs[0]?.amount ?? 0) > 0)
              return back.length ? [{ row: r, back }] : []
            })
            const swapNote = swaps.length > 0 && (
              <div className="border border-violet-500/50 bg-violet-500/5 p-3 space-y-1.5 text-[11px] mb-2">
                <div className="flex items-center gap-1.5 font-medium text-fg"><Repeat size={12} className="text-violet-400" /> Swap in one transaction</div>
                {swaps.map(({ row, back }) => (
                  <div key={row.id} className="text-muted">
                    <span className="text-fg">{nameOf(row.source) ?? truncate(row.source, 6)}</span> sold <b className="font-mono text-fg">{fmtCompact(row.amount, row.asset)}</b> and got{' '}
                    <b className="font-mono text-fg">{back.map(t => fmtCompact(t.outputs[0].amount, t.asset)).join(' + ')}</b> back
                    {' '}(from {back.map(t => nameOf(t.inputs[0].address) ?? truncate(t.inputs[0].address, 5)).join(', ')}) · {fmtDay(row.timestamp)}
                  </div>
                ))}
                <p className="text-faint">Follow the funds carries on with what came back.</p>
              </div>
            )
            // A link into a cross-chain swap service: ask the service where the money came out
            const isBridge = (a: string) => BRIDGE_NAME.test(nameOf(a) ?? '')
            const bridge = isBridge(selection.to) ? selection.to : isBridge(selection.from) ? selection.from : null
            if (!bridge) return swapNote || undefined
            const sender = bridge === selection.to ? selection.from : selection.to
            const into = edgeRows.filter(r => r.source === sender && r.target === bridge)
            const txids = into.flatMap(r => r.txids ?? [r.txid])
            if (!txids.length) return swapNote || undefined
            const txTimes = Object.fromEntries(into.flatMap(r => (r.txids ?? [r.txid]).map(t => [t, r.timestamp])))
            return (
              <>
              {swapNote}
              <BridgeHops sender={sender} service={lookupService(nameOf(bridge) ?? '') ?? 'Bridgers'} txids={txids} txTimes={txTimes} added={new Set(bridgeHops.map(h => h.orderId))}
                onAdd={(hop, matched) => {
                  snapshot()
                  // This link's own swaps leave from the service's node; the wallet's other swaps
                  // (e.g. from another chain) are drawn from the wallet itself
                  setBridgeHops(prev => (prev.some(h => h.orderId === hop.orderId) ? prev : [...prev, { ...hop, via: matched ? bridge : sender, sender, bridge }]))
                  showOnGraph([hop.toAddress])
                  flash(`Added ${chainDisplay(hop.toChainName)} destination ${truncate(hop.toAddress, 6)}. Open it to keep tracing there.`)
                }}
                onRemove={orderId => {
                  snapshot()
                  setBridgeHops(prev => prev.filter(h => h.orderId !== orderId))
                }} />
              </>
            )
          })()}
        />
      )
    }
    if (selection?.kind === 'tx' && hubs.get(selection.id)) {
      return (
        <TxInspector
          lookup={hubs.get(selection.id)!}
          onGraph={visible}
          tracing={!!traceStatus}
          nameOf={nameOf}
          labelOf={labelOf}
          onAdd={addToGraph}
          onOpen={openAddress}
          onTraceOut={traceTxOut}
          onSourceIn={traceTxIn}
        />
      )
    }
    return (
      <div className="p-6 text-[12px] text-muted leading-relaxed space-y-3">
        <MousePointerClick size={18} className="text-faint" />
        <p>Click an <b className="text-fg font-medium">address</b> to see who it paid and was paid by, and add them to the graph.</p>
        <p>Click a <b className="text-fg font-medium">line</b> to see the payments behind it and trace any of them.</p>
      </div>
    )
  })()

  const originNode = originAddress ? known.get(originAddress) : undefined

  return (
    <PricingContext.Provider value={pricing}>
    <div className="h-screen flex flex-col overflow-hidden bg-bg">
      {/* Header */}
      {/* Phones: the search drops to its own row and the buttons wrap instead of running off-screen */}
      <header className="flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-2 min-h-14 py-2 md:py-0 md:h-14 px-3 sm:px-4 border-b border-line flex-shrink-0">
        <Link href="/" className="text-faint hover:text-fg p-1.5" aria-label="Home"><ArrowLeft size={16} /></Link>
        <Link href="/" className="hidden xl:block text-[13px] font-medium tracking-[0.24em] text-fg pr-3 border-r border-line">ASHIATO</Link>
        <button
          onClick={() => setSelection(originTx ? { kind: 'tx', id: originTx } : { kind: 'address', id: originAddress })}
          className="flex items-center gap-2 min-w-0 max-w-[140px] sm:max-w-[260px] text-left hover:text-accent"
          title="Show the starting point"
        >
          {originChain && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${chainDot(originChain)}`} />}
          <span className="text-[10px] uppercase tracking-wider text-faint flex-shrink-0">{originTx ? 'tx' : originChain}</span>
          <span className="text-xs text-fg truncate font-mono">{originNode?.label?.name ?? originNode?.ens ?? truncate(originKey, 8)}</span>
        </button>
        <div className="order-last basis-full md:order-none md:basis-auto flex-1 flex justify-center min-w-0 md:px-2">
          <SearchForm compact onAddAddress={originChain ? a => {
            openAddress(a)
            flash(`Added ${truncate(a, 6)} to this case`)
          } : undefined} />
        </div>
        <div className="ml-auto flex flex-wrap justify-end items-center gap-2.5 text-xs text-faint md:flex-shrink-0">
          {traceStatus && (
            <span className="flex items-center gap-2 text-accent">
              <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="hidden 2xl:inline">{traceStatus}</span>
              <button onClick={() => (traceCancel.current = true)} className="text-faint hover:text-fg" aria-label="Stop trace"><X size={12} /></button>
            </span>
          )}
          {(collapsed.chains.length > 0 || expandedChains.size > 0 || !collapseOn) && traced.length > 0 && (
            <button
              onClick={() => { setQuietRev(v => v + 1); setCollapseOn(v => !v); setExpandedChains(new Set()); setPinned(new Set()) }}
              title={collapseOn ? 'Show every hop of long chains' : 'Draw long pass-through chains as one line'}
              className={`h-7 px-2.5 border border-line text-[11px] font-medium ${collapseOn ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'}`}
            >
              {collapseOn ? `Chains collapsed${collapsed.chains.length ? ` (${collapsed.chains.length})` : ''}` : 'Collapse chains'}
            </button>
          )}
          <span className="hidden xl:block whitespace-nowrap">{graphNodes.length} addresses</span>
          <button onClick={undo} disabled={!history.length} className="flex items-center gap-1 hover:text-fg disabled:opacity-30 p-1" title="Undo" aria-label="Undo">
            <Undo2 size={14} />{history.length > 0 && <span className="text-[10px]">{history.length}</span>}
          </button>
          <button onClick={loadOrigin} className="hover:text-fg p-1" title="Start over"><RefreshCw size={14} /></button>
          {!initialLoading && !error && (
            <SaveChartButton
              savedName={saved?.name}
              defaultName={`${nameOf(originKey) ?? truncate(originKey, 6)} · ${new Date().toLocaleDateString('en-NZ')}`}
              status={saving ? 'saving' : !saved ? 'new' : dirty ? 'dirty' : 'saved'}
              lastSavedAt={lastSavedAt}
              autosave={autosave}
              onAutosave={setAutosave}
              onSave={(name, asNew) => saveChart(name, { asNew })}
            />
          )}
          <ExportMenu
            onSaveCase={saveCaseFile}
            onLoadCase={loadCaseFile}
            onReport={() => openReport()}
            onSummary={() => setSummaryOpen(true)}
            onPng={exportPng}
            onCsv={() => download(`${fileBase}.flows.csv`, flowsToCsv(nodeMap, graphEdges), 'text/csv')}
            onGraphml={() => download(`${fileBase}.graphml`, toGraphml(graphNodes, graphEdges), 'application/xml')}
          />
          <AccountButton compact />
          <AlertsBell />
          <SettingsButton />
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden min-h-0">
        {!initialLoading && !error && (
          <CasePanel
            collapsed={caseCollapsed}
            onToggle={() => setCaseCollapsed(c => {
              try { localStorage.setItem('ashiato.caseOpen', c ? '1' : '0') } catch { /* storage blocked */ }
              return !c
            })}
            legendTypes={legendTypes}
            follow={follow}
            onFollow={setFollow}
            traced={traced}
            traceEnds={displayEnds}
            onClearTrace={() => { snapshot(); setTraced([]); setTraceEnds([]) }}
            clusters={clusters.clusters}
            tornadoLinks={tornado}
            labelOf={labelOf}
            nameOf={nameOf}
            onSelect={openAddress}
          />
        )}

        <main className="flex-1 relative overflow-hidden min-w-0">
          {initialLoading && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <div className="text-muted text-sm">Loading…</div>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 grid place-items-center p-6">
              <div className="max-w-md border border-red-500/40 bg-red-500/5 p-5 text-sm">
                <div className="font-medium text-red-500 mb-1">Couldn&apos;t load this {originTx ? 'transaction' : 'address'}</div>
                <p className="text-muted leading-relaxed">{error}</p>
                <div className="mt-4 flex gap-2">
                  <button onClick={loadOrigin} className="h-8 px-3 text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg">Retry</button>
                  <Link href="/" className="h-8 px-3 grid place-items-center text-xs font-medium bg-raised hover:bg-line text-fg">New search</Link>
                </div>
              </div>
            </div>
          )}

          {!initialLoading && !error && (graphNodes.length > 0 || graphHubs.length > 0) && (
            <TraceGraph
              key={`case-${caseRev}`}
              nodes={drawn?.nodes ?? graphNodes}
              edges={drawn?.edges ?? graphEdges}
              followedPairs={followedPairs}
              traced={drawn?.traced ?? graphTraced}
              chains={collapsed.chains}
              onChainClick={id => { setQuietRev(v => v + 1); setExpandedChains(prev => new Set(prev).add(id)) }}
              quietKey={quietRev}
              hubs={graphHubs}
              bridges={graphBridges}
              onBridgeClick={id => {
                // Reopen the link the swap was found on, where it can be removed
                const ids = id.split('+')
                const h = bridgeHops.find(x => ids.includes(x.orderId))
                if (!h) return
                // Swaps added before this was recorded: work out the wallet and the service node
                const sender = h.sender ?? (h.fromAddress.startsWith('0x') ? h.fromAddress.toLowerCase() : h.fromAddress)
                const bridge = h.bridge ?? (BRIDGE_NAME.test(nameOf(h.via) ?? '') ? h.via
                  : [...visible].find(a => BRIDGE_NAME.test(nameOf(a) ?? '') && allEdges.some(e => e.source === sender && e.target === a)))
                if (bridge && visible.has(sender)) setSelection({ kind: 'flow', from: sender, to: bridge })
                else if (confirm('Remove this cross-chain line from the graph?')) {
                  snapshot()
                  setBridgeHops(prev => prev.filter(x => !ids.includes(x.orderId)))
                }
              }}
              itemized={itemizedEdges}
              prices={prices}
              selected={selectedAddress}
              selectedEdge={selection?.kind === 'flow' ? pairKey(selection.from, selection.to) : null}
              selectedHub={selection?.kind === 'tx' ? selection.id : null}
              // A click shows the node's quick actions; the side panel follows along only if it's already on an address
              onNodeClick={a => { if (selection?.kind === 'address') openAddress(a) }}
              onNodeAction={nodeAction}
              watched={watched}
              annotations={annotations}
              onAnnotations={setAnnotations}
              onEdgeClick={selectFlow}
              onHubClick={txid => setSelection({ kind: 'tx', id: txid })}
              onPaneClick={() => setSelection(null)}
              positions={positionsRef.current}
              onLayoutChange={() => setLayoutRev(v => v + 1)}
              onReady={api => (graphApi.current = api)}
            />
          )}

          {!initialLoading && !error && graphNodes.length === 1 && hubs.size === 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-10 bg-panel border border-line px-4 py-2.5 text-[12px] text-muted">
              Click the address, then add counterparties from <b className="text-fg font-medium">Relationships</b> with <b className="text-fg font-medium">+</b>. To follow money, open a transaction and press <b className="text-fg font-medium">Trace</b>. Click empty space to hide the panel.
            </div>
          )}

          {hiddenLinks.size > 0 && !initialLoading && !error && (
            <div className="absolute left-4 top-4 z-10 flex items-center gap-2 bg-panel border border-line px-3 h-8 text-[11px] text-muted">
              <EyeOff size={12} /> {hiddenLinks.size} hidden link{hiddenLinks.size === 1 ? '' : 's'}
              <button onClick={() => setHiddenLinks(new Set())} className="font-medium text-fg underline underline-offset-2 hover:text-accent">Show all</button>
            </div>
          )}

          {summaryOpen && originChain && (
            <SummaryDialog
              facts={summaryFacts({ chain: originChain, origin: originKey, nodes: nodeMap, edges: graphEdges, traced, ends: traceEnds, nameOf })}
              summary={summary}
              onSummary={setSummary}
              onReport={() => openReport()}
              onClose={() => setSummaryOpen(false)}
            />
          )}

          {paymentsOpen && (
            <ClientPaymentsDialog
              payments={payments}
              checking={checking}
              tracing={!!traceStatus}
              nameOf={nameOf}
              onCheck={checkPayments}
              onTraceAll={traceAllPayments}
              onRemove={id => setPayments(prev => prev.filter(x => x.id !== id))}
              onChoose={(rowId, m) => setPayments(prev => choosePayment(prev, rowId, m, `${Date.now().toString(36)}c`))}
              onShow={x => {
                if (!x.match) return
                showOnGraph([x.match.from, x.match.to].filter(Boolean))
                setPaymentsOpen(false)
                setSelection({ kind: 'flow', from: x.match.from, to: x.match.to })
              }}
              onClose={() => setPaymentsOpen(false)}
            />
          )}

          {toast && (
            <div className="absolute left-1/2 -translate-x-1/2 top-4 z-30 bg-panel border border-line px-4 py-2 text-xs text-fg shadow-xl">{toast}</div>
          )}
        </main>

        {!initialLoading && !error && (
          <aside
            data-panel="inspector"
            aria-hidden={!selection}
            className={clsx(
              'relative flex-shrink-0 bg-bg overflow-hidden',
              // Phones: an open panel covers the graph (full width) rather than squeezing it
              selection && 'max-md:absolute max-md:inset-0 max-md:z-30 max-md:!w-full',
              !resizing && 'transition-[width] duration-200 ease-out',
              selection && 'border-l border-line'
            )}
            style={{ width: selection ? panelCss : 0 }}
          >
            {selection && (
              <>
                {/* Drag to resize; the grip toggles a wide, table-style view */}
                <div
                  onMouseDown={startResize}
                  onDoubleClick={() => setPanelExpanded(v => !v)}
                  className="absolute left-0 top-0 h-full w-1.5 z-20 cursor-col-resize hover:bg-accent/40"
                  title="Drag to resize · double-click to expand"
                />
                <button
                  onClick={() => setPanelExpanded(v => !v)}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-30 grid place-items-center w-3 h-12 bg-panel border border-l-0 border-line text-faint hover:text-fg hover:border-accent"
                  title={panelExpanded ? 'Shrink the panel' : 'Expand the panel (bigger transaction and relationship tables)'}
                  aria-label={panelExpanded ? 'Shrink panel' : 'Expand panel'}
                >
                  {panelExpanded ? <ChevronsRight size={12} /> : <ChevronsLeft size={12} />}
                </button>
                {/* Fixed inner width so content doesn't reflow while the panel slides */}
                <div className="h-full flex flex-col min-h-0 max-md:!w-full" style={{ width: panelCss }}>{inspector}</div>
                <button onClick={() => setSelection(null)} aria-label="Back to the graph"
                  className="md:hidden absolute top-2 right-2 z-40 grid place-items-center w-8 h-8 bg-panel border border-line text-muted hover:text-fg">
                  <X size={16} />
                </button>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
    </PricingContext.Provider>
  )
}

export default function TracePage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen grid place-items-center bg-bg">
          <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <TracePageInner />
    </Suspense>
  )
}
