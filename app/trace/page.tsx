'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { TraceResult, NodeData } from '@/lib/types'
import { truncate } from '@/lib/detect-chain'
import { ArrowLeft, ChevronRight, Copy, RefreshCw } from 'lucide-react'
import NodeDetail from '@/components/NodeDetail'

const TraceGraph = dynamic(() => import('@/components/TraceGraph'), { ssr: false })

function fmtBalance(balance: number, chain: 'btc' | 'eth'): string {
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
  const address = params.get('address') ?? ''
  const chain = params.get('chain') as 'btc' | 'eth' | null

  const [result, setResult] = useState<TraceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null)

  const load = useCallback(async (addr: string, ch: 'btc' | 'eth') => {
    setLoading(true)
    setError('')
    setSelectedNode(null)
    try {
      const res = await fetch(`/api/${ch}/${encodeURIComponent(addr)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data: TraceResult = await res.json()
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to trace address')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (address && chain) load(address, chain)
  }, [address, chain, load])

  const handleExpand = useCallback((addr: string, ch: 'btc' | 'eth') => {
    router.push(`/trace?address=${encodeURIComponent(addr)}&chain=${ch}`)
  }, [router])

  const copyAddress = () => navigator.clipboard.writeText(address)

  return (
    <div className="h-screen bg-[#020817] flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/80 bg-[#020817] flex-shrink-0 z-10">
        <button
          onClick={() => router.push('/')}
          className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-600 hidden sm:block">Trace</span>
          <ChevronRight size={13} className="text-slate-700 hidden sm:block" />
          {chain && (
            <span className={`text-[11px] px-2 py-0.5 rounded font-mono uppercase font-bold flex-shrink-0 ${
              chain === 'btc' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'
            }`}>
              {chain}
            </span>
          )}
          <code className="text-slate-300 font-mono text-xs truncate">{truncate(address, 10)}</code>
          <button onClick={copyAddress} className="text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0">
            <Copy size={12} />
          </button>
          {result?.entity && (
            <>
              <ChevronRight size={13} className="text-slate-700 flex-shrink-0" />
              <span className="text-green-400 text-xs font-semibold flex-shrink-0">{result.entity.name}</span>
            </>
          )}
        </div>

        {result && !loading && (
          <div className="ml-auto flex items-center gap-4 text-xs text-slate-600 flex-shrink-0">
            <span>{result.nodes.length} addresses</span>
            <span className="hidden sm:block">{result.edges.length} flows</span>
            <button
              onClick={() => chain && load(address, chain)}
              className="text-slate-600 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0 border-r border-slate-800/80 bg-[#020817] overflow-y-auto p-3 space-y-3">
          {loading && (
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

          {result && !loading && (
            <>
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Origin</div>
                <code className="text-[10px] text-cyan-400 font-mono break-all block leading-relaxed">
                  {result.address}
                </code>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-slate-600 mb-0.5">Balance</div>
                    <div className="text-[11px] text-white font-mono">
                      {fmtBalance(result.balance, result.chain)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-600 mb-0.5">Total txs</div>
                    <div className="text-[11px] text-white">{result.txCount.toLocaleString()}</div>
                  </div>
                </div>
                {result.entity && (
                  <div className="pt-2 border-t border-slate-800">
                    <div className="text-[10px] text-slate-600 mb-0.5">Entity</div>
                    <div className="text-xs text-white font-semibold">{result.entity.name}</div>
                    <div className="text-[10px] text-slate-500 capitalize">{result.entity.type}</div>
                  </div>
                )}
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Graph</div>
                <div className="space-y-1.5">
                  {LEGEND.map(item => (
                    <div key={item.label} className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.color}`} />
                      <span className="text-[11px] text-slate-400">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-1.5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Stats</div>
                <div className="flex justify-between">
                  <span className="text-[11px] text-slate-500">Addresses found</span>
                  <span className="text-[11px] text-white">{result.nodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] text-slate-500">Fund flows</span>
                  <span className="text-[11px] text-white">{result.edges.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] text-slate-500">Entities tagged</span>
                  <span className="text-[11px] text-white">{result.nodes.filter(n => n.label).length}</span>
                </div>
              </div>

              <p className="text-[10px] text-slate-700 leading-relaxed px-1">
                Click any node to view details or expand it to trace further.
              </p>
            </>
          )}
        </div>

        {/* Graph */}
        <div className="flex-1 relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#020817]">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <div className="text-slate-500 text-sm">Tracing transactions...</div>
              </div>
            </div>
          )}

          {result && !loading && (
            <TraceGraph result={result} onNodeClick={setSelectedNode} />
          )}

          {selectedNode && (
            <NodeDetail
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
              onExpand={handleExpand}
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
