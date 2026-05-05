'use client'

import { useCallback, useEffect, useMemo } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
  FitViewOptions,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { TraceResult, NodeData } from '@/lib/types'
import AddressNode from './AddressNode'

const nodeTypes = { addressNode: AddressNode }

const NODE_W = 185
const NODE_H = 72

function layoutGraph(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 130 })

  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach(e => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target)
    }
  })

  dagre.layout(g)

  return nodes.map(n => {
    const pos = g.node(n.id)
    if (!pos) return n
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } }
  })
}

function fmtAmount(amount: number, chain: 'btc' | 'eth'): string {
  if (chain === 'btc') return `${(amount / 1e8).toFixed(4)} BTC`
  const eth = amount / 1e18
  if (eth === 0) return '0 ETH'
  if (eth < 0.0001) return '<0.0001 ETH'
  return `${eth.toFixed(4)} ETH`
}

const FIT_OPTIONS: FitViewOptions = { padding: 0.25 }

interface Props {
  result: TraceResult
  onNodeClick: (node: NodeData) => void
}

export default function TraceGraph({ result, onNodeClick }: Props) {
  const rawNodes: Node[] = useMemo(
    () =>
      result.nodes.map(n => ({
        id: n.address,
        type: 'addressNode',
        position: { x: 0, y: 0 },
        data: n,
      })),
    [result.nodes]
  )

  const rawEdges: Edge[] = useMemo(
    () =>
      result.edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: fmtAmount(e.amount, e.chain),
        labelStyle: { fill: '#94a3b8', fontSize: 10 },
        labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 },
        labelBgPadding: [4, 6] as [number, number],
        labelBgBorderRadius: 4,
        animated: e.source === result.address || e.target === result.address,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#475569', width: 16, height: 16 },
        style: { stroke: '#475569', strokeWidth: 1.5 },
      })),
    [result.edges, result.address]
  )

  const layoutedNodes = useMemo(() => layoutGraph(rawNodes, rawEdges), [rawNodes, rawEdges])

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges)

  useEffect(() => {
    setNodes(layoutedNodes)
    setEdges(rawEdges)
  }, [layoutedNodes, rawEdges, setNodes, setEdges])

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeClick(node.data as NodeData)
    },
    [onNodeClick]
  )

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT_OPTIONS}
        minZoom={0.05}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="#1e293b" gap={24} size={1.2} />
        <Controls
          style={{ background: '#0f172a', border: '1px solid #1e293b' }}
          showInteractive={false}
        />
        <MiniMap
          nodeColor={(n) => {
            const d = n.data as NodeData
            if (d.isOrigin) return '#22d3ee'
            const t = d.label?.type
            if (t === 'exchange') return '#22c55e'
            if (t === 'scam') return '#ef4444'
            if (t === 'mixer') return '#f97316'
            if (t === 'defi') return '#a855f7'
            return '#475569'
          }}
          maskColor="rgba(2,8,23,0.7)"
          style={{ background: '#0f172a', border: '1px solid #1e293b' }}
        />
      </ReactFlow>
    </div>
  )
}
