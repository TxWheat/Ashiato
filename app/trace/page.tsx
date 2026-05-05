'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { TraceResult, NodeData, EdgeData, RawTransaction, Chain } from '@/lib/types'
import { truncate } from '@/lib/detect-chain'
import { ArrowLeft, ChevronRight, Copy, RefreshCw, Undo2 } from 'lucide-react'
import NodeDetail from '@/components/NodeDetail'
import TxTable from '@/components/TxTable'

const TraceGraph = dynamic(() => import('@/components/TraceGraph'), { ssr: false })

function fmtBalance(balance: number, chain: Chain): string {
  if (chain === 'btc') {
    const b = balance / 1e8
    return b === 0 ? '0 BTC' : `${b.toFixed(8)} BTC`
  }
  const e = balance / 1e18
  return e === 0 ? '0 ETH' : `${e.toFixed(6)} ETH`
}

const LEGEND = [
  { color: 'bg-cyan-400',   label: 'Origin address' },
  { color: 'bg-green-500',  label: 'Exchange' },
  { color: 'bg-red-500',    label: 'Flagged / Scam' },
  { color: 'bg-orange-500', label: 'Mixer / Tumbler' },
  { color: 'bg-purple-500', label: 'DeFi protocol' },
  { color: 'bg-slate-500',  label: 'Unknown wallet' },
]

