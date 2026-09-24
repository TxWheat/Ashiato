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
import { ENTITY_STYLE, fiatValue, fmtAmount } from '@/lib/format'
import AddressNode, { AddressNodeData } from './AddressNode'

const nodeTypes = { addressNode: AddressNode }

const NODE_W = 196
const NODE_H = 78
const FIT = { padding: 0.3 }
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

function edgeLabel(e: EdgeData, prices: Record<string, number>, taint?: number): string {
  const parts = [fmtAmount(e.amount, e.asset) + (e.txCount && e.txCount > 1 ? ` ×${e.txCount}` : '')]
  const fiat = fiatValue(e.amount, e.asset, prices)
  if (fiat > 0) parts.push(`$${Math.round(fiat).toLocaleString('en-NZ')} NZD`)
  if (e.timestamp) parts.push(new Date(e.timestamp * 1000).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' }))
  if (taint) parts.push(`${fmtAmount(taint, e.asset)} tainted`)
  return parts.join(' · ')
}

export interface GraphApi {
  exportPng: () => Promise<string | null>
  fitView: () => void
}

interface Props {
  nodes: AddressNodeData[]
  edges: EdgeData[]
  prices: Record<string, number>
  followedPairs: Set<string>
  taintByEdge?: Map<string, number>
  selected?: string | null
  onNodeClick: (address: string) => void
  onReady?: (api: GraphApi) => void
}

export function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export default function TraceGraph({ nodes: nodeData, edges: edgeData, prices, followedPairs, taintByEdge, selected, onNodeClick, onReady }: Props) {
  const rf = useRef<ReactFlowInstance | null>(null)
  const pinned = useRef<Map<string, { x: number; y: number }>>(new Map())
  const nodeCount = useRef(0)

  const rawNodes: Node[] = useMemo(
    () => nodeData.map(n => ({ id: n.address, type: 'addressNode', position: { x: 0, y: 0 }, data: n, selected: n.address === selected })),
    [nodeData, selected]
  )

  const rawEdges: Edge[] = useMemo(() => {
    const ids = new Set(nodeData.map(n => n.address))
    const visible = edgeData.filter(e => ids.has(e.source) && ids.has(e.target))
    // Orbit-style weighting: width scales with value relative to the largest flow of that asset
    const maxByAsset = new Map<string, number>()
    for (const e of visible) maxByAsset.set(e.asset, Math.max(maxByAsset.get(e.asset) ?? 0, e.amount))

    // Several assets between the same pair (e.g. ETH + USDT) share one drawn edge
    const groups = new Map<string, EdgeData[]>()
    for (const e of visible) {
      const k = `${e.source}->${e.target}`
      groups.set(k, [...(groups.get(k) ?? []), e])
    }

    return [...groups.entries()].map(([key, es]) => {
      const e = es.reduce((a, b) => (b.amount / (maxByAsset.get(b.asset) || 1) > a.amount / (maxByAsset.get(a.asset) || 1) ? b : a))
      const isChange = es.every(x => x.isChange)
      const followed = followedPairs.has(pairKey(e.source, e.target))
      const taint = taintByEdge?.get(key)
      const tainted = !!taint && taint > 0
      const weight = Math.max(...es.map(x => Math.log1p(x.amount) / Math.log1p(maxByAsset.get(x.asset) || 1)))
      const width = isChange ? 1 : 1 + 4 * Math.min(1, Math.max(0, weight))
      const color = tainted ? TAINT : followed ? 'rgb(var(--accent))' : isChange ? 'rgb(var(--faint))' : 'rgb(var(--muted))'
      const label = es.map(x => edgeLabel(x, prices, tainted && x === e ? taint : undefined)).join('  |  ')
      return {
        id: key,
        source: e.source,
        target: e.target,
        label,
        labelStyle: { fill: tainted ? TAINT : isChange ? 'rgb(var(--faint))' : 'rgb(var(--fg))', fontSize: 11, fontWeight: followed || tainted ? 600 : 500 },
        labelBgStyle: { fill: 'rgb(var(--panel))', fillOpacity: 0.95 },
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 2,
        animated: followed || tainted,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        style: { stroke: color, strokeWidth: width, strokeDasharray: isChange ? '5 4' : undefined, opacity: isChange ? 0.5 : 1 },
      }
    })
  }, [edgeData, nodeData, prices, followedPairs, taintByEdge])

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
      setTimeout(() => rf.current?.fitView(FIT), 60)
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
        onNodeClick={(_, n) => onNodeClick(n.id)}
        onInit={inst => {
          rf.current = inst
          onReady?.({ exportPng, fitView: () => inst.fitView(FIT) })
        }}
        nodeTypes={nodeTypes}
        minZoom={0.05}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="rgb(var(--line))" gap={22} size={1.1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={n => {
            const d = n.data as AddressNodeData
            return d.isOrigin ? 'rgb(var(--accent))' : ENTITY_STYLE[d.label?.type ?? 'unknown'].hex
          }}
          maskColor="rgb(var(--bg) / 0.7)"
          style={{ background: 'rgb(var(--panel))', border: '1px solid rgb(var(--line))' }}
        />
      </ReactFlow>
    </div>
  )
}
