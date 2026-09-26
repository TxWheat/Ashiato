'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  ReactFlowInstance,
  getRectOfNodes,
  getTransformForBounds,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { toPng } from 'html-to-image'
import { EdgeData } from '@/lib/types'
import type { CollapsedChain } from '@/lib/collapse'
import { TracedFlow } from '@/lib/follow'
import { ENTITY_STYLE, fiatValue, fmtCompact, fmtDateTime, fmtDay, fmtFiatShort, topAssets } from '@/lib/format'
import AddressNode, { AddressNodeData, TxNode, TxHubData } from './AddressNode'
import { NodeAction, NodeMenuContext } from './NodeMenu'
import LabelEdge from './OffsetEdge'

const nodeTypes = { addressNode: AddressNode, tx: TxNode }
const edgeTypes = { label: LabelEdge }

const NODE_W = 196
const NODE_H = 78
const FIT = { padding: 0.3, maxZoom: 1.1 }
const TAINT = '#ef4444'

/**
 * Slim notched arrowheads at a fixed on-screen size (reactflow's built-in markers
 * scale with line width, so thick lines got huge heads). Referenced by id.
 */
/** Cross-chain swaps: money leaves one chain and arrives on another */
const BRIDGE = '#f97316'

const ARROWS = {
  accent: 'rgb(var(--accent))',
  muted: 'rgb(var(--muted))',
  faint: 'rgb(var(--faint))',
  taint: TAINT,
  bridge: BRIDGE,
} as const
const arrowFor = (k: keyof typeof ARROWS) => `ct-arrow-${k}`

function ArrowDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {Object.entries(ARROWS).map(([k, c]) => (
          <marker key={k} id={arrowFor(k as keyof typeof ARROWS)} viewBox="0 0 12 12" refX="10" refY="6"
            markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M1,1.5 L11,6 L1,10.5 L3.5,6 Z" style={{ fill: c }} />
          </marker>
        ))}
      </defs>
    </svg>
  )
}

function layoutGraph(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 240 })
  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach(e => {
    // Collapsed chains get a longer line so their summary label fits
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target, e.id.startsWith('chain:') ? { minlen: 2 } : {})
  })
  dagre.layout(g)
  return nodes.map(n => {
    const pos = g.node(n.id)
    return pos ? { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } } : n
  })
}

export type XY = { x: number; y: number }



/**
 * Nodes already on screen stay exactly where they are (whether auto-placed or
 * dragged). A new node goes next to a neighbour that's already placed, keeping
 * the offset dagre would give it, then steps down until it overlaps nothing.
 * `placed` is updated with every final position.
 */
/** One collapsed chain drawn as a single line: this far from its start to its end */
const CHAIN_SPAN = NODE_W + 380
/** One hop when a chain is expanded (dagre's rank spacing) */
const HOP_SPAN = NODE_W + 240

/** Addresses after `start` (following money forward), never going back left of `floorX` */
function downstream(start: string, edges: Edge[], placed: Map<string, XY>, floorX: number, stop: string): string[] {
  const out = new Map<string, string[]>()
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target])
  const seen = new Set([start])
  const queue = [start]
  while (queue.length) {
    for (const n of out.get(queue.shift()!) ?? []) {
      if (seen.has(n) || n === stop) continue
      const p = placed.get(n)
      if (!p || p.x <= floorX) continue
      seen.add(n)
      queue.push(n)
    }
  }
  return [...seen]
}

/**
 * Keep collapsed chains compact without re-laying out the graph: when a chain collapses, its
 * end and everything after it slide left to sit one line after the start; when it expands,
 * they slide back (or, for a chain that started collapsed, right by enough room for its hops).
 */
