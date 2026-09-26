'use client'

import { clsx } from 'clsx'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Undo2, X, MousePointerClick, EyeOff, ChevronsLeft, ChevronsRight, Repeat } from 'lucide-react'
import { Chain, EdgeData, EntityLabel, EntityType, NodeData, RawTransaction, TraceResult, TxIO, TxLookup, transferKey } from '@/lib/types'
import { normaliseAddress, detectChain, truncate } from '@/lib/detect-chain'
import { aggregateEdges, txEdges } from '@/lib/graph'
import { counterparties as findCounterparties, flowSummary } from '@/lib/counterparties'
import { clusterAddresses } from '@/lib/heuristics/cluster'
import { tornadoLinks as findTornadoLinks } from '@/lib/heuristics/eth/tornado'
import { runTaint, TaintMethod } from '@/lib/taint'
import { BtcTxInfo, Direction, followFunds, Lot, seedsFromTx, backSeedsFromTx, TracedFlow, TraceEnd } from '@/lib/follow'
import { saveCase as saveChartToBrowser, getCase as getSavedChart, newCaseId } from '@/lib/saved-cases'
import { collapseChains } from '@/lib/collapse'
import { CheckedPayment, PaymentMatch, choosePayment, judgePayment, parseClientPayments, seedsFromPayments, transfersOf } from '@/lib/client-payments'
import ClientPaymentsDialog from '@/components/ClientPayments'
import { useMyLabels, myLabelKey, toEntityLabel } from '@/lib/my-labels'
import { CASE_VERSION, CaseFile, LoadedPage, download, downloadDataUrl, flowsToCsv, parseCase, toGraphml } from '@/lib/export'
import { buildReport } from '@/lib/report'
import { ENTITY_STYLE, nativeAsset, chainDot, fmtCompact, fmtDay } from '@/lib/format'
import AddressInspector, { AddressTab } from '@/components/AddressInspector'
import TxInspector from '@/components/TxInspector'
import EdgeDetail from '@/components/EdgeDetail'
import CasePanel, { FollowSettings } from '@/components/CasePanel'
import SaveChartButton from '@/components/SaveChartButton'
import ExportMenu from '@/components/ExportMenu'
import SearchForm from '@/components/SearchForm'
import ThemeToggle from '@/components/ThemeToggle'
import { AccountButton } from '@/components/SignIn'
import type { Attester } from '@/components/CommunityLabels'
import { usePublicClient, useSwitchChain, useWalletClient } from 'wagmi'
import { attestLabel, revokeAttestation, voteOnLabel, walletChainId } from '@/lib/attest/write'
import { ATTEST_CHAIN, SCHEMA_UID } from '@/lib/attest/config'
import BridgeHops from '@/components/BridgeHops'
import { BRIDGE_NAME, CrossChainHop, chainDisplay } from '@/lib/bridges/types'
import type { GraphApi, XY } from '@/components/TraceGraph'
import type { AddressNodeData, TxHubData } from '@/components/AddressNode'

const TraceGraph = dynamic(() => import('@/components/TraceGraph'), { ssr: false })

type TaintCfg = { seed: string; method: TaintMethod; asset: string }
type Selection = { kind: 'address'; id: string } | { kind: 'flow'; from: string; to: string } | { kind: 'tx'; id: string } | null

interface Snapshot {
  visible: Set<string>
  followedPairs: Set<string>
  traced: TracedFlow[]
  traceEnds: TraceEnd[]
}

/** Trails end at cash-out points and mixers */
const STOP_AT: EntityType[] = ['exchange', 'deposit', 'mixer', 'coinjoin', 'sanctioned', 'defi']
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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body as T
}