function TracePageInner() {
  const params = useSearchParams()
  const router = useRouter()
  const originAddress = params.get('address') ?? ''
  const originChain = params.get('chain') as Chain | null

  const [allNodes, setAllNodes] = useState<Map<string, NodeData>>(new Map())
  const [allEdges, setAllEdges] = useState<Map<string, EdgeData>>(new Map())
  const [rawTxsByAddr, setRawTxsByAddr] = useState<Map<string, RawTransaction[]>>(new Map())

  const [originResult, setOriginResult] = useState<TraceResult | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')

  const [followingAddrs, setFollowingAddrs] = useState<Set<string>>(new Set())
  const [followedEdgeIds, setFollowedEdgeIds] = useState<Set<string>>(new Set())

  // Undo history — each entry is a snapshot before a follow/remove action
  const [history, setHistory] = useState<Array<{
    nodes: Map<string, NodeData>
    edges: Map<string, EdgeData>
    followedEdgeIds: Set<string>
  }>>([])

  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null)
  const [showTxPanel, setShowTxPanel] = useState(false)
  const [txPanelLoading, setTxPanelLoading] = useState(false)

  // Live NZD prices from CoinGecko (fail silently)
  const [prices, setPrices] = useState({ btc: 0, eth: 0 })
  useEffect(() => {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=nzd')
      .then(r => r.json())
      .then(d => setPrices({ btc: d.bitcoin?.nzd ?? 0, eth: d.ethereum?.nzd ?? 0 }))
      .catch(() => {})
  }, [])

  const mergeResult = useCallback((result: TraceResult) => {
    setAllNodes(prev => {
      const next = new Map(prev)
      result.nodes.forEach(n => {
        const existing = next.get(n.address)
        next.set(n.address, { ...n, isExpanded: existing?.isExpanded ?? false })
      })
      return next
    })
    setAllEdges(prev => {
      const next = new Map(prev)
      result.edges.forEach(e => { if (!next.has(e.id)) next.set(e.id, e) })
      return next
    })
    setRawTxsByAddr(prev => new Map(prev).set(result.address, result.rawTxs))
  }, [])

  // Initial load — shows origin + 1-hop neighbours
  const loadOrigin = useCallback(async (addr: string, chain: Chain) => {
    setInitialLoading(true)
    setError('')
    setAllNodes(new Map())
    setAllEdges(new Map())
    setRawTxsByAddr(new Map())
    setSelectedNode(null)
    setShowTxPanel(false)
    try {
      const res = await fetch(`/api/${chain}/${encodeURIComponent(addr)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data: TraceResult = await res.json()
      setOriginResult(data)
      mergeResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to trace address')
    } finally {
      setInitialLoading(false)
    }
  }, [mergeResult])

  useEffect(() => {
    if (originAddress && originChain) loadOrigin(originAddress, originChain)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originAddress, originChain])

  // Expand = fetch txs for a node + open Txs panel.
  // Does NOT auto-add all connected addresses — user selects via Follow.
  const handleExpand = useCallback(async (node: NodeData) => {
    setSelectedNode(node)
    setShowTxPanel(true)
    if (rawTxsByAddr.has(node.address)) return
    setTxPanelLoading(true)
    try {
      const res = await fetch(`/api/${node.chain}/${encodeURIComponent(node.address)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: TraceResult = await res.json()
      setRawTxsByAddr(prev => new Map(prev).set(node.address, data.rawTxs))
      setAllNodes(prev => {
        const next = new Map(prev)
        const existing = next.get(node.address)
        if (existing) next.set(node.address, { ...existing, balance: data.balance, txCount: data.txCount })
        return next
      })
    } catch {
      // leave panel open, tx list stays empty
    } finally {
      setTxPanelLoading(false)
    }
  }, [rawTxsByAddr])

  const saveHistory = useCallback(() => {
    setHistory(prev => [
      ...prev.slice(-19), // keep max 20 steps
      { nodes: new Map(allNodes), edges: new Map(allEdges), followedEdgeIds: new Set(followedEdgeIds) },
    ])
  }, [allNodes, allEdges, followedEdgeIds])

  const undo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setAllNodes(last.nodes)
      setAllEdges(last.edges)
      setFollowedEdgeIds(last.followedEdgeIds)
      setSelectedNode(null)
      setShowTxPanel(false)
      return prev.slice(0, -1)
    })
  }, [])

  // Follow = add one specific address + its connecting edges into the graph
  const followAddress = useCallback(async (toAddr: string, chain: Chain) => {
    if (followingAddrs.has(toAddr)) return
    saveHistory()
    setFollowingAddrs(prev => new Set(prev).add(toAddr))
    try {
      const res = await fetch(`/api/${chain}/${encodeURIComponent(toAddr)}`)
      if (!res.ok) throw new Error()
      const data: TraceResult = await res.json()
      // Add only the target node (not all its neighbours)
      setAllNodes(prev => {
        const next = new Map(prev)
        const target = data.nodes.find(n => n.address === toAddr)
        if (target) next.set(toAddr, { ...target, isOrigin: false })
        return next
      })
      // Add edges and mark them as followed (animated cyan)
      setAllEdges(prev => {
        const next = new Map(prev)
        data.edges.forEach(e => { if (!next.has(e.id)) next.set(e.id, e) })
        return next
      })
      setFollowedEdgeIds(prev => {
        const next = new Set(prev)
        data.edges.forEach(e => {
          if (e.target === toAddr || e.source === toAddr) next.add(e.id)
        })
        return next
      })
      setRawTxsByAddr(prev => new Map(prev).set(toAddr, data.rawTxs))
    } catch {
      // silently ignore — history snapshot already saved, undo will revert
    } finally {
      setFollowingAddrs(prev => {
        const next = new Set(prev)
        next.delete(toAddr)
        return next
      })
    }
  }, [followingAddrs, saveHistory])

  // Remove a node and all edges connected to it
  const removeNode = useCallback((address: string) => {
    saveHistory()
    setAllNodes(prev => {
      const next = new Map(prev)
      next.delete(address)
      return next
    })
    setAllEdges(prev => {
      const next = new Map(prev)
      for (const [id, edge] of prev) {
        if (edge.source === address || edge.target === address) next.delete(id)
      }
      return next
    })
    setSelectedNode(null)
    setShowTxPanel(false)
  }, [saveHistory])

  const handleNodeClick = useCallback((node: NodeData) => {
    setSelectedNode(node)
    setShowTxPanel(false)
  }, [])

  const copyAddress = () => navigator.clipboard.writeText(originAddress)

  const nodes = Array.from(allNodes.values())
  const edges = Array.from(allEdges.values())
  const selectedTxs = selectedNode ? (rawTxsByAddr.get(selectedNode.address) ?? []) : []
  const selectedChain = selectedNode?.chain ?? originChain ?? 'btc'

  return (
    <div className="h-screen bg-[#020817] flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/80 bg-[#020817] flex-shrink-0">
        <button
          onClick={() => router.push('/')}
          className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-600 hidden sm:block">Trace</span>
          <ChevronRight size={13} className="text-slate-700 hidden sm:block" />
          {originChain && (
            <span className={`text-[11px] px-2 py-0.5 rounded font-mono uppercase font-bold flex-shrink-0 ${
              originChain === 'btc' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'
            }`}>
              {originChain}
            </span>
          )}
          <code className="text-slate-300 font-mono text-xs truncate">{truncate(originAddress, 10)}</code>
          <button onClick={copyAddress} className="text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0">
            <Copy size={12} />
          </button>
          {originResult?.entity && (
            <>
              <ChevronRight size={13} className="text-slate-700 flex-shrink-0" />
              <span className="text-green-400 text-xs font-semibold flex-shrink-0">{originResult.entity.name}</span>
            </>
          )}
        </div>

        {!initialLoading && nodes.length > 0 && (
          <div className="ml-auto flex items-center gap-4 text-xs text-slate-600 flex-shrink-0">
            <span>{nodes.length} addresses</span>
            <span className="hidden sm:block">{edges.length} flows</span>
            {prices.btc > 0 && (
              <span className="hidden md:block text-slate-700">
                BTC ${prices.btc.toLocaleString()} NZD
              </span>
            )}
            <button
              onClick={undo}
              disabled={history.length === 0}
              className="flex items-center gap-1 text-slate-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={`Undo (${history.length} steps)`}
            >
              <Undo2 size={13} />
              {history.length > 0 && <span className="text-[10px]">{history.length}</span>}
            </button>
            <button
              onClick={() => originChain && loadOrigin(originAddress, originChain)}
              className="text-slate-600 hover:text-white transition-colors"
              title="Reset trace"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar */}
        <div className="w-60 flex-shrink-0 border-r border-slate-800/80 bg-[#020817] overflow-y-auto p-3 space-y-3">
          {initialLoading && (
            <div className="space-y-3 pt-1">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 bg-slate-900 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-xs leading-relaxed">
              {error}
            </div>
          )}

          {originResult && !initialLoading && (
            <>
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Origin</div>
                <code className="text-[10px] text-cyan-400 font-mono break-all block leading-relaxed">
                  {originResult.address}
                </code>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-slate-600 mb-0.5">Balance</div>
                    <div className="text-[11px] text-white font-mono">
                      {fmtBalance(originResult.balance, originResult.chain)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-600 mb-0.5">Total txs</div>
                    <div className="text-[11px] text-white">{originResult.txCount.toLocaleString()}</div>
                  </div>
                </div>
                {originResult.entity && (
                  <div className="pt-2 border-t border-slate-800">
                    <div className="text-[10px] text-slate-600 mb-0.5">Entity</div>
                    <div className="text-xs text-white font-semibold">{originResult.entity.name}</div>
                    <div className="text-[10px] text-slate-500 capitalize">{originResult.entity.type}</div>
                  </div>
                )}
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Legend</div>
                <div className="space-y-1.5">
                  {LEGEND.map(item => (
                    <div key={item.label} className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.color}`} />
                      <span className="text-[11px] text-slate-400">{item.label}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-0.5">
                    <div className="w-4 border-t border-dashed border-yellow-700 flex-shrink-0" />
                    <span className="text-[11px] text-slate-500">Change output</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-1.5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Stats</div>
                <div className="flex justify-between">
                  <span className="text-[11px] text-slate-500">Addresses</span>
                  <span className="text-[11px] text-white">{nodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] text-slate-500">Fund flows</span>
                  <span className="text-[11px] text-white">{edges.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] text-slate-500">Entities tagged</span>
                  <span className="text-[11px] text-white">{nodes.filter(n => n.label).length}</span>
                </div>
              </div>

              <p className="text-[10px] text-slate-700 leading-relaxed px-1">
                Click a node → Expand loads its transactions. Follow adds a specific address to the graph. Remove deletes it.
              </p>
            </>
          )}
        </div>

        {/* Graph + tx table */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 relative overflow-hidden">
            {initialLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#020817]">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <div className="text-slate-500 text-sm">Tracing transactions…</div>
                </div>
              </div>
            )}

            {!initialLoading && nodes.length > 0 && (
              <TraceGraph
                nodes={nodes}
                edges={edges}
                originAddress={originAddress}
                prices={prices}
                followedEdgeIds={followedEdgeIds}
                onNodeClick={handleNodeClick}
              />
            )}

            {selectedNode && (
              <NodeDetail
                node={selectedNode}
                isLoading={txPanelLoading}
                canRemove={selectedNode.address !== originAddress}
                onClose={() => { setSelectedNode(null); setShowTxPanel(false) }}
                onExpand={() => handleExpand(selectedNode)}
                onRemove={() => removeNode(selectedNode.address)}
              />
            )}
          </div>

          {showTxPanel && selectedNode && (
            <TxTable
              address={selectedNode.address}
              chain={selectedChain}
              txs={selectedTxs}
              loading={txPanelLoading}
              followingAddrs={followingAddrs}
              onFollow={followAddress}
              onClose={() => setShowTxPanel(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function TracePage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-[#020817] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <TracePageInner />
    </Suspense>
  )
}