function compactChains(chains: CollapsedChain[], edges: Edge[], placed: Map<string, XY>, prev: Map<string, CollapsedChain>, shifts: Map<string, number>) {
  const now = new Set(chains.map(c => c.id))
  const move = (ids: string[], dx: number) => {
    for (const id of ids) {
      const p = placed.get(id)
      if (p) placed.set(id, { x: p.x + dx, y: p.y })
    }
  }
  // Expanded: make room again
  for (const [id, c] of prev) {
    if (now.has(id)) continue
    const a = placed.get(c.from), b = placed.get(c.to)
    if (!a || !b) continue
    const dx = shifts.get(id) !== undefined ? -shifts.get(id)! : Math.max(0, a.x + (c.middle.length + 1) * HOP_SPAN - b.x)
    shifts.delete(id)
    if (dx > 1) move(downstream(c.to, edges, placed, a.x, c.from), dx)
  }
  // Newly collapsed: pull the end in
  for (const c of chains) {
    if (prev.has(c.id)) continue
    const a = placed.get(c.from), b = placed.get(c.to)
    if (!a || !b) continue
    const dx = a.x + CHAIN_SPAN - b.x
    if (dx < -1) {
      move(downstream(c.to, edges, placed, a.x, c.from), dx)
      shifts.set(c.id, dx)
    }
  }
}

function placeNodes(laid: Node[], edges: Edge[], placed: Map<string, XY>): Node[] {
  const auto = new Map(laid.map(n => [n.id, n.position]))
  const neighbours = new Map<string, string[]>()
  for (const e of edges) {
    neighbours.set(e.source, [...(neighbours.get(e.source) ?? []), e.target])
    neighbours.set(e.target, [...(neighbours.get(e.target) ?? []), e.source])
  }
  // Fallback shift for new nodes with no placed neighbour: how far placed nodes sit from their auto spot
  const kept = laid.filter(n => placed.has(n.id))
  const shift = kept.length
    ? kept.reduce((d, n) => ({ x: d.x + (placed.get(n.id)!.x - n.position.x) / kept.length, y: d.y + (placed.get(n.id)!.y - n.position.y) / kept.length }), { x: 0, y: 0 })
    : { x: 0, y: 0 }

  const final = new Map<string, XY>()
  for (const n of kept) final.set(n.id, placed.get(n.id)!)
  const clear = (p: XY) =>
    [...final.values()].every(q => Math.abs(q.x - p.x) >= NODE_W + 30 || Math.abs(q.y - p.y) >= NODE_H + 24)
  // A fresh graph (nothing on the canvas yet) takes the automatic layout as is
  if (final.size === 0) {
    for (const n of laid) placed.set(n.id, n.position)
    return laid
  }
  const outgoing = new Set(edges.map(e => `${e.source}>${e.target}`))
  // New nodes go in the column next to a node already on the canvas (right if money flows to
  // them, left if it comes from them), in the nearest free row, so they never land on existing
  // nodes. Only nodes with nothing placed around them fall back to the automatic layout.
  // Nodes nearest the existing graph go first, so a traced chain grows outwards step by step.
  const pending = laid.filter(n => !final.has(n.id))
  for (let guard = 0; pending.length && guard < 10_000; guard++) {
    const i = pending.findIndex(n => (neighbours.get(n.id) ?? []).some(id => final.has(id)))
    const n = pending.splice(i >= 0 ? i : 0, 1)[0]
    const anchor = (neighbours.get(n.id) ?? []).find(id => final.has(id))
    const me = auto.get(n.id)!
    let pos: XY
    if (anchor) {
      const a = final.get(anchor)!
      const dir = outgoing.has(`${anchor}>${n.id}`) ? 1 : outgoing.has(`${n.id}>${anchor}`) ? -1 : me.x >= auto.get(anchor)!.x ? 1 : -1
      const x = a.x + dir * (NODE_W + 240)
      pos = { x, y: a.y }
      for (let k = 1; k < 80 && !clear(pos); k++) {
        // 0, +1, -1, +2, -2 … rows away from the anchor's row
        const step = Math.ceil(k / 2) * (k % 2 ? 1 : -1)
        pos = { x, y: a.y + step * (NODE_H + 24) }
      }
    } else {
      pos = { x: me.x + shift.x, y: me.y + shift.y }
      for (let k = 0; k < 60 && !clear(pos); k++) pos = { x: pos.x, y: pos.y + NODE_H + 24 }
    }
    final.set(n.id, pos)
  }
  for (const [id, p] of final) placed.set(id, p)
  return laid.map(n => ({ ...n, position: final.get(n.id)! }))
}

