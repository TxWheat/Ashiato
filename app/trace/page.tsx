'use client'

import { clsx } from 'clsx'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Undo2, X, MousePointerClick, EyeOff } from 'lucide-react'
import { Chain, EdgeData, EntityLabel, EntityType, NodeData, RawTransaction, TraceResult, TxIO, TxLookup, transferKey } from '@/lib/types'
import { normaliseAddress, detectChain, truncate } from '@/lib/detect-chain'
import { aggregateEdges, txEdges } from '@/lib/graph'
import { counterparties as findCounterparties, flowSummary } from '@/lib/counterparties'
import { clusterAddresses } from '@/lib/heuristics/cluster'
import { tornadoLinks as findTornadoLinks } from '@/lib/heuristics/eth/tornado'
import { runTaint, TaintMethod } from '@/lib/taint'
import { BtcTxInfo, Direction, followFunds, Lot, seedsFromTx, backSeedsFromTx, TracedFlow, TraceEnd } from '@/lib/follow'
import { saveCase as saveChartToBrowser, getCase as getSavedChart, newCaseId } from '@/lib/saved-cases'
import { useMyLabels, myLabelKey, toEntityLabel } from '@/lib/my-labels'
import { CASE_VERSION, CaseFile, LoadedPage, download, downloadDataUrl, flowsToCsv, parseCase, toGraphml } from '@/lib/export'
import { buildReport } from '@/lib/report'
import { ENTITY_STYLE, nativeAsset } from '@/lib/format'
import AddressInspector, { AddressTab } from '@/components/AddressInspector'
import TxInspector from '@/components/TxInspector'
import EdgeDetail from '@/components/EdgeDetail'
import CasePanel from '@/components/CasePanel'
import SaveChartButton from '@/components/SaveChartButton'
import ExportMenu from '@/components/ExportMenu'
import SearchForm from '@/components/SearchForm'
import ThemeToggle from '@/components/ThemeToggle'
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
/** Participants of a searched transaction put on the graph straight away (per side) */
const TX_PARTICIPANTS = 6

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
  if (chain === 'eth') return getJson<TxLookup>(`/api/tx/eth/${txid}`)
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
  const rawAddress = params.get('address') ?? ''
  const originTx = (params.get('tx') ?? '').toLowerCase()
  const chainParam = params.get('chain') as Chain | null
  const originChain: Chain | null = chainParam === 'btc' || chainParam === 'eth' ? chainParam : originTx ? (originTx.startsWith('0x') ? 'eth' : 'btc') : detectChain(rawAddress)
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
  /** Address pairs whose link the user hid from the graph */
  const [hiddenLinks, setHiddenLinks] = useState<Set<string>>(new Set())
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
  const [follow, setFollow] = useState({ hops: 6, branches: 3 })
  const [traceStatus, setTraceStatus] = useState<string | null>(null)
  const [focusTrace, setFocusTrace] = useState(false)
  const traceCancel = useRef(false)
  const restoring = useRef(false)
  /** Node positions on the canvas (shared with the graph, saved with the chart) */
  const positionsRef = useRef(new Map<string, XY>())
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
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=nzd')
      .then(r => r.json())
      .then(d => setPrices({ BTC: d.bitcoin?.nzd ?? 0, ETH: d.ethereum?.nzd ?? 0, WETH: d.ethereum?.nzd ?? 0, USD: d.tether?.nzd ?? 0 }))
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
    setTraced([])
    setTraceEnds([])
    setFocusTrace(false)
    setHistory([])
    setSelection(null)
    setTaint(null)
  }

  const loadOrigin = useCallback(async () => {
    if (!originChain || (!originTx && !originAddress)) {
      setError('Not a valid Bitcoin or Ethereum address or transaction')
      setInitialLoading(false)
      return
    }
    setInitialLoading(true)
    setError('')
    resetState()
    try {
      if (originTx) {
        const l = await fetchTxLookup(originTx, originChain)
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
    if (restoring.current) {
      restoring.current = false
      return
    }
    if (caseParam) {
      if (saved?.id === caseParam) return // already open (just saved, or the URL was tidied)
      getSavedChart(caseParam)
        .then(r => {
          if (!r) throw new Error('That case no longer exists in this browser')
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
    const chain = originChain ?? 'btc'
    const missing = addrs.filter(a => !knownRef.current.has(a))
    if (missing.length) {
      const next = new Map(knownRef.current)
      for (const a of missing) next.set(a, { address: a, chain, label: btcLabels.current.get(a), balance: 0, txCount: 0, isOrigin: false })
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

  const runFollow = async (direction: Direction, seed: { lots: Lot[]; flows: TracedFlow[] }) => {
    if (!seed.lots.length) {
      flash('Nothing to trace from here')
      return
    }
    snapshot()
    traceCancel.current = false
    const before = traced
    const show = (flows: TracedFlow[]) => {
      const real = flows.filter(f => f.from && f.to)
      setTraced([...before, ...real])
      showOnGraph([...new Set(real.flatMap(f => [f.from, f.to]))])
    }
    show(seed.flows)
    setTraceStatus(direction === 'forward' ? 'Following the funds…' : 'Walking back to the source…')
    try {
      const res = await followFunds(
        seed.lots,
        { direction, maxHops: follow.hops, maxBranches: follow.branches, stopAt: STOP_AT },
        { addressTxs, btcTx, labelOf: a => knownRef.current.get(a)?.label ?? btcLabels.current.get(a) },
        (msg, partial) => {
          setTraceStatus(msg)
          show([...seed.flows, ...partial.flows])
        },
        () => traceCancel.current
      )
      const flows = [...seed.flows, ...res.flows].filter(f => f.from && f.to)
      show(flows)
      // Addresses the trail stopped at (with no outgoing hop yet) still belong on the graph
      showOnGraph(res.ends.map(e => e.address))
      setTraceEnds(prev => [...prev, ...res.ends])
      if (flows.length) setFocusTrace(true)
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
    runFollow('forward', seedsFromTx(tx, from, to))
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

  const traceSet = useMemo(() => new Set(traced.flatMap(f => [f.from, f.to])), [traced])
  const showTraceOnly = focusTrace && traced.length > 0
  const selectedAddress = selection?.kind === 'address' ? selection.id : null

  const graphNodes: AddressNodeData[] = useMemo(() => {
    const endSet = new Set(traceEnds.map(e => e.address))
    const shown = showTraceOnly
      ? [...visible].filter(a => traceSet.has(a) || endSet.has(a) || a === originAddress || a === selectedAddress)
      : [...visible]
    return shown.flatMap(a => {
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
        },
      }]
    })
  }, [visible, known, clusters, taintResult, taint, loadingAddrs, originAddress, showTraceOnly, traceSet, traceEnds, selectedAddress, mine])

  const graphEdges = useMemo(() => {
    const ids = new Set(graphNodes.map(n => n.address))
    return allEdges.filter(e => ids.has(e.source) && ids.has(e.target) && !hiddenLinks.has(pairKey(e.source, e.target)))
  }, [allEdges, graphNodes, hiddenLinks])
  const graphTraced = useMemo(() => traced.filter(f => !hiddenLinks.has(pairKey(f.from, f.to))), [traced, hiddenLinks])
  const hideLink = (a: string, b: string) => {
    setHiddenLinks(prev => new Set(prev).add(pairKey(a, b)))
    setSelection(null)
  }

  // The searched transaction stays visible in Trail view: it is where the trail starts
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
        }
      : null

  const saveCaseFile = () => {
    const c = buildCase()
    if (c) download(`${fileBase}.case.json`, JSON.stringify(c), 'application/json')
  }

  const caseUrl = (c: Pick<CaseFile, 'origin' | 'originKind'>, id?: string) =>
    (c.originKind === 'tx' ? `/trace?tx=${c.origin.address}&chain=${c.origin.chain}` : `/trace?address=${encodeURIComponent(c.origin.address)}&chain=${c.origin.chain}`) +
    (id ? `&case=${encodeURIComponent(id)}` : '')

  const applyCase = (c: CaseFile, from?: { id: string; name: string }) => {
    skipChange.current = true
    setSaved(from ?? null)
    setLastSavedAt(from ? Date.parse(c.savedAt) : null)
    setDirty(false)
    positionsRef.current.clear()
    for (const [id, pos] of Object.entries(c.positions ?? {})) positionsRef.current.set(id, pos)
    setKnownNow(new Map(c.known.map(n => [n.address, n])))
    setVisible(new Set(c.visible))
    pagesRef.current = new Map(Object.entries(c.pages))
    setPages(pagesRef.current)
    setHubs(new Map((c.hubs ?? []).map(h => [h.txid, h])))
    setFollowedPairs(new Set(c.followedPairs))
    setItemizedIds(new Set(c.itemizedIds ?? []))
    setHiddenLinks(new Set(c.hiddenLinks ?? []))
    setTraced(c.traced ?? [])
    setTraceEnds(c.traceEnds ?? [])
    setTaint(c.taint ?? null)
    setHistory([])
    setError('')
    setInitialLoading(false)
    const isTx = c.originKind === 'tx'
    setSelection(isTx ? { kind: 'tx', id: c.origin.address } : { kind: 'address', id: c.origin.address })
    // Keep the case in the URL so a refresh or bookmark reopens (and keeps saving) the same case
    const url = caseUrl(c, from?.id)
    if (c.origin.address !== originKey || (params.get('case') ?? undefined) !== from?.id) {
      restoring.current = true
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
    const isNew = opts.asNew || !saved
    const id = isNew ? newCaseId() : saved!.id
    const counterAtSave = changeCount.current
    setSaving(true)
    try {
      await saveChartToBrowser(id, name, c)
      setSaved({ id, name })
      setLastSavedAt(Date.now())
      if (changeCount.current === counterAtSave) setDirty(false)
      if (isNew || params.get('case') !== id) {
        restoring.current = true
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
  }, [known, visible, pages, hubs, followedPairs, itemizedIds, hiddenLinks, traced, traceEnds, taint, layoutRev, myLabels])
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
    const html = buildReport({ origin: originKey, chain: originChain, nodes: nodeMap, edges: graphEdges, taint: taintResult, traced, traceEnds, nameOf })
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
          onTraceTx={(tx, dir) => runFollow(dir, dir === 'forward' ? seedsFromTx(tx, a) : backSeedsFromTx(tx, a))}
          onTaint={() => {
            setTaint(t => ({ seed: a, method: t?.method ?? 'haircut', asset: nativeAsset(selectedNode.chain) }))
            ensurePage(a)
          }}
          onRemove={() => removeNode(a)}
          onLoadMore={loadMore}
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
        <Link href="/" className="hidden xl:block text-[13px] font-medium tracking-[0.24em] text-fg pr-3 border-r border-line">CRYPTOTRACER</Link>
        <button
          onClick={() => setSelection(originTx ? { kind: 'tx', id: originTx } : { kind: 'address', id: originAddress })}
          className="flex items-center gap-2 min-w-0 max-w-[260px] text-left hover:text-accent"
          title="Show the starting point"
        >
          {originChain && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${originChain === 'btc' ? 'bg-orange-500' : 'bg-violet-500'}`} />}
          <span className="text-[10px] uppercase tracking-wider text-faint flex-shrink-0">{originTx ? 'tx' : originChain}</span>
          <span className="text-xs text-fg truncate font-mono">{originNode?.label?.name ?? originNode?.ens ?? truncate(originKey, 8)}</span>
        </button>
        <div className="flex-1 flex justify-center min-w-0 px-2"><SearchForm compact /></div>
        <div className="flex items-center gap-2.5 text-xs text-faint flex-shrink-0">
          {traceStatus && (
            <span className="flex items-center gap-2 text-accent">
              <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="hidden 2xl:inline">{traceStatus}</span>
              <button onClick={() => (traceCancel.current = true)} className="text-faint hover:text-fg" aria-label="Stop trace"><X size={12} /></button>
            </span>
          )}
          {traced.length > 0 && (
            <div className="flex border border-line text-[11px] font-medium">
              {([['Trail', true], ['All', false]] as const).map(([label, v]) => (
                <button key={label} onClick={() => setFocusTrace(v)} title={v ? 'Show only the traced money trail' : 'Show everything on the graph'}
                  className={`h-7 px-2.5 ${focusTrace === v ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'}`}>{label}</button>
              ))}
            </div>
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
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {!initialLoading && !error && (
          <CasePanel
            collapsed={caseCollapsed}
            onToggle={() => setCaseCollapsed(c => !c)}
            legendTypes={legendTypes}
            follow={follow}
            onFollow={setFollow}
            traced={traced}
            traceEnds={traceEnds}
            onClearTrace={() => { snapshot(); setTraced([]); setTraceEnds([]); setFocusTrace(false) }}
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
              nodes={graphNodes}
              edges={graphEdges}
              followedPairs={followedPairs}
              traced={graphTraced}
              hubs={graphHubs}
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

          {toast && (
            <div className="absolute left-1/2 -translate-x-1/2 top-4 z-30 bg-panel border border-line px-4 py-2 text-xs text-fg shadow-xl">{toast}</div>
          )}
        </main>

        {!initialLoading && !error && (
          <aside
            aria-hidden={!selection}
            className={clsx(
              'flex-shrink-0 bg-bg overflow-hidden transition-[width] duration-200 ease-out',
              selection ? 'w-[400px] max-w-[45vw] border-l border-line' : 'w-0'
            )}
          >
            {/* Fixed inner width so content doesn't reflow while the panel slides */}
            {selection && <div className="w-[400px] max-w-[45vw] h-full flex flex-col min-h-0">{inspector}</div>}
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