const fetchTrace = (address: string, chain: Chain, cursor?: string) =>
  getJson<TraceResult>(`/api/${chain}/${encodeURIComponent(address)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)

/** Normalises the BTC and ETH transaction endpoints into one shape */
async function fetchTxLookup(txid: string, chain: Chain): Promise<TxLookup> {
  if (chain === 'eth' || chain === 'tron') return getJson<TxLookup>(`/api/tx/${chain}/${txid}`)
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

function TracePageInner() {
  const params = useSearchParams()
  const router = useRouter()

  // The connected wallet signs community labels and votes (on Sepolia)
  const { data: walletClient } = useWalletClient()
  const attestClient = usePublicClient({ chainId: ATTEST_CHAIN.id })
  const { switchChainAsync } = useSwitchChain()
  const attester = useMemo<Attester | undefined>(() => {
    if (!walletClient || !attestClient) return undefined
    const onSepolia = async () => {
      if ((await walletChainId(walletClient)) !== ATTEST_CHAIN.id) await switchChainAsync({ chainId: ATTEST_CHAIN.id })
    }
    return {
      address: walletClient.account.address.toLowerCase(),
      label: async l => { await onSepolia(); return attestLabel(walletClient, attestClient, l) },
      vote: async (uid, v) => { await onSepolia(); return voteOnLabel(walletClient, attestClient, uid, v) },
      revoke: async uid => { await onSepolia(); return revokeAttestation(walletClient, attestClient, SCHEMA_UID.label, uid) },
    }
  }, [walletClient, attestClient, switchChainAsync])
  const rawAddress = params.get('address') ?? ''
  const originTx = (params.get('tx') ?? '').toLowerCase()
  const chainParam = params.get('chain') as Chain | null
  const originChain: Chain | null = chainParam === 'btc' || chainParam === 'eth' || chainParam === 'tron' ? chainParam : originTx ? (originTx.startsWith('0x') ? 'eth' : 'btc') : detectChain(rawAddress)
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
  const [traced, setTraced] = useState<TracedFlow[]>([])
  const [traceEnds, setTraceEnds] = useState<TraceEnd[]>([])
  const [history, setHistory] = useState<Snapshot[]>([])

  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [loadingAddrs, setLoadingAddrs] = useState<Set<string>>(new Set())
  const [loadingMore, setLoadingMore] = useState(false)

  const [selection, setSelection] = useState<Selection>(null)
  const [tab, setTab] = useState<AddressTab>('counterparties')
  const [caseCollapsed, setCaseCollapsed] = useState(false)

  const [taint, setTaint] = useState<TaintCfg | null>(null)
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
  const panelWide = panelExpanded || panelW >= 680
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

  const [prices, setPrices] = useState<Record<string, number>>({})
  useEffect(() => {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,tron&vs_currencies=nzd')
      .then(r => r.json())
      .then(d => setPrices({ BTC: d.bitcoin?.nzd ?? 0, ETH: d.ethereum?.nzd ?? 0, WETH: d.ethereum?.nzd ?? 0, TRX: d.tron?.nzd ?? 0, USD: d.tether?.nzd ?? 0 }))
      .catch(() => {})
  }, [])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 5000)
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
          txCount: n.txCount,
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

  const resetState = () => {
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
    setPinned(new Set())
    setPayments([])
    setBridgeHops([])
    setTraced([])
    setTraceEnds([])
    setHistory([])
    setSelection(null)
    setTaint(null)
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
    try {
      if (originTx) {
        // A bare 64-hex hash is Bitcoin or Tron; try Tron when Bitcoin has no such tx
        let l: TxLookup
        try {
          l = await fetchTxLookup(originTx, originChain)
        } catch (e) {
          if (originChain !== 'btc') throw e
          l = await fetchTxLookup(originTx, 'tron').catch(() => { throw e })
          restoring.current = urlKey(`/trace?tx=${originTx}&chain=tron`)
          router.replace(`/trace?tx=${originTx}&chain=tron`)
        }
        absorbTx(l)
        const { inputs, outputs } = txParticipants(l)
        setVisible(new Set([...inputs.slice(0, TX_PARTICIPANTS), ...outputs.slice(0, TX_PARTICIPANTS)]))
        setSelection({ kind: 'tx', id: l.txid })
      } else {
        const r = await fetchTrace(originAddress, originChain)
        // Start with just the address; the user adds counterparties from the panel
        absorb(r, [r.address])
        setSelection({ kind: 'address', id: r.address })
        setTab('counterparties')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setInitialLoading(false)
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
    if (have) return have
    setBusy(addr, true)
    try {
      absorb(await fetchTrace(addr, knownRef.current.get(addr)?.chain ?? originChain ?? 'btc'), [])
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
    try {
      let page = pagesRef.current.get(addr)
      setBulk({ addr, loaded: page?.rawTxs.length ?? 0, total })
      while (page?.nextCursor && !bulkCancel.current) {
        absorb(await fetchTrace(addr, chain, page.nextCursor), [], true)
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
    let page = pagesRef.current.get(addr) ?? (await ensurePage(addr))
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
          for (const ch of chains) {
            try {
              found = transfersOf((await fetchTxLookup(c.txid, ch)).transfers)
              break
            } catch { /* try the next chain */ }
          }
          result = found ? judgePayment(c, found, id) : { id, claim: c, status: 'not-found', notes: ['Transaction not found'] }
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
    const before = traced
    const show = (flows: TracedFlow[]) => {
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
          setTraceStatus(msg)
          show([...seed.flows, ...partial.flows])
        },
        () => traceCancel.current
      )
      const flows = [...seed.flows, ...res.flows].filter(f => f.from && f.to)
      show(flows)
      // Addresses the trail stopped at belong on the graph; peeled-off payments and minor
      // splits were deliberately not followed, so they stay in the side list only
      showOnGraph(res.ends.filter(e => !OFF_TRAIL.includes(e.reason)).map(e => e.address))
      setTraceEnds(prev => mergeEnds([...prev, ...(seed.ends ?? []), ...res.ends]))
      const cashOut = res.ends.filter(e => e.reason === 'entity').length
      flash(`Traced ${flows.length} hop${flows.length === 1 ? '' : 's'}${cashOut ? ` · reached ${cashOut} exchange/mixer/sanctioned endpoint${cashOut === 1 ? '' : 's'}` : ''}`)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Trace failed')
    } finally {
      setTraceStatus(null)
    }
  }

  /** Transaction-level: follow one output (or all) onward */
  const traceTxOut = (tx: RawTransaction, to?: string) => {
    const from = tx.chain === 'eth' ? tx.inputs[0]?.address ?? '' : ''
    runFollow('forward', seedsFromTx(tx, from, to, follow.adaptive))
  }

  /** Transaction-level: walk one input (or all) back to its source */
  const traceTxIn = (tx: RawTransaction, input?: TxIO) => {
    if (tx.chain === 'eth') {
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

  const taintAssets = useMemo(() => [...new Set(allTxs.map(t => t.asset))].sort(), [allTxs])
  const taintResult = useMemo(() => (taint ? runTaint(allTxs, [taint.seed], taint.method, taint.asset) : null), [taint, allTxs])

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
        taint: taintResult?.byAddress.get(a)?.received,
        view: {
          clusterSize: cluster?.members.length,
          taintAsset: taint?.asset,
          isTaintSeed: taint?.seed === a,
          loading: loadingAddrs.has(a),
          pooled: pooledAt.get(a),
        },
      }]
    })
  }, [visible, known, clusters, taintResult, taint, loadingAddrs, originAddress, displayEnds, mine])

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
    const keep = new Set<string>([originAddress, selectedAddress ?? '', ...pinned].filter(Boolean))
    for (const n of graphNodes) if (n.label || n.note || n.view.isTaintSeed) keep.add(n.address)
    return collapseChains({ nodes: graphNodes.map(n => n.address), edges: graphEdges, traced: graphTraced, keep, expanded: expandedChains })
  }, [collapseOn, graphNodes, graphEdges, graphTraced, expandedChains, originAddress, selectedAddress, pinned])
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
  const layoutKey = 'fixed'
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

  // Delete / Backspace hides the selected link
  useEffect(() => {
    if (selection?.kind !== 'flow') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) {
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
          taint,
          positions: Object.fromEntries([...positionsRef.current].filter(([a]) => visible.has(a) || hubs.has(a.replace(/^tx:/, '')))),
          itemizedIds: [...itemizedIds],
          hiddenLinks: [...hiddenLinks],
          clientPayments: payments,
          bridgeHops,
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
    setTraced(uniqueFlows(c.traced ?? []))
    setTraceEnds(mergeEnds(c.traceEnds ?? []))
    setTaint(c.taint ?? null)
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

  // Anything that changes the case marks it unsaved; auto-save writes it 1.5 s after the last change
  const [layoutRev, setLayoutRev] = useState(0)
  useEffect(() => {
    if (skipChange.current) {
      skipChange.current = false
      return
    }
    changeCount.current++
    setDirty(true)
  }, [known, visible, pages, hubs, followedPairs, itemizedIds, hiddenLinks, payments, traced, traceEnds, taint, layoutRev, myLabels, bridgeHops])
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

  const openReport = () => {
    if (!originChain) return
    const html = buildReport({ origin: originKey, chain: originChain, nodes: nodeMap, edges: graphEdges, taint: taintResult, traced, traceEnds, nameOf, payments })
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
          tab={tab}
          canRemove={a !== originAddress}
          tracing={!!traceStatus}
          cluster={clusters.byAddress.get(a)}
          taint={taint ? { amount: taintResult?.byAddress.get(a)?.received ?? 0, asset: taint.asset, isSeed: taint.seed === a } : undefined}
          nameOf={nameOf}
          labelOf={labelOf}
          onTab={setTab}
          onAdd={addToGraph}
          onOpen={openAddress}
          onTraceTx={(tx, dir) => runFollow(dir, dir === 'forward' ? seedsFromTx(tx, a, undefined, follow.adaptive) : backSeedsFromTx(tx, a))}
          onTaint={() => {
            setTaint(t => ({ seed: a, method: t?.method ?? 'haircut', asset: nativeAsset(selectedNode.chain) }))
            ensurePage(a)
          }}
          onRemove={() => removeNode(a)}
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
            if (!txids.length) return undefined
            const txTimes = Object.fromEntries(into.flatMap(r => (r.txids ?? [r.txid]).map(t => [t, r.timestamp])))
            return (
              <>
              {swapNote}
              <BridgeHops sender={sender} serviceName={(nameOf(bridge) ?? 'Bridgers').replace(/\s*[(:].*$/, '')} txids={txids} txTimes={txTimes} added={new Set(bridgeHops.map(h => h.orderId))}
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
    <div className="h-screen flex flex-col overflow-hidden bg-bg">
      {/* Header */}
      <header className="flex items-center gap-3 h-14 px-3 sm:px-4 border-b border-line flex-shrink-0">
        <Link href="/" className="text-faint hover:text-fg p-1.5" aria-label="Home"><ArrowLeft size={16} /></Link>
        <Link href="/" className="hidden xl:block text-[13px] font-medium tracking-[0.24em] text-fg pr-3 border-r border-line">ASHIATO</Link>
        <button
          onClick={() => setSelection(originTx ? { kind: 'tx', id: originTx } : { kind: 'address', id: originAddress })}
          className="flex items-center gap-2 min-w-0 max-w-[260px] text-left hover:text-accent"
          title="Show the starting point"
        >
          {originChain && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${chainDot(originChain)}`} />}
          <span className="text-[10px] uppercase tracking-wider text-faint flex-shrink-0">{originTx ? 'tx' : originChain}</span>
          <span className="text-xs text-fg truncate font-mono">{originNode?.label?.name ?? originNode?.ens ?? truncate(originKey, 8)}</span>
        </button>
        <div className="flex-1 flex justify-center min-w-0 px-2">
          <SearchForm compact onAddAddress={originChain ? a => {
            openAddress(a)
            flash(`Added ${truncate(a, 6)} to this case`)
          } : undefined} />
        </div>
        <div className="flex items-center gap-2.5 text-xs text-faint flex-shrink-0">
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
          <span className="hidden lg:block whitespace-nowrap">{graphNodes.length} addresses</span>
          <button onClick={undo} disabled={!history.length} className="flex items-center gap-1 hover:text-fg disabled:opacity-30 p-1" title="Undo">
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
            onReport={openReport}
            onPng={exportPng}
            onCsv={() => download(`${fileBase}.flows.csv`, flowsToCsv(nodeMap, graphEdges, taintResult?.byEdge), 'text/csv')}
            onGraphml={() => download(`${fileBase}.graphml`, toGraphml(graphNodes, graphEdges), 'application/xml')}
          />
          <AccountButton compact />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {!initialLoading && !error && (
          <CasePanel
            payments={payments}
            onOpenPayments={() => setPaymentsOpen(true)}
            collapsed={caseCollapsed}
            onToggle={() => setCaseCollapsed(c => !c)}
            legendTypes={legendTypes}
            follow={follow}
            onFollow={setFollow}
            traced={traced}
            traceEnds={displayEnds}
            onClearTrace={() => { snapshot(); setTraced([]); setTraceEnds([]) }}
            taint={taint}
            taintResult={taintResult}
            taintAssets={taintAssets}
            onTaintMethod={m => setTaint(t => (t ? { ...t, method: m } : t))}
            onTaintAsset={a => setTaint(t => (t ? { ...t, asset: a } : t))}
            onTaintClear={() => setTaint(null)}
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
              nodes={drawn?.nodes ?? graphNodes}
              edges={drawn?.edges ?? graphEdges}
              followedPairs={followedPairs}
              traced={drawn?.traced ?? graphTraced}
              chains={collapsed.chains}
              onChainClick={id => { setQuietRev(v => v + 1); setExpandedChains(prev => new Set(prev).add(id)) }}
              layoutKey={layoutKey}
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
              taintByEdge={taintResult?.byEdge}
              selected={selectedAddress}
              selectedEdge={selection?.kind === 'flow' ? `${selection.from}->${selection.to}` : null}
              selectedHub={selection?.kind === 'tx' ? selection.id : null}
              onNodeClick={openAddress}
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
            aria-hidden={!selection}
            className={clsx(
              'relative flex-shrink-0 bg-bg overflow-hidden',
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
                <div className="h-full flex flex-col min-h-0" style={{ width: panelCss }}>{inspector}</div>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
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