/** "2.15K USDT ($2.9K NZD)" */
function amountWithValue(amount: number, asset: string, prices: Record<string, number>): string {
  const fiat = fmtFiatShort(fiatValue(amount, asset, prices))
  return `${fmtCompact(amount, asset)}${fiat ? ` (${fiat} NZD)` : ''}`
}

/** "2.15K USDT ($2.9K NZD) + 1.2 ETH ($5.4K NZD) +3 tokens · 29 txs" */
function relationshipLabel(es: EdgeData[], prices: Record<string, number>, txs: number): string {
  const { shown, rest } = topAssets(es.map(x => [x.asset, x.amount] as [string, number]), prices)
  const parts = shown.map(([asset, amt]) => amountWithValue(amt, asset, prices)).join(' + ')
  return `${parts}${rest ? ` +${rest} token${rest === 1 ? '' : 's'}` : ''}${txs > 1 ? ` · ${txs} txs` : ''}`
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
  prices: Record<string, number>
  taintByEdge?: Map<string, number>
  selected?: string | null
  selectedEdge?: string | null
  selectedHub?: string | null
  onNodeClick: (address: string) => void
  onEdgeClick: (from: string, to: string) => void
  onHubClick: (txid: string) => void
  /** Click on empty canvas: deselect (collapses the side panel) */
  onPaneClick?: () => void
  /** Where each node sits (auto-placed or dragged). Owned by the page so a saved chart keeps its layout. */
  positions: Map<string, XY>
  /** The user moved nodes (so the saved case needs updating) */
  onLayoutChange?: () => void
  /** Long pass-through runs drawn as one line (the middle addresses are hidden) */
  chains?: CollapsedChain[]
  onChainClick?: (id: string) => void
  /** Changing this re-tidies the whole layout (e.g. when chains collapse or expand) */
  layoutKey?: string
  onReady?: (api: GraphApi) => void
  /** Cross-chain hops: from the swap service's node to where the money came out */
  bridges?: BridgeLine[]
  onBridgeClick?: (id: string) => void
  /** Changes when nodes appear or vanish because of a view toggle (collapsing chains): keep the zoom */
  quietKey?: number
  /** Quick actions shown around a clicked node; without this, clicks go straight to onNodeClick */
  onNodeAction?: (address: string, action: NodeAction) => void
}

export interface BridgeLine { id: string; from: string; to: string; line1: string; line2: string }

function stylesheetsReadable() {
  try {
    for (const sheet of Array.from(document.styleSheets)) void sheet.cssRules
    return true
  } catch {
    return false
  }
}

