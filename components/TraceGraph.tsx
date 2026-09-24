'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import ReactFlow, {
  Node,
  Edge,
  NodeChange,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
  ReactFlowInstance,
  getRectOfNodes,
  getTransformForBounds,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { toPng } from 'html-to-image'
import { EdgeData } from '@/lib/types'
import { TracedFlow } from '@/lib/follow'
import { ENTITY_STYLE, fmtAmount } from '@/lib/format'
import AddressNode, { AddressNodeData, TxNode, TxHubData } from './AddressNode'
import OffsetEdge from './OffsetEdge'

const nodeTypes = { addressNode: AddressNode, tx: TxNode }
const edgeTypes = { offset: OffsetEdge }

const NODE_W = 196
const NODE_H = 78
const FIT = { padding: 0.3, maxZoom: 1.1 }
const TAINT = '#ef4444'

function layoutGraph(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 240 })
  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach(e => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  })
  dagre.layout(g)
  return nodes.map(n => {
    const pos = g.node(n.id)
    return pos ? { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } } : n
  })
}

/** Short on-canvas label; dates, fiat and tx hashes live in the flow panel (click the edge) */
function edgeLabel(e: EdgeData): string {
  return fmtAmount(e.amount, e.asset) + (e.txCount && e.txCount > 1 ? ` ×${e.txCount}` : '')
}

export interface GraphApi {
  exportPng: () => Promise<string | null>
  fitView: () => void
}

interface Props {
  nodes: AddressNodeData[]
  edges: EdgeData[]
  followedPairs: Set<string>
  traced: TracedFlow[]
  hubs: TxHubData[]
  /** Individual transactions drawn as their own lines (replacing the pair's relationship line) */
  itemized: EdgeData[]
  taintByEdge?: Map<string, number>
  selected?: string | null
  selectedEdge?: string | null
  selectedHub?: string | null
  onNodeClick: (address: string) => void
  onEdgeClick: (from: string, to: string) => void
  onHubClick: (txid: string) => void
  onReady?: (api: GraphApi) => void
}

