'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, Copy, RefreshCw, Undo2, X } from 'lucide-react'
import { Chain, EdgeData, EntityLabel, EntityType, NodeData, RawTransaction, TraceResult } from '@/lib/types'
import { normaliseAddress, detectChain, truncate } from '@/lib/detect-chain'
import { aggregateEdges, txEdges } from '@/lib/graph'
import { clusterAddresses } from '@/lib/heuristics/cluster'
import { tornadoLinks as findTornadoLinks } from '@/lib/heuristics/eth/tornado'
import { runTaint, TaintMethod } from '@/lib/taint'
import { BtcTxInfo, Direction, followFunds, Lot, seedsFromTx, backSeedsFromTx, TracedFlow, TraceEnd } from '@/lib/follow'
import { CASE_VERSION, CaseFile, LoadedPage, download, downloadDataUrl, flowsToCsv, parseCase, toGraphml } from '@/lib/export'
import { buildReport } from '@/lib/report'
import { ENTITY_STYLE, nativeAsset } from '@/lib/format'
import NodeDetail from '@/components/NodeDetail'
import EdgeDetail from '@/components/EdgeDetail'
import TxTable from '@/components/TxTable'
import Sidebar from '@/components/Sidebar'
import ThemeToggle from '@/components/ThemeToggle'
import type { GraphApi } from '@/components/TraceGraph'
import type { AddressNodeData, MoreNodeData } from '@/components/AddressNode'

const TraceGraph = dynamic(() => import('@/components/TraceGraph'), { ssr: false })

type TaintCfg = { seed: string; method: TaintMethod; asset: string }

interface Snapshot {
  visible: Set<string>
  followedPairs: Set<string>
  traced: TracedFlow[]
  traceEnds: TraceEnd[]
}

/** On first load, show only the largest counterparties on each side plus labelled entities */
const INITIAL_PER_SIDE = 4
const INITIAL_LABELLED = 4
/** Trails end at cash-out points and mixers */
const STOP_AT: EntityType[] = ['exchange', 'deposit', 'mixer', 'coinjoin', 'sanctioned', 'defi']
/** Older pages loaded per address while following funds */
const MAX_EXTRA_PAGES = 5

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

