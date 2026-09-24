'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, Copy, RefreshCw, Undo2, X } from 'lucide-react'
import { Chain, EntityLabel, EntityType, NodeData, TraceResult } from '@/lib/types'
import { normaliseAddress, detectChain, truncate } from '@/lib/detect-chain'
import { aggregateEdges, txEdges } from '@/lib/graph'
import { clusterAddresses } from '@/lib/heuristics/cluster'
import { tornadoLinks as findTornadoLinks } from '@/lib/heuristics/eth/tornado'
import { runTaint, TaintMethod } from '@/lib/taint'
import { autoTrace, DEFAULT_STOP } from '@/lib/autotrace'
import { CASE_VERSION, CaseFile, LoadedPage, download, downloadDataUrl, flowsToCsv, parseCase, toGraphml } from '@/lib/export'
import { buildReport } from '@/lib/report'
import { ENTITY_STYLE, nativeAsset } from '@/lib/format'
import NodeDetail from '@/components/NodeDetail'
import TxTable from '@/components/TxTable'
import Sidebar from '@/components/Sidebar'
import ThemeToggle from '@/components/ThemeToggle'
import type { GraphApi } from '@/components/TraceGraph'
import type { AddressNodeData } from '@/components/AddressNode'

const TraceGraph = dynamic(() => import('@/components/TraceGraph'), { ssr: false })

type TaintCfg = { seed: string; method: TaintMethod; asset: string }

interface Snapshot {
  visible: Set<string>
  followedPairs: Set<string>
}

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