export function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export default function TraceGraph({ nodes: nodeData, edges: edgeData, followedPairs, traced, hubs, itemized, prices, taintByEdge, selected, selectedEdge, selectedHub, onNodeClick, onEdgeClick, onHubClick, onPaneClick, positions, onLayoutChange, chains = [], onChainClick, layoutKey, onReady, bridges = [], onBridgeClick, quietKey, onNodeAction }: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const menu = useMemo(() => onNodeAction
    ? { openFor: menuFor, act: (a: string, action: NodeAction) => { setMenuFor(null); onNodeAction(a, action) } }
    : null, [menuFor, onNodeAction])
  const rf = useRef<ReactFlowInstance | null>(null)
  // Where every node sits: auto-placed or dragged. Kept stable as nodes are added.
  const pinned = useRef(positions)
  pinned.current = positions
  const nodeCount = useRef(0)
  /** Node ids on the canvas last time, to tell what was just added */
  const shownIds = useRef(new Set<string>())
  const lastQuiet = useRef(quietKey)
  /** Collapsed chains last time, and how far each one's end (and everything after it) was slid in */
  const prevChains = useRef(new Map<string, CollapsedChain>())
  const chainsRef = useRef(chains)
  chainsRef.current = chains
  const chainsKey = chains.map(c => c.id).sort().join(',')
  const chainShift = useRef(new Map<string, number>())

  // Highlight the selected address's counterparties: green paid it, red were paid by it
  const relation = useMemo(() => {
    const m = new Map<string, 'in' | 'out' | 'both'>()
    if (!selected) return m
    for (const e of edgeData) {
      const other: string | null = e.target === selected ? e.source : e.source === selected ? e.target : null
      if (!other || other === selected) continue
      const r: 'in' | 'out' = e.target === selected ? 'in' : 'out'
      const ex = m.get(other)
      m.set(other, ex && ex !== r ? 'both' : r)
    }
    return m
  }, [edgeData, selected])

  // Newly added addresses pulse for a few seconds so they're easy to spot
  const seenIds = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const freshTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => {
    const ids = nodeData.map(n => n.address)
    if (!seenIds.current) {
      seenIds.current = new Set(ids)
      return
    }
    const added = ids.filter(id => !seenIds.current!.has(id))
    for (const id of ids) seenIds.current.add(id)
    if (!added.length) return
    setFresh(prev => new Set([...prev, ...added]))
    // Not cleared when nodeData changes again (labels and pages keep arriving); only on unmount
    freshTimers.current.push(setTimeout(() => setFresh(prev => new Set([...prev].filter(id => !added.includes(id)))), 3500))
  }, [nodeData])
  useEffect(() => () => freshTimers.current.forEach(clearTimeout), [])

  const rawNodes: Node[] = useMemo(
    () => [
      ...nodeData.map(n => ({
        id: n.address, type: 'addressNode', position: { x: 0, y: 0 }, selected: n.address === selected,
        data: { ...n, view: { ...n.view, relation: relation.get(n.address), fresh: fresh.has(n.address) } },
      })),
      ...hubs.map(h => ({ id: `tx:${h.txid}`, type: 'tx', position: { x: 0, y: 0 }, data: h, selected: h.txid === selectedHub })),
    ],
    [nodeData, hubs, selected, selectedHub, relation, fresh]
  )

  const rawEdges: Edge[] = useMemo(() => {
    const ids = new Set(nodeData.map(n => n.address))
    const visible = edgeData.filter(e => ids.has(e.source) && ids.has(e.target))
    // Orbit-style weighting: width scales with value relative to the largest flow of that asset
    const maxByAsset = new Map<string, number>()
    for (const e of visible) maxByAsset.set(e.asset, Math.max(maxByAsset.get(e.asset) ?? 0, e.amount))

    // Traced amounts per directed pair and asset
    const tracedBy = new Map<string, Map<string, number>>()
    // Lowest pool share seen on each traced pair (pooling made visible on the line)
    const pooledBy = new Map<string, number>()
    // Traced funds swapped on this line (e.g. SHIB sold to a DEX for ETH): what came back
    const swappedBy = new Map<string, Map<string, number>>()
    for (const f of traced) {
      if (!ids.has(f.from) || !ids.has(f.to)) continue
      const k = `${f.from}->${f.to}`
      const m = tracedBy.get(k) ?? new Map<string, number>()
      m.set(f.asset, (m.get(f.asset) ?? 0) + f.amount)
      tracedBy.set(k, m)
      if (f.share !== undefined) pooledBy.set(k, Math.min(pooledBy.get(k) ?? 1, f.share))
      if (f.swap) {
        const m = swappedBy.get(k) ?? new Map<string, number>()
        m.set(f.swap.asset, (m.get(f.swap.asset) ?? 0) + f.swap.amount)
        swappedBy.set(k, m)
      }
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
      // Shown as individual transactions: those replace the relationship (or traced) line
      if (itemizedPairs.has(pairKey(a, b))) groups.delete(k)
    }

    const out: Edge[] = [...groups.entries()].map(([key, es]) => {
      const [source, target] = key.split('->')
      const tr = tracedBy.get(key)
      const isChange = es.length > 0 && es.every(x => x.isChange) && !tr
      const followed = followedPairs.has(pairKey(source, target))
      const taint = taintByEdge?.get(key)
      const tainted = !!taint && taint > 0
      const weight = es.length ? Math.max(...es.map(x => Math.log1p(x.amount) / Math.log1p(maxByAsset.get(x.asset) || 1))) : 0.6
      // Change keeps its value-based width (it can be most of the money), drawn dashed
      const width = tr ? 2.5 + 2 * Math.min(1, weight) : 1 + 3 * Math.min(1, Math.max(0, weight))
      const color = tainted ? TAINT : tr || followed ? 'rgb(var(--accent))' : isChange ? 'rgb(var(--faint))' : 'rgb(var(--muted))'
      // Breadcrumbs-style label written along the line: amount (value) · count, then dates
      const txs = es.reduce((n, x) => n + (x.txCount ?? 1), 0)
      const first = Math.min(...es.map(x => x.firstTimestamp || x.timestamp).filter(Boolean))
      const last = Math.max(...es.map(x => x.timestamp))
      const line1 = tr
        ? `${[...tr].map(([asset, amt]) => `${fmtCompact(amt, asset)} traced`).join(' | ')}${swappedBy.has(key) ? ` · swapped for ${[...swappedBy.get(key)!].map(([a, v]) => fmtCompact(v, a)).join(' + ')}` : ''}${pooledBy.has(key) ? ` · ${pooledBy.get(key)! > 0 && pooledBy.get(key)! < 0.01 ? '<1' : Math.round(pooledBy.get(key)! * 100)}% of pool` : ''}`
        : tainted
          ? `${fmtCompact(taint!, es[0]?.asset ?? '')} tainted`
          : `${relationshipLabel(es, prices, txs)}${isChange ? ' · likely change' : ''}`
      const line2 = !es.length ? '' : txs === 1 ? fmtDateTime(last) : isFinite(first) && fmtDay(first) !== fmtDay(last) ? `${fmtDay(first)} → ${fmtDay(last)}` : fmtDay(last)
      const isSel = selectedEdge === key
      return {
        id: key,
        source,
        target,
        type: 'label',
        // Money flowing both ways: bow the two lines apart (opposite sides) so labels don't stack
        data: { offset: groups.has(`${target}->${source}`) ? 26 : 0, line1, line2, color: tainted ? TAINT : tr ? 'rgb(var(--accent))' : isChange ? 'rgb(var(--faint))' : 'rgb(var(--fg))', bold: !!tr || tainted || isSel, glow: !!tr || tainted },
        zIndex: tr ? 2 : 1,
        markerEnd: arrowFor(tainted ? 'taint' : tr || followed ? 'accent' : isChange ? 'faint' : 'muted'),
        style: { stroke: color, strokeWidth: isSel ? width + 1.5 : width, strokeDasharray: isChange ? '5 4' : undefined, opacity: isChange ? 0.85 : 1, cursor: 'pointer' },
      }
    })

    // Individual transactions, fanned out so parallel lines don't overlap. One the trace
    // follows keeps the traced look, since it replaces the traced line.
    const tracedTx = new Set(traced.map(f => `${f.txid}|${f.from}->${f.to}`))
    const byPair = new Map<string, EdgeData[]>()
    for (const e of shownItems) byPair.set(pairKey(e.source, e.target), [...(byPair.get(pairKey(e.source, e.target)) ?? []), e])
    for (const list of byPair.values()) {
      list.sort((x, y) => x.timestamp - y.timestamp)
      list.forEach((e, i) => {
        // Same visual side regardless of direction, so A→B and B→A lines interleave cleanly
        const sign = e.source < e.target ? 1 : -1
        const offset = (i - (list.length - 1) / 2) * 48 * sign
        const isTraced = (e.txids ?? [e.txid]).some(t => tracedTx.has(`${t}|${e.source}->${e.target}`))
        out.push({
          id: `item:${e.id}`,
          source: e.source,
          target: e.target,
          type: 'label',
          data: {
            offset, parallel: true, line2: fmtDateTime(e.timestamp), color: 'rgb(var(--accent))',
            line1: isTraced ? `${fmtCompact(e.amount, e.asset)} traced` : amountWithValue(e.amount, e.asset, prices),
            bold: isTraced, glow: isTraced,
          },
          zIndex: isTraced ? 2 : 1,
          markerEnd: arrowFor('accent'),
          style: { stroke: 'rgb(var(--accent))', strokeWidth: isTraced ? 3.5 : 1.5, opacity: isTraced ? 1 : 0.85, cursor: 'pointer' },
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
          type: 'label',
          data: { line1: amountWithValue(amount, asset, prices) },
          markerEnd: arrowFor('muted'),
          style: { stroke: 'rgb(var(--muted))', strokeWidth: 1.5, strokeDasharray: '6 3' },
        })
      h.inputs.forEach((i, k) => ids.has(i.address) && draw(i.address, id, i.amount, i.asset, `in${k}`))
      h.outputs.forEach((o, k) => ids.has(o.address) && draw(id, o.address, o.amount, o.asset, `out${k}`))
    }

    // Collapsed chains: one thick line standing in for many hops
    for (const c of chains) {
      if (!ids.has(c.from) || !ids.has(c.to)) continue
      const amt = c.firstAmount && Math.abs(c.firstAmount - c.lastAmount) > c.firstAmount * 0.001
        ? `${fmtCompact(c.firstAmount, c.asset)} → ${fmtCompact(c.lastAmount, c.asset)}`
        : fmtCompact(c.lastAmount, c.asset)
      out.push({
        id: `chain:${c.id}`,
        source: c.from,
        target: c.to,
        type: 'label',
        data: {
          line1: `${c.hops} hops · ${amt}${c.peels ? ` · ${c.peels} peel${c.peels === 1 ? '' : 's'}` : ''}`,
          line2: `${c.firstTime ? (fmtDay(c.firstTime) === fmtDay(c.lastTime) ? fmtDay(c.lastTime) : `${fmtDay(c.firstTime)} → ${fmtDay(c.lastTime)}`) + ' · ' : ''}click to expand`,
          color: 'rgb(var(--accent))',
          bold: true,
          glow: true,
          noArrowText: true,
        },
        zIndex: 3,
        markerEnd: arrowFor('accent'),
        style: { stroke: 'rgb(var(--accent))', strokeWidth: 3.5, strokeLinecap: 'round', cursor: 'pointer' },
      })
    }
    // Cross-chain swaps: dashed orange, like a bridge between the two chains
    const perTarget = new Map<string, number>()
    for (const b of bridges) {
      if (!ids.has(b.from) || !ids.has(b.to)) continue
      // Several lines into one destination: bow the extra ones out so they don't overlap
      const k = perTarget.get(b.to) ?? 0
      perTarget.set(b.to, k + 1)
      out.push({
        id: `bridge:${b.id}`,
        source: b.from,
        target: b.to,
        type: 'label',
        data: { offset: k ? 90 * Math.ceil(k / 2) * (k % 2 ? -1 : 1) : 0, line1: b.line1, line2: b.line2, color: BRIDGE, bold: true, glow: true },
        zIndex: 3,
        markerEnd: arrowFor('bridge'),
        style: { stroke: BRIDGE, strokeWidth: 3, strokeDasharray: '8 5', cursor: 'pointer' },
      })
    }
    return out
  }, [edgeData, nodeData, followedPairs, traced, hubs, itemized, prices, taintByEdge, selectedEdge, chains, bridges])

  // A new layoutKey re-tidies everything: forget positions so dagre lays the graph out afresh
  const lastLayoutKey = useRef(layoutKey)
  if (lastLayoutKey.current !== layoutKey) {
    lastLayoutKey.current = layoutKey
    pinned.current.clear()
    nodeCount.current = -1 // forces a refit
  }

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  useEffect(() => {
    if (rawNodes.length === 0) return
    compactChains(chainsRef.current, rawEdges, pinned.current, prevChains.current, chainShift.current)
    prevChains.current = new Map(chainsRef.current.map(c => [c.id, c]))
    const laid = placeNodes(layoutGraph(rawNodes, rawEdges), rawEdges, pinned.current)
    setNodes(laid)
    setEdges(rawEdges)
    // Refit on first draw and after a re-layout. Otherwise keep the user's zoom: removing
    // nodes never moves the view, and added nodes only refit when they land off-screen.
    const firstOrRelayout = nodeCount.current <= 0
    const quiet = lastQuiet.current !== quietKey
    lastQuiet.current = quietKey
    const added = laid.filter(n => !shownIds.current.has(n.id))
    nodeCount.current = rawNodes.length
    shownIds.current = new Set(laid.map(n => n.id))
    if (firstOrRelayout) {
      // Refit again once new nodes have been measured
      setTimeout(() => rf.current?.fitView(FIT), 60)
      setTimeout(() => rf.current?.fitView({ ...FIT, duration: 250 }), 400)
    } else if (added.length && !quiet) {
      setTimeout(() => {
        const inst = rf.current
        const el = document.querySelector('.react-flow')
        if (!inst || !el) return
        const { x, y, zoom } = inst.getViewport()
        const w = el.clientWidth, h = el.clientHeight
        const offscreen = added.some(n => {
          const sx = n.position.x * zoom + x, sy = n.position.y * zoom + y
          return sx < 0 || sy < 0 || sx + 200 * zoom > w || sy + 60 * zoom > h
        })
        // Pan to what was added, keeping the user's zoom (fitting everything zoomed right out)
        if (offscreen) {
          const xs = added.map(n => n.position.x), ys = added.map(n => n.position.y)
          const cx = (Math.min(...xs) + Math.max(...xs) + 200) / 2, cy = (Math.min(...ys) + Math.max(...ys) + 60) / 2
          inst.setCenter(cx, cy, { zoom, duration: 300 })
        }
      }, 120)
    }
  }, [rawNodes, rawEdges, setNodes, setEdges, layoutKey, quietKey, chainsKey])

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        // Remember where the user put a node; the final drag event can omit the position
        if (c.type === 'position' && c.position) pinned.current.set(c.id, c.position)
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
      // html-to-image reads every stylesheet to embed fonts; an unreadable one
      // (cross-origin without CORS, or failed to load) raises SecurityError
      skipFonts: !stylesheetsReadable(),
      width: w,
      height: h,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
    })
  }, [])

  return (
    <NodeMenuContext.Provider value={menu}>
    <div className="w-full h-full">
      <ArrowDefs />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        // A click with a tiny hand movement is a click, not a drag
        nodeDragThreshold={5}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={(_, node, dragged) => {
          for (const n of dragged?.length ? dragged : [node]) pinned.current.set(n.id, n.position)
          onLayoutChange?.()
        }}
        onNodeClick={(_, n) => {
          if (n.type === 'tx') return onHubClick((n.data as TxHubData).txid)
          if (onNodeAction) setMenuFor(v => (v === n.id ? null : n.id))
          onNodeClick(n.id)
        }}
        onNodeDragStart={() => setMenuFor(null)}
        // Like Breadcrumbs: zooming or panning closes the node menu (it doesn't scale with the graph)
        // (onMove, not onMoveStart: a mouse-down alone counts as a move start, and would close
        // the menu before its buttons get the click)
        onMove={() => setMenuFor(v => (v === null ? v : null))}
        onPaneClick={() => { setMenuFor(null); onPaneClick?.() }}
        onEdgeClick={(_, e) => {
          setMenuFor(null)
          if (e.id.startsWith('chain:')) onChainClick?.(e.id.slice(6))
          else if (e.id.startsWith('bridge:')) onBridgeClick?.(e.id.slice(7))
          else if (!e.id.startsWith('tx:')) onEdgeClick(e.source, e.target)
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
    </NodeMenuContext.Provider>
  )
}