async function fetchTrace(address: string, chain: Chain, cursor?: string): Promise<TraceResult> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  const res = await fetch(`/api/${chain}/${encodeURIComponent(address)}${q}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body as TraceResult
}

/** Largest counterparties on each side, ranked by share of each asset's flow */
function pickInitial(result: TraceResult): string[] {
  const rank = (edges: EdgeData[], other: (e: EdgeData) => string) => {
    const total = new Map<string, number>()
    for (const e of edges) total.set(e.asset, (total.get(e.asset) ?? 0) + e.amount)
    const score = new Map<string, number>()
    for (const e of edges) {
      const a = other(e)
      score.set(a, Math.max(score.get(a) ?? 0, e.amount / (total.get(e.asset) || 1)))
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a)
  }
  const me = result.address
  const ins = rank(result.edges.filter(e => e.target === me), e => e.source).slice(0, INITIAL_PER_SIDE)
  const outs = rank(result.edges.filter(e => e.source === me && !e.isChange), e => e.target).slice(0, INITIAL_PER_SIDE)
  const labelled = result.nodes
    .filter(n => n.address !== me && n.label && n.label.type !== 'unknown')
    .map(n => n.address)
    .slice(0, INITIAL_LABELLED)
  return [...new Set([...ins, ...outs, ...labelled])]
}

function TracePageInner() {
  const params = useSearchParams()
  const router = useRouter()
  const rawAddress = params.get('address') ?? ''
  const chainParam = params.get('chain') as Chain | null
  const originChain: Chain | null = chainParam === 'btc' || chainParam === 'eth' ? chainParam : detectChain(rawAddress)
  const originAddress = originChain ? normaliseAddress(rawAddress, originChain) : rawAddress

  // Everything we know about each address (labels, risk, notes), and which are on the graph
  const [known, setKnown] = useState<Map<string, NodeData>>(new Map())
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [pages, setPages] = useState<Map<string, LoadedPage>>(new Map())
  const [followedPairs, setFollowedPairs] = useState<Set<string>>(new Set())
  const [traced, setTraced] = useState<TracedFlow[]>([])
  const [traceEnds, setTraceEnds] = useState<TraceEnd[]>([])
  const [history, setHistory] = useState<Snapshot[]>([])

  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [loadingAddrs, setLoadingAddrs] = useState<Set<string>>(new Set())
  const [loadingMore, setLoadingMore] = useState(false)

  const [selected, setSelected] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string } | null>(null)
  const [showTx, setShowTx] = useState(false)

  const [taint, setTaint] = useState<TaintCfg | null>(null)
  const [follow, setFollow] = useState({ hops: 6, branches: 3 })
  const [traceStatus, setTraceStatus] = useState<string | null>(null)
  /** Show only the traced money trail (plus the origin) */
  const [focusTrace, setFocusTrace] = useState(false)
  const traceCancel = useRef(false)
  const restoring = useRef(false)
  const graphApi = useRef<GraphApi | null>(null)

  // Refs mirror state for use inside long-running async traces
  const pagesRef = useRef(pages)
  const knownRef = useRef(known)
  const btcTxCache = useRef(new Map<string, BtcTxInfo>())
  const btcLabels = useRef(new Map<string, EntityLabel>())

  // Live NZD prices (fail silently; the flow panel just omits fiat)
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

  /** Merges a page into state. `add` = which of its counterparties to put on the graph */
  const absorb = useCallback((result: TraceResult, add: string[], append = false) => {
    // Update the ref synchronously so an in-flight trace sees new labels immediately
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
    knownRef.current = next
    setKnown(next)
    const ex = pagesRef.current.get(result.address)
    const page: LoadedPage = {
      rawTxs: append && ex ? [...ex.rawTxs, ...result.rawTxs] : result.rawTxs,
      nextCursor: result.nextCursor,
      warnings: result.warnings,
    }
    pagesRef.current = new Map(pagesRef.current).set(result.address, page)
    setPages(pagesRef.current)
    setVisible(prev => new Set([...prev, result.address, ...add]))
  }, [originAddress])

  const resetState = () => {
    knownRef.current = new Map()
    setKnown(knownRef.current)
    setVisible(new Set())
    pagesRef.current = new Map()
    setPages(pagesRef.current)
    setFollowedPairs(new Set())
    setTraced([])
    setTraceEnds([])
    setFocusTrace(false)
    setHistory([])
    setSelected(null)
    setSelectedEdge(null)
    setShowTx(false)
    setTaint(null)
  }

  const loadOrigin = useCallback(async () => {
    if (!originChain) {
      setError('Not a valid BTC or ETH address')
      setInitialLoading(false)
      return
    }
    setInitialLoading(true)
    setError('')
    resetState()
    try {
      const r = await fetchTrace(originAddress, originChain)
      absorb(r, pickInitial(r))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to trace address')
    } finally {
      setInitialLoading(false)
    }
  }, [originAddress, originChain, absorb])

  useEffect(() => {
    if (restoring.current) {
      restoring.current = false
      return
    }
    loadOrigin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originAddress, originChain])

  const setBusy = (addr: string, busy: boolean) =>
    setLoadingAddrs(prev => {
      const n = new Set(prev)
      if (busy) n.add(addr)
      else n.delete(addr)
      return n
    })

  const chainOf = useCallback((a: string): Chain => known.get(a)?.chain ?? originChain ?? 'btc', [known, originChain])

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
      knownRef.current = next
      setKnown(next)
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
    if (selected && !last.visible.has(selected)) setSelected(null)
  }

  const openAddress = (addr: string) => {
    setSelected(addr)
    setSelectedEdge(null)
    setShowTx(true)
    ensurePage(addr)
  }

  const loadMore = async () => {
    if (!selected) return
    const cursor = pagesRef.current.get(selected)?.nextCursor
    if (!cursor) return
    setLoadingMore(true)
    try {
      absorb(await fetchTrace(selected, chainOf(selected), cursor), [], true)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }

  /** Put `to` on the graph, linked from `from`, and load its activity */
  const followAddress = async (from: string, to: string) => {
    if (visible.has(to)) return
    snapshot()
    showOnGraph([to])
    setFollowedPairs(prev => new Set(prev).add(pairKey(from, to)))
    await ensurePage(to)
  }

  const removeNode = (addr: string) => {
    snapshot()
    setVisible(prev => {
      const n = new Set(prev)
      n.delete(addr)
      return n
    })
    setSelected(null)
    setShowTx(false)
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
    const res = await fetch(`/api/tx/btc/${txid}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    const info = body as BtcTxInfo
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
    setSelectedEdge(null)
    const before = traced
    const show = (flows: TracedFlow[]) => {
      setTraced([...before, ...flows])
      showOnGraph([...new Set(flows.flatMap(f => [f.from, f.to]))])
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
      const flows = [...seed.flows, ...res.flows]
      show(flows)
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

  /** Node-level: the address's largest outgoing (or incoming) transactions as starting points */
  const traceFromNode = async (addr: string, direction: Direction) => {
    const page = await ensurePage(addr)
    if (!page) return
    const merged = { lots: [] as Lot[], flows: [] as TracedFlow[] }
    if (direction === 'forward') {
      const outs = page.rawTxs
        .filter(t => t.inputs.some(i => i.address === addr))
        .map(t => ({ t, v: t.outputs.filter(o => o.address !== addr && !o.isChange).reduce((s, o) => s + o.amount, 0) }))
        .filter(x => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, follow.branches)
      for (const { t } of outs) {
        const s = seedsFromTx(t, addr)
        merged.lots.push(...s.lots)
        merged.flows.push(...s.flows)
      }
    } else {
      const ins = page.rawTxs
        .filter(t => t.outputs.some(o => o.address === addr) && !t.inputs.some(i => i.address === addr))
        .map(t => ({ t, v: t.outputs.filter(o => o.address === addr).reduce((s, o) => s + o.amount, 0) }))
        .sort((a, b) => b.v - a.v)
        .slice(0, follow.branches)
      for (const { t } of ins) {
        const s = backSeedsFromTx(t, addr)
        merged.lots.push(...s.lots)
        merged.flows.push(...s.flows)
      }
    }
    await runFollow(direction, merged)
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const allTxs = useMemo(() => [...pages.values()].flatMap(p => p.rawTxs), [pages])

  const perTx = useMemo(
    () => [...pages.entries()].flatMap(([addr, p]) => txEdges(addr, chainOf(addr), p.rawTxs)),
    [pages, chainOf]
  )
  const allEdges = useMemo(() => aggregateEdges(perTx), [perTx])

  const labelOf = useCallback((a: string): EntityLabel | undefined => known.get(a)?.label ?? btcLabels.current.get(a), [known])
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

  const graphNodes: AddressNodeData[] = useMemo(() => {
    const shown = showTraceOnly ? [...visible].filter(a => traceSet.has(a) || a === originAddress || a === selected) : [...visible]
    return shown.flatMap(a => {
      const n = known.get(a)
      if (!n) return []
      const cluster = clusters.byAddress.get(a)
      return [{
        ...n,
        label: n.label ?? btcLabels.current.get(a) ?? cluster?.label,
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
  }, [visible, known, clusters, taintResult, taint, loadingAddrs, originAddress, showTraceOnly, traceSet, selected])

  const graphEdges = useMemo(() => {
    const ids = new Set(graphNodes.map(n => n.address))
    return allEdges.filter(e => ids.has(e.source) && ids.has(e.target))
  }, [allEdges, graphNodes])

  // "+N more" placeholders for counterparties not on the graph (origin and the selected address)
  const moreNodes: MoreNodeData[] = useMemo(() => {
    const out: MoreNodeData[] = []
    if (showTraceOnly) return out
    for (const anchor of new Set([originAddress, selected].filter(Boolean) as string[])) {
      if (!visible.has(anchor) || !pages.has(anchor)) continue
      const hiddenIn = new Set<string>()
      const hiddenOut = new Set<string>()
      for (const e of allEdges) {
        if (e.target === anchor && !visible.has(e.source)) hiddenIn.add(e.source)
        if (e.source === anchor && !visible.has(e.target) && !e.isChange) hiddenOut.add(e.target)
      }
      if (hiddenIn.size) out.push({ anchor, side: 'in', count: hiddenIn.size })
      if (hiddenOut.size) out.push({ anchor, side: 'out', count: hiddenOut.size })
    }
    return out
  }, [originAddress, selected, visible, pages, allEdges, showTraceOnly])

  const legendTypes = useMemo(() => {
    const present = new Set(graphNodes.map(n => n.label?.type).filter(Boolean) as EntityType[])
    return (Object.keys(ENTITY_STYLE) as EntityType[]).filter(t => present.has(t) || ['exchange', 'deposit', 'mixer', 'sanctioned', 'scam', 'unknown'].includes(t))
  }, [graphNodes])

  const selectedNode = selected ? graphNodes.find(n => n.address === selected) ?? known.get(selected) : undefined
  const selectedPage = selected ? pages.get(selected) : undefined
  const origin = graphNodes.find(n => n.address === originAddress)
  const nodeMap = useMemo(() => new Map(graphNodes.map(n => [n.address, n as NodeData])), [graphNodes])
  const nameOf = useCallback((a: string) => nodeMap.get(a)?.label?.name ?? labelOf(a)?.name ?? ensOf(a), [nodeMap, labelOf, ensOf])

  const edgeRows = useMemo(() => {
    if (!selectedEdge) return []
    const seen = new Set<string>()
    return perTx.filter(e => {
      if (e.source !== selectedEdge.from || e.target !== selectedEdge.to || seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })
  }, [perTx, selectedEdge])

  /** The raw transaction behind one per-tx edge */
  const txForRow = (row: EdgeData): RawTransaction | undefined =>
    allTxs.find(t => t.txid === row.txid && t.asset === row.asset && t.inputs.some(i => i.address === row.source) && t.outputs.some(o => o.address === row.target))

  // ── Case files & exports ─────────────────────────────────────────────────
  const fileBase = `trace-${originChain}-${originAddress.slice(0, 10)}`

  const saveCase = () => {
    if (!originChain) return
    const c: CaseFile = {
      version: CASE_VERSION,
      savedAt: new Date().toISOString(),
      origin: { address: originAddress, chain: originChain },
      known: [...known.values()],
      visible: [...visible],
      pages: Object.fromEntries(pages),
      followedPairs: [...followedPairs],
      traced,
      traceEnds,
      taint,
    }
    download(`${fileBase}.case.json`, JSON.stringify(c), 'application/json')
  }

  const loadCase = async (file: File) => {
    try {
      const c = parseCase(await file.text())
      knownRef.current = new Map(c.known.map(n => [n.address, n]))
      setKnown(knownRef.current)
      setVisible(new Set(c.visible))
      pagesRef.current = new Map(Object.entries(c.pages))
      setPages(pagesRef.current)
      setFollowedPairs(new Set(c.followedPairs))
      setTraced(c.traced ?? [])
      setTraceEnds(c.traceEnds ?? [])
      setTaint(c.taint ?? null)
      setHistory([])
      setSelected(null)
      setSelectedEdge(null)
      setShowTx(false)
      setError('')
      setInitialLoading(false)
      if (c.origin.address !== originAddress) {
        restoring.current = true
        router.replace(`/trace?address=${encodeURIComponent(c.origin.address)}&chain=${c.origin.chain}`)
      }
      flash(`Opened case saved ${new Date(c.savedAt).toLocaleString()}`)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not open case file')
    }
  }

  const openReport = () => {
    if (!originChain) return
    const html = buildReport({ origin: originAddress, chain: originChain, nodes: nodeMap, edges: graphEdges, taint: taintResult, traced, traceEnds, nameOf })
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const exportPng = async () => {
    const data = await graphApi.current?.exportPng().catch(() => null)
    if (data) downloadDataUrl(`${fileBase}.png`, data)
    else flash('Could not render the graph image')
  }

  const copyAddress = () => {
    navigator.clipboard.writeText(originAddress)
    flash('Address copied')
  }

  const selectFromSidebar = (a: string) => {
    if (!visible.has(a)) {
      snapshot()
      showOnGraph([a])
    }
    setSelected(a)
    setSelectedEdge(null)
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-bg">
      {/* Top bar */}
      <header className="flex items-center gap-3 h-14 px-3 sm:px-4 border-b border-line flex-shrink-0">
        <Link href="/" className="text-faint hover:text-fg p-1.5" aria-label="Home">
          <ArrowLeft size={16} />
        </Link>
        <Link href="/" className="hidden lg:block text-[13px] font-medium tracking-[0.24em] text-fg pr-3 border-r border-line">
          CRYPTOTRACER
        </Link>
        <div className="flex items-center gap-2 text-sm min-w-0">
          {originChain && (
            <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
              <span className={`w-1.5 h-1.5 rounded-full ${originChain === 'btc' ? 'bg-orange-500' : 'bg-violet-500'}`} />
              {originChain}
            </span>
          )}
          <code className="text-fg text-xs truncate">{origin?.ens ?? truncate(originAddress, 10)}</code>
          <button onClick={copyAddress} className="text-faint hover:text-fg" aria-label="Copy address">
            <Copy size={12} />
          </button>
          {origin?.label && <span className="hidden sm:block text-xs font-medium text-muted truncate">· {origin.label.name}</span>}
        </div>

        <div className="ml-auto flex items-center gap-3 sm:gap-4 text-xs text-faint flex-shrink-0">
          {traceStatus && (
            <span className="flex items-center gap-2 text-accent">
              <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="hidden sm:inline">{traceStatus}</span>
              <button onClick={() => (traceCancel.current = true)} className="text-faint hover:text-fg" aria-label="Stop trace"><X size={12} /></button>
            </span>
          )}
          {traced.length > 0 && (
            <div className="flex border border-line text-[11px] font-medium">
              {([['Trace only', true], ['Everything', false]] as const).map(([label, v]) => (
                <button
                  key={label}
                  onClick={() => setFocusTrace(v)}
                  className={`h-7 px-2.5 ${focusTrace === v ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {!initialLoading && graphNodes.length > 0 && (
            <>
              <span className="hidden md:block">{graphNodes.length} addresses · {graphEdges.length} flows</span>
              <button onClick={undo} disabled={!history.length} className="flex items-center gap-1 hover:text-fg disabled:opacity-30" title="Undo">
                <Undo2 size={14} />
                {history.length > 0 && <span className="text-[10px]">{history.length}</span>}
              </button>
              <button onClick={loadOrigin} className="hover:text-fg" title="Reset trace"><RefreshCw size={14} /></button>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {!initialLoading && !error && (
          <Sidebar
            origin={origin}
            counts={{ nodes: graphNodes.length, edges: graphEdges.length, labelled: graphNodes.filter(n => n.label).length, txs: allTxs.length }}
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
            onSelect={selectFromSidebar}
            onSaveCase={saveCase}
            onLoadCase={loadCase}
            onCsv={() => download(`${fileBase}.flows.csv`, flowsToCsv(nodeMap, graphEdges, taintResult?.byEdge), 'text/csv')}
            onGraphml={() => download(`${fileBase}.graphml`, toGraphml(graphNodes, graphEdges), 'application/xml')}
            onPng={exportPng}
            onReport={openReport}
          />
        )}

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 relative overflow-hidden">
            {initialLoading && (
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <div className="text-muted text-sm">Tracing transactions…</div>
                </div>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 grid place-items-center p-6">
                <div className="max-w-md border border-red-500/40 bg-red-500/5 p-5 text-sm">
                  <div className="font-medium text-red-500 mb-1">Couldn&apos;t trace this address</div>
                  <p className="text-muted leading-relaxed">{error}</p>
                  <div className="mt-4 flex gap-2">
                    <button onClick={loadOrigin} className="h-8 px-3 text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg">Retry</button>
                    <Link href="/" className="h-8 px-3 grid place-items-center text-xs font-medium bg-raised hover:bg-line text-fg">New search</Link>
                  </div>
                </div>
              </div>
            )}

            {!initialLoading && !error && graphNodes.length > 0 && (
              <TraceGraph
                nodes={graphNodes}
                edges={graphEdges}
                followedPairs={followedPairs}
                traced={traced}
                more={moreNodes}
                taintByEdge={taintResult?.byEdge}
                selected={selected}
                selectedEdge={selectedEdge ? `${selectedEdge.from}->${selectedEdge.to}` : null}
                onNodeClick={openAddress}
                onEdgeClick={(from, to) => { setSelectedEdge({ from, to }); setSelected(null) }}
                onMoreClick={openAddress}
                onReady={api => (graphApi.current = api)}
              />
            )}

            {!initialLoading && !error && graphNodes.length > 0 && !selected && !selectedEdge && (
              <div className="absolute left-3 top-3 z-10 max-w-xs bg-panel/90 border border-line px-3 py-2 text-[11px] text-muted leading-relaxed">
                Click an <b className="text-fg font-medium">address</b> to see its transactions, or a <b className="text-fg font-medium">flow</b> (line) to see the payments behind it and trace them.
              </div>
            )}

            {selectedEdge && (
              <EdgeDetail
                from={selectedEdge.from}
                to={selectedEdge.to}
                chain={originChain ?? 'btc'}
                rows={edgeRows}
                traced={traced.filter(f => f.from === selectedEdge.from && f.to === selectedEdge.to)}
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
                onClose={() => setSelectedEdge(null)}
              />
            )}

            {selectedNode && !selectedEdge && (
              <NodeDetail
                node={selectedNode}
                loaded={selectedPage?.rawTxs.length ?? 0}
                isLoading={loadingAddrs.has(selectedNode.address)}
                canRemove={selectedNode.address !== originAddress}
                cluster={clusters.byAddress.get(selectedNode.address)}
                taint={taint ? { amount: taintResult?.byAddress.get(selectedNode.address)?.received ?? 0, asset: taint.asset, isSeed: taint.seed === selectedNode.address } : undefined}
                tracing={!!traceStatus}
                onClose={() => { setSelected(null); setShowTx(false) }}
                onTransactions={() => openAddress(selectedNode.address)}
                onRemove={() => removeNode(selectedNode.address)}
                onTaint={() => {
                  const addr = selectedNode.address
                  setTaint(t => ({ seed: addr, method: t?.method ?? 'haircut', asset: nativeAsset(selectedNode.chain) }))
                  ensurePage(addr)
                }}
                onTrace={dir => traceFromNode(selectedNode.address, dir)}
                onShowCluster={() => {
                  const c = clusters.byAddress.get(selectedNode.address)
                  if (!c) return
                  snapshot()
                  showOnGraph(c.members)
                }}
                onNote={note => {
                  const n = knownRef.current.get(selectedNode.address)
                  if (!n) return
                  knownRef.current = new Map(knownRef.current).set(n.address, { ...n, note: note.trim() || undefined })
                  setKnown(knownRef.current)
                }}
              />
            )}

            {toast && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-30 bg-panel border border-line px-4 py-2 text-xs text-fg shadow-xl">
                {toast}
              </div>
            )}
          </div>

          {showTx && selected && (
            <TxTable
              address={selected}
              txs={selectedPage?.rawTxs ?? []}
              loading={loadingAddrs.has(selected) && !selectedPage}
              hasMore={!!selectedPage?.nextCursor}
              loadingMore={loadingMore}
              warnings={selectedPage?.warnings}
              onGraph={visible}
              followingAddrs={loadingAddrs}
              labelOf={labelOf}
              ensOf={ensOf}
              tracing={!!traceStatus}
              onTrace={(tx, dir) => runFollow(dir, dir === 'forward' ? seedsFromTx(tx, selected) : backSeedsFromTx(tx, selected))}
              onFollow={to => followAddress(selected, to)}
              onLoadMore={loadMore}
              onClose={() => setShowTx(false)}
            />
          )}
        </main>
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