function TracePageInner() {
  const params = useSearchParams()
  const router = useRouter()
  const rawAddress = params.get('address') ?? ''
  const chainParam = params.get('chain') as Chain | null
  const originChain: Chain | null = chainParam === 'btc' || chainParam === 'eth' ? chainParam : detectChain(rawAddress)
  // Node IDs are normalised (ETH lowercase), so the origin must be too (bug C4)
  const originAddress = originChain ? normaliseAddress(rawAddress, originChain) : rawAddress

  // Everything we know about each address (labels, risk, notes), and which are on the graph
  const [known, setKnown] = useState<Map<string, NodeData>>(new Map())
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [pages, setPages] = useState<Map<string, LoadedPage>>(new Map())
  const [followedPairs, setFollowedPairs] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<Snapshot[]>([])

  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [loadingAddrs, setLoadingAddrs] = useState<Set<string>>(new Set())
  const [loadingMore, setLoadingMore] = useState(false)

  const [selected, setSelected] = useState<string | null>(null)
  const [showTx, setShowTx] = useState(false)

  const [taint, setTaint] = useState<TaintCfg | null>(null)
  const [auto, setAuto] = useState({ depth: 3, topK: 3 })
  const [autoStatus, setAutoStatus] = useState<string | null>(null)
  const autoCancel = useRef(false)
  const restoring = useRef(false)
  const graphApi = useRef<GraphApi | null>(null)

  // Live NZD prices (fail silently; labels just omit fiat)
  const [prices, setPrices] = useState<Record<string, number>>({})
  useEffect(() => {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=nzd')
      .then(r => r.json())
      .then(d => setPrices({ BTC: d.bitcoin?.nzd ?? 0, ETH: d.ethereum?.nzd ?? 0, WETH: d.ethereum?.nzd ?? 0, USD: d.tether?.nzd ?? 0 }))
      .catch(() => {})
  }, [])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }, [])

  /** Merges a page into state. `add` = which of its addresses to put on the graph */
  const absorb = useCallback((result: TraceResult, add: 'all' | 'self' | string[], append = false) => {
    setKnown(prev => {
      const next = new Map(prev)
      for (const n of result.nodes) {
        const ex = next.get(n.address)
        if (n.address === result.address) {
          next.set(n.address, {
            ...(ex ?? n),
            balance: n.balance,
            txCount: n.txCount,
            risk: n.risk,
            findings: n.findings,
            label: ex?.label && !ex.label.inferredBy ? ex.label : n.label ?? ex?.label,
            isExpanded: true,
            isOrigin: n.address === originAddress,
          })
        } else if (!ex) {
          next.set(n.address, { ...n, isOrigin: false })
        } else if (!ex.label && n.label) {
          next.set(n.address, { ...ex, label: n.label })
        }
      }
      return next
    })
    setPages(prev => {
      const next = new Map(prev)
      const ex = next.get(result.address)
      next.set(result.address, {
        rawTxs: append && ex ? [...ex.rawTxs, ...result.rawTxs] : result.rawTxs,
        nextCursor: result.nextCursor,
        warnings: result.warnings,
      })
      return next
    })
    setVisible(prev => {
      const next = new Set(prev)
      next.add(result.address)
      if (add === 'all') result.nodes.forEach(n => next.add(n.address))
      else if (Array.isArray(add)) add.forEach(a => next.add(a))
      return next
    })
  }, [originAddress])

  const loadOrigin = useCallback(async () => {
    if (!originChain) {
      setError('Not a valid BTC or ETH address')
      setInitialLoading(false)
      return
    }
    setInitialLoading(true)
    setError('')
    setKnown(new Map())
    setVisible(new Set())
    setPages(new Map())
    setFollowedPairs(new Set())
    setHistory([])
    setSelected(null)
    setShowTx(false)
    setTaint(null)
    try {
      absorb(await fetchTrace(originAddress, originChain), 'all')
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

  /** Puts addresses on the graph, creating bare nodes for ones only seen inside transactions */
  const showOnGraph = useCallback((addrs: string[]) => {
    const chain = originChain ?? 'btc'
    setKnown(prev => {
      const missing = addrs.filter(a => !prev.has(a))
      if (!missing.length) return prev
      const next = new Map(prev)
      for (const a of missing) next.set(a, { address: a, chain, balance: 0, txCount: 0, isOrigin: false })
      return next
    })
    setVisible(prev => new Set([...prev, ...addrs]))
  }, [originChain])

  /** Loads an address's first page if we don't have it yet */
  const ensurePage = useCallback(async (addr: string): Promise<TraceResult | null> => {
    if (pages.has(addr)) return null
    setBusy(addr, true)
    try {
      const r = await fetchTrace(addr, chainOf(addr))
      absorb(r, 'self')
      return r
    } catch (e) {
      flash(`${truncate(addr, 6)}: ${e instanceof Error ? e.message : 'failed to load'}`)
      return null
    } finally {
      setBusy(addr, false)
    }
  }, [pages, chainOf, absorb, flash])

  const snapshot = useCallback(() => {
    setHistory(prev => [...prev.slice(-29), { visible: new Set(visible), followedPairs: new Set(followedPairs) }])
  }, [visible, followedPairs])

  const undo = () => {
    const last = history[history.length - 1]
    if (!last) return
    setVisible(last.visible)
    setFollowedPairs(last.followedPairs)
    setHistory(history.slice(0, -1))
    if (selected && !last.visible.has(selected)) setSelected(null)
  }

  const openTransactions = (addr: string) => {
    setSelected(addr)
    setShowTx(true)
    ensurePage(addr)
  }

  const loadMore = async () => {
    if (!selected) return
    const cursor = pages.get(selected)?.nextCursor
    if (!cursor) return
    setLoadingMore(true)
    try {
      absorb(await fetchTrace(selected, chainOf(selected), cursor), 'self', true)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }

  /** Put `to` on the graph, linked from `from`, and load its activity */
  const follow = async (from: string, to: string) => {
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

  const runAuto = async (start: string, direction: 'forward' | 'backward') => {
    snapshot()
    autoCancel.current = false
    const opts = direction === 'backward' && auto.topK > 1
      ? { direction, depth: Math.max(auto.depth, 4), topK: 1, stopAt: DEFAULT_STOP }
      : { direction, depth: auto.depth, topK: auto.topK, stopAt: DEFAULT_STOP }
    setAutoStatus(direction === 'forward' ? 'Tracing outflows…' : 'Walking back to the source…')
    const cache = new Map<string, TraceResult>()
    const res = await autoTrace(
      start,
      opts,
      async addr => {
        setAutoStatus(`Loading ${truncate(addr, 6)}…`)
        const r = cache.get(addr) ?? (await fetchTrace(addr, chainOf(addr)))
        cache.set(addr, r)
        return r
      },
      step => {
        absorb(step.result, step.picked)
        setFollowedPairs(prev => {
          const n = new Set(prev)
          step.picked.forEach(p => n.add(pairKey(step.from, p)))
          return n
        })
      },
      () => autoCancel.current
    )
    setAutoStatus(null)
    flash(`Auto-trace visited ${res.visited} addresses${res.stoppedAt.length ? `, stopped at ${res.stoppedAt.length} exchange/mixer/sanctioned` : ''}`)
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const allTxs = useMemo(() => [...pages.values()].flatMap(p => p.rawTxs), [pages])

  const allEdges = useMemo(() => {
    const perTx = [...pages.entries()].flatMap(([addr, p]) => txEdges(addr, chainOf(addr), p.rawTxs))
    return aggregateEdges(perTx)
  }, [pages, chainOf])

  const labelOf = useCallback((a: string): EntityLabel | undefined => known.get(a)?.label, [known])

  const clusters = useMemo(() => {
    const labels = new Map<string, EntityLabel | undefined>()
    known.forEach((n, a) => labels.set(a, n.label))
    return clusterAddresses(allTxs, labels)
  }, [allTxs, known])

  const tornado = useMemo(() => (originChain === 'eth' ? findTornadoLinks(allTxs, labelOf) : []), [allTxs, labelOf, originChain])

  const taintAssets = useMemo(() => [...new Set(allTxs.map(t => t.asset))].sort(), [allTxs])
  const taintResult = useMemo(() => (taint ? runTaint(allTxs, [taint.seed], taint.method, taint.asset) : null), [taint, allTxs])

  const graphNodes: AddressNodeData[] = useMemo(() => {
    return [...visible].flatMap(a => {
      const n = known.get(a)
      if (!n) return []
      const cluster = clusters.byAddress.get(a)
      const label = n.label ?? cluster?.label
      return [{
        ...n,
        label,
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
  }, [visible, known, clusters, taintResult, taint, loadingAddrs, originAddress])

  const graphEdges = useMemo(() => allEdges.filter(e => visible.has(e.source) && visible.has(e.target)), [allEdges, visible])

  const legendTypes = useMemo(() => {
    const present = new Set(graphNodes.map(n => n.label?.type).filter(Boolean) as EntityType[])
    return (Object.keys(ENTITY_STYLE) as EntityType[]).filter(t => present.has(t) || ['exchange', 'deposit', 'mixer', 'sanctioned', 'scam', 'unknown'].includes(t))
  }, [graphNodes])

  const selectedNode = selected ? graphNodes.find(n => n.address === selected) ?? known.get(selected) : undefined
  const selectedPage = selected ? pages.get(selected) : undefined
  const origin = graphNodes.find(n => n.address === originAddress)

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
      taint,
    }
    download(`${fileBase}.case.json`, JSON.stringify(c), 'application/json')
  }

  const loadCase = async (file: File) => {
    try {
      const c = parseCase(await file.text())
      setKnown(new Map(c.known.map(n => [n.address, n])))
      setVisible(new Set(c.visible))
      setPages(new Map(Object.entries(c.pages)))
      setFollowedPairs(new Set(c.followedPairs))
      setTaint(c.taint ?? null)
      setHistory([])
      setSelected(null)
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

  const nodeMap = useMemo(() => new Map(graphNodes.map(n => [n.address, n as NodeData])), [graphNodes])

  const openReport = () => {
    if (!originChain) return
    const html = buildReport({ origin: originAddress, chain: originChain, nodes: nodeMap, edges: graphEdges, taint: taintResult })
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
          <code className="text-fg text-xs truncate">{truncate(originAddress, 10)}</code>
          <button onClick={copyAddress} className="text-faint hover:text-fg" aria-label="Copy address">
            <Copy size={12} />
          </button>
          {origin?.label && <span className="hidden sm:block text-xs font-medium text-muted truncate">· {origin.label.name}</span>}
        </div>

        <div className="ml-auto flex items-center gap-3 sm:gap-4 text-xs text-faint flex-shrink-0">
          {autoStatus && (
            <span className="flex items-center gap-2 text-accent">
              <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="hidden sm:inline">{autoStatus}</span>
              <button onClick={() => (autoCancel.current = true)} className="text-faint hover:text-fg" aria-label="Cancel auto-trace"><X size={12} /></button>
            </span>
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
            auto={auto}
            onAuto={setAuto}
            taint={taint}
            taintResult={taintResult}
            taintAssets={taintAssets}
            onTaintMethod={m => setTaint(t => (t ? { ...t, method: m } : t))}
            onTaintAsset={a => setTaint(t => (t ? { ...t, asset: a } : t))}
            onTaintClear={() => setTaint(null)}
            clusters={clusters.clusters}
            tornadoLinks={tornado}
            labelOf={a => nodeMap.get(a)?.label ?? labelOf(a)}
            onSelect={a => {
              if (!visible.has(a)) {
                snapshot()
                showOnGraph([a])
              }
              setSelected(a)
            }}
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
                prices={prices}
                followedPairs={followedPairs}
                taintByEdge={taintResult?.byEdge}
                selected={selected}
                onNodeClick={a => {
                  setSelected(a)
                  if (showTx) ensurePage(a)
                }}
                onReady={api => (graphApi.current = api)}
              />
            )}

            {selectedNode && (
              <NodeDetail
                node={selectedNode}
                loaded={selectedPage?.rawTxs.length ?? 0}
                isLoading={loadingAddrs.has(selectedNode.address)}
                canRemove={selectedNode.address !== originAddress}
                cluster={clusters.byAddress.get(selectedNode.address)}
                taint={taint ? { amount: taintResult?.byAddress.get(selectedNode.address)?.received ?? 0, asset: taint.asset, isSeed: taint.seed === selectedNode.address } : undefined}
                autoRunning={!!autoStatus}
                onClose={() => { setSelected(null); setShowTx(false) }}
                onTransactions={() => openTransactions(selectedNode.address)}
                onRemove={() => removeNode(selectedNode.address)}
                onTaint={() => {
                  const addr = selectedNode.address
                  setTaint(t => ({ seed: addr, method: t?.method ?? 'haircut', asset: nativeAsset(selectedNode.chain) }))
                  ensurePage(addr)
                }}
                onAutoTrace={dir => runAuto(selectedNode.address, dir)}
                onShowCluster={() => {
                  const c = clusters.byAddress.get(selectedNode.address)
                  if (!c) return
                  snapshot()
                  showOnGraph(c.members)
                }}
                onNote={note => setKnown(prev => {
                  const n = prev.get(selectedNode.address)
                  return n ? new Map(prev).set(n.address, { ...n, note: note.trim() || undefined }) : prev
                })}
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
              labelOf={a => nodeMap.get(a)?.label ?? labelOf(a)}
              onFollow={to => follow(selected, to)}
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
