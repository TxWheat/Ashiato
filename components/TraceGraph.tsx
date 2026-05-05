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
import { NodeData, EdgeData } from '@/lib/types'
import AddressNode from './AddressNode'

const nodeTypes = { addressNode: AddressNode }

const NODE_W = 185
const NODE_H = 72

function layoutGraph(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 220 })

  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach(e => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  })

  dagre.layout(g)

  return nodes.map(n => {
    const pos = g.node(n.id)
    if (!pos) return { ...n, position: { x: 0, y: 0 } }
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } }
  })
}

function fmtEdgeLabel(
  e: EdgeData,
  prices: { btc: number; eth: number }
): string {
  const parts: string[] = []
  const multi = e.txCount && e.txCount > 1 ? ` (${e.txCount} txs)` : ''

  if (e.chain === 'btc') {
    const btc = e.amount / 1e8
    if (btc > 0) {
      parts.push(`${btc.toFixed(4)} BTC${multi}`)
      if (prices.btc > 0) parts.push(`$${Math.round(btc * prices.btc).toLocaleString('en-NZ')} NZD`)
    }
  } else {
    const eth = e.amount / 1e18
    if (eth > 0) {
      const amt = eth < 0.0001 ? '<0.0001 ETH' : `${eth.toFixed(4)} ETH${multi}`
      parts.push(amt)
      if (prices.eth > 0) parts.push(`$${Math.round(eth * prices.eth).toLocaleString('en-NZ')} NZD`)
    }
  }

  if (e.timestamp) {
    const d = new Date(e.timestamp * 1000)
    parts.push(d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' }))
  }

  return parts.join(' · ')
}

const FIT_OPTIONS: FitViewOptions = { padding: 0.4 }

interface Props {
  nodes: NodeData[]
  edges: EdgeData[]
  originAddress: string
  prices: { btc: number; eth: number }
  followedEdgeIds?: Set<string>
  onNodeClick: (node: NodeData) => void
}

export default function TraceGraph({
  nodes: nodeData,
  edges: edgeData,
  originAddress,
  prices,
  followedEdgeIds = new Set(),
  onNodeClick,
}: Props) {
  const rawNodes: Node[] = useMemo(
    () =>
      nodeData.map(n => ({
        id: n.address,
        type: 'addressNode',
        position: { x: 0, y: 0 },
        data: n,
      })),
    [nodeData]
  )

  const nodeIdSet = useMemo(() => new Set(nodeData.map(n => n.address)), [nodeData])

  const rawEdges: Edge[] = useMemo(
    () =>
      edgeData
        .filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
        .map(e => {
          const isFollowed = followedEdgeIds.has(e.id)
          const isOriginEdge = e.source === originAddress || e.target === originAddress

          return {
            id: e.id,
            source: e.source,
            target: e.target,
            label: fmtEdgeLabel(e, prices),
            labelStyle: {
              fill: e.isChange ? '#a16207' : isFollowed ? '#22d3ee' : '#cbd5e1',
              fontSize: 11,
              fontWeight: isFollowed ? 700 : 500,
            },
            labelBgStyle: { fill: '#0f172a', fillOpacity: 0.95 },
            labelBgPadding: [6, 8] as [number, number],
            labelBgBorderRadius: 4,
            // Animate: followed edges always, origin edges if not change
            animated: isFollowed || (!e.isChange && isOriginEdge),
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: e.isChange ? '#422006' : isFollowed ? '#22d3ee' : '#475569',
              width: 16,
              height: 16,
            },
            style: {
              stroke: e.isChange ? '#422006' : isFollowed ? '#22d3ee' : '#475569',
              strokeWidth: isFollowed ? 2 : e.isChange ? 1 : 1.5,
              strokeDasharray: e.isChange ? '5 4' : undefined,
              opacity: e.isChange ? 0.35 : 1,
            },
          }
        }),
    [edgeData, nodeIdSet, originAddress, prices, followedEdgeIds]
  )

  const layoutedNodes = useMemo(() => layoutGraph(rawNodes, rawEdges), [rawNodes, rawEdges])

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges)

  useEffect(() => {
    setNodes(prev => {
      const existingPos = new Map(prev.map(n => [n.id, n.position]))
      return layoutGraph(rawNodes, rawEdges).map(n => ({
        ...n,
        position: existingPos.get(n.id) ?? n.position,
      }))
    })
    setEdges(rawEdges)
  }, [rawNodes, rawEdges, setNodes, setEdges])

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => onNodeClick(node.data as NodeData),
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