export function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export default function TraceGraph({ nodes: nodeData, edges: edgeData, followedPairs, traced, hubs, itemized, taintByEdge, selected, selectedEdge, selectedHub, onNodeClick, onEdgeClick, onHubClick, onReady }: Props) {
  const rf = useRef<ReactFlowInstance | null>(null)
  const pinned = useRef<Map<string, { x: number; y: number }>>(new Map())
  const nodeCount = useRef(0)

  const rawNodes: Node[] = useMemo(
    () => [
      ...nodeData.map(n => ({ id: n.address, type: 'addressNode', position: { x: 0, y: 0 }, data: n, selected: n.address === selected })),
      ...hubs.map(h => ({ id: `tx:${h.txid}`, type: 'tx', position: { x: 0, y: 0 }, data: h, selected: h.txid === selectedHub })),
    ],
    [nodeData, hubs, selected, selectedHub]
  )

  const rawEdges: Edge[] = useMemo(() => {
    const ids = new Set(nodeData.map(n => n.address))
    const visible = edgeData.filter(e => ids.has(e.source) && ids.has(e.target))
    // Orbit-style weighting: width scales with value relative to the largest flow of that asset
    const maxByAsset = new Map<string, number>()
    for (const e of visible) maxByAsset.set(e.asset, Math.max(maxByAsset.get(e.asset) ?? 0, e.amount))

    // Traced amounts per directed pair and asset
    const tracedBy = new Map<string, Map<string, number>>()
    for (const f of traced) {
      if (!ids.has(f.from) || !ids.has(f.to)) continue
      const k = `${f.from}->${f.to}`
      const m = tracedBy.get(k) ?? new Map<string, number>()
      m.set(f.asset, (m.get(f.asset) ?? 0) + f.amount)
      tracedBy.set(k, m)
    }

    // Several assets between the same pair (e.g. ETH + USDT) share one drawn edge
    const groups = new Map<string, EdgeData[]>()
    for (const e of visible) {
      const k = `${e.source}->${e.target}`
      groups.set(k, [...(groups.get(k) ?? []), e])
    }
    for (const k of tracedBy.keys()) if (!groups.has(k)) groups.set(k, [])

    // Pairs shown as individual transactions drop their relationship line
    const shownItems = itemized.filter(e => ids.has(e.source) && ids.has(e.target))
    const itemizedPairs = new Set(shownItems.map(e => pairKey(e.source, e.target)))
    for (const k of [...groups.keys()]) {
      const [a, b] = k.split('->')
      if (itemizedPairs.has(pairKey(a, b)) && !tracedBy.has(k)) groups.delete(k)
    }

    const out: Edge[] = [...groups.entries()].map(([key, es]) => {
      const [source, target] = key.split('->')
      const tr = tracedBy.get(key)
      const isChange = es.length > 0 && es.every(x => x.isChange) && !tr
      const followed = followedPairs.has(pairKey(source, target))
      const taint = taintByEdge?.get(key)
      const tainted = !!taint && taint > 0
      const weight = es.length ? Math.max(...es.map(x => Math.log1p(x.amount) / Math.log1p(maxByAsset.get(x.asset) || 1))) : 0.6
      const width = isChange ? 1 : tr ? 2.5 + 2 * Math.min(1, weight) : 1 + 3 * Math.min(1, Math.max(0, weight))
      const color = tainted ? TAINT : tr || followed ? 'rgb(var(--accent))' : isChange ? 'rgb(var(--faint))' : 'rgb(var(--muted))'
      const label = tr
        ? [...tr].map(([asset, amt]) => `${fmtAmount(amt, asset)} traced`).join(' | ')
        : tainted
          ? `${fmtAmount(taint!, es[0]?.asset ?? '')} tainted`
          : es.map(edgeLabel).join(' | ')
      const isSel = selectedEdge === key
      return {
        id: key,
        source,
        target,
        label,
        interactionWidth: 24,
        labelStyle: { fill: tainted ? TAINT : tr ? 'rgb(var(--accent))' : isChange ? 'rgb(var(--faint))' : 'rgb(var(--fg))', fontSize: 11, fontWeight: tr || tainted || isSel ? 600 : 500, cursor: 'pointer' },
        labelBgStyle: { fill: 'rgb(var(--panel))', fillOpacity: 0.95, stroke: isSel ? 'rgb(var(--accent))' : 'none' },
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 2,
        animated: !!tr || followed || tainted,
        zIndex: tr ? 2 : 1,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        style: { stroke: color, strokeWidth: isSel ? width + 1.5 : width, strokeDasharray: isChange ? '5 4' : undefined, opacity: isChange ? 0.5 : 1, cursor: 'pointer' },
      }
    })

    // Individual transactions, fanned out so parallel lines don't overlap
    const byPair = new Map<string, EdgeData[]>()
    for (const e of shownItems) byPair.set(pairKey(e.source, e.target), [...(byPair.get(pairKey(e.source, e.target)) ?? []), e])
    for (const list of byPair.values()) {
      list.sort((x, y) => x.timestamp - y.timestamp)
      list.forEach((e, i) => {
        // Same visual side regardless of direction, so A→B and B→A lines interleave cleanly
        const sign = e.source < e.target ? 1 : -1
        const offset = (i - (list.length - 1) / 2) * 34 * sign
        const date = e.timestamp ? new Date(e.timestamp * 1000).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' }) : 'pending'
        out.push({
          id: `item:${e.id}`,
          source: e.source,
          target: e.target,
          type: 'offset',
          label: `${fmtAmount(e.amount, e.asset)} · ${date}`,
          data: { offset, onSelect: () => onEdgeClick(e.source, e.target) },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'rgb(var(--accent))', width: 12, height: 12 },
          style: { stroke: 'rgb(var(--accent))', strokeWidth: 1.5, opacity: 0.85 },
        })
      })
    }

    // Searched transactions: inputs → tx node → outputs (only for addresses on the graph)
    for (const h of hubs) {
      const id = `tx:${h.txid}`
      const draw = (from: string, to: string, amount: number, asset: string, k: string) =>
        out.push({
          id: `${id}:${k}`,
          source: from,
          target: to,
          label: fmtAmount(amount, asset),
          labelStyle: { fill: 'rgb(var(--fg))', fontSize: 11, fontWeight: 500 },
          labelBgStyle: { fill: 'rgb(var(--panel))', fillOpacity: 0.95 },
          labelBgPadding: [6, 4] as [number, number],
          markerEnd: { type: MarkerType.ArrowClosed, color: 'rgb(var(--muted))', width: 14, height: 14 },
          style: { stroke: 'rgb(var(--muted))', strokeWidth: 1.5, strokeDasharray: '6 3' },
        })
      h.inputs.forEach((i, k) => ids.has(i.address) && draw(i.address, id, i.amount, i.asset, `in${k}`))
      h.outputs.forEach((o, k) => ids.has(o.address) && draw(id, o.address, o.amount, o.asset, `out${k}`))
    }
    return out
  }, [edgeData, nodeData, followedPairs, traced, hubs, itemized, taintByEdge, selectedEdge, onEdgeClick])

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  useEffect(() => {
    if (rawNodes.length === 0) return
    const laid = layoutGraph(rawNodes, rawEdges).map(n => {
      const p = pinned.current.get(n.id)
      return p ? { ...n, position: p } : n
    })
    setNodes(laid)
    setEdges(rawEdges)
    // Refit when nodes are added or removed, not on every data refresh
    if (rawNodes.length !== nodeCount.current) {
      nodeCount.current = rawNodes.length
      // Refit again once new nodes have been measured
      setTimeout(() => rf.current?.fitView(FIT), 60)
      setTimeout(() => rf.current?.fitView({ ...FIT, duration: 250 }), 400)
    }
  }, [rawNodes, rawEdges, setNodes, setEdges])

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false && c.position) pinned.current.set(c.id, c.position)
      }
      onNodesChange(changes)
    },
    [onNodesChange]
  )

  const exportPng = useCallback(async () => {
    const inst = rf.current
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!inst || !viewport) return null
    const bounds = getRectOfNodes(inst.getNodes())
    const w = Math.min(4000, Math.max(1200, bounds.width + 400))
    const h = Math.min(4000, Math.max(800, bounds.height + 400))
    const [x, y, zoom] = getTransformForBounds(bounds, w, h, 0.2, 2)
    const bg = getComputedStyle(document.body).backgroundColor
    return toPng(viewport, {
      backgroundColor: bg,
      width: w,
      height: h,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
    })
  }, [])

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => (n.type === 'tx' ? onHubClick((n.data as TxHubData).txid) : onNodeClick(n.id))}
        onEdgeClick={(_, e) => {
          if (!e.id.startsWith('tx:')) onEdgeClick(e.source, e.target)
        }}
        onInit={inst => {
          rf.current = inst
          onReady?.({ exportPng, fitView: () => inst.fitView(FIT) })
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.05}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="rgb(var(--line))" gap={22} size={1.1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={n => {
            const d = n.data as AddressNodeData
            if (n.type === 'tx') return 'rgb(var(--faint))'
            return d.isOrigin ? 'rgb(var(--accent))' : ENTITY_STYLE[d.label?.type ?? 'unknown'].hex
          }}
          maskColor="rgb(var(--bg) / 0.7)"
          style={{ background: 'rgb(var(--panel))', border: '1px solid rgb(var(--line))' }}
        />
      </ReactFlow>
    </div>
  )
}
