'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Node,
  Edge,
  NodeChange,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  ReactFlowInstance,
  getRectOfNodes,
  getTransformForBounds,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { toPng } from 'html-to-image'
import { EdgeData } from '@/lib/types'
import type { CollapsedChain } from '@/lib/collapse'
import { TracedFlow } from '@/lib/follow'
import { layoutGraph, NODE_W, placeNodes, tidyLayout, type XY } from '@/lib/layout'
import { ENTITY_STYLE, fmtCompact, fmtDateTime, fmtDay, fmtFiatShort, topAssets } from '@/lib/format'
import AddressNode, { AddressNodeData, TxNode, TxHubData } from './AddressNode'
import { NodeAction, NodeMenuContext } from './NodeMenu'
import LabelEdge from './OffsetEdge'
import { CurrencyCode } from '@/lib/currency'
import { useSettings } from './Settings'
import { Annotation, ANNOTATION_SIZE, NOTE_PREFIX } from '@/lib/annotations'
import { AnnotationContext, AnnotationNode, GraphTools } from './Annotations'
import { edgeValue, Pricing, valueAt } from '@/lib/prices'
import { usePricing } from './Pricing'

const nodeTypes = { addressNode: AddressNode, tx: TxNode, annotation: AnnotationNode }
const edgeTypes = { label: LabelEdge }

const FIT = { padding: 0.3, maxZoom: 1.1 }

/** Cross-chain swaps: money leaves one chain and arrives on another */
const BRIDGE = '#f97316'

/**
 * Slim notched arrowheads at a fixed on-screen size (reactflow's built-in markers
 * scale with line width, so thick lines got huge heads). Referenced by id.
 */
const ARROWS = {
  accent: 'rgb(var(--accent))',
  muted: 'rgb(var(--muted))',
  faint: 'rgb(var(--faint))',
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

export type { XY } from '@/lib/layout'

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

/** "2.15K USDT ($2.9K NZD)" */
function amountWithValue(amount: number, asset: string, value: number, currency: CurrencyCode): string {
  const fiat = fmtFiatShort(value, currency)
  return `${fmtCompact(amount, asset)}${fiat ? ` (${fiat})` : ''}`
}

/** "2.15K USDT ($2.9K NZD) + 1.2 ETH ($5.4K NZD) +3 tokens · 29 txs" */
function relationshipLabel(es: EdgeData[], prices: Record<string, number>, txs: number, currency: CurrencyCode, pricing: Pricing): string {
  const { shown, rest } = topAssets(es.map(x => [x.asset, x.amount] as [string, number]), prices)
  // Each transaction is valued at its own time (or today's price, per Settings)
  const value = (asset: string) => es.filter(x => x.asset === asset).reduce((v, x) => v + edgeValue(pricing, x), 0)
  const parts = shown.map(([asset, amt]) => amountWithValue(amt, asset, value(asset), currency)).join(' + ')
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
  selected?: string | null
  /** The selected link, as `pairKey(a, b)` (either direction) */
  selectedEdge?: string | null
  selectedHub?: string | null
  onNodeClick: (address: string) => void
  onEdgeClick: (from: string, to: string) => void
  onHubClick: (txid: string) => void
  /** Click on empty canvas: deselect (collapses the side panel) */
  onPaneClick?: () => void
  /** Where each node sits (auto-placed or dragged). Owned by the page so a saved chart keeps its layout. */
  positions: Map<string, XY>
  /** Addresses the user dragged: they keep their spot when an auto trace tidies the graph */
  moved: Set<string>
  /** Changes each time an auto trace adds to the graph: the whole graph is tidied then */
  tidyKey?: number
  /** The user moved nodes (so the saved case needs updating) */
  onLayoutChange?: () => void
  /** Long pass-through runs drawn as one line (the middle addresses are hidden) */
  chains?: CollapsedChain[]
  onChainClick?: (id: string) => void
  onReady?: (api: GraphApi) => void
  /** Cross-chain hops: from the swap service's node to where the money came out */
  bridges?: BridgeLine[]
  onBridgeClick?: (id: string) => void
  /** Changes when nodes appear or vanish because of a view toggle (collapsing chains): keep the zoom */
  quietKey?: number
  /** Quick actions shown around a clicked node; without this, clicks go straight to onNodeClick */
  onNodeAction?: (address: string, action: NodeAction) => void
  /** Addresses with watch alerts on (shown in the node menu) */
  watched?: Set<string>
  /** Shapes and text drawn on the graph (saved with the case) */
  annotations?: Annotation[]
  onAnnotations?: (next: Annotation[]) => void
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

export default function TraceGraph({ nodes: nodeData, edges: edgeData, followedPairs, traced, hubs, itemized, prices, selected, selectedEdge, selectedHub, onNodeClick, onEdgeClick, onHubClick, onPaneClick, positions, moved, tidyKey, onLayoutChange, chains = [], onChainClick, onReady, bridges = [], onBridgeClick, quietKey, onNodeAction, watched, annotations = [], onAnnotations }: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const { currency } = useSettings()
  const pricing = usePricing()
  const menu = useMemo(() => onNodeAction
    ? { openFor: menuFor, act: (a: string, action: NodeAction) => { setMenuFor(null); onNodeAction(a, action) }, watched }
    : null, [menuFor, onNodeAction, watched])
  const rf = useRef<ReactFlowInstance | null>(null)
  // Where every node sits (laid out, or dragged by the user)
  const pinned = useRef(positions)
  pinned.current = positions
  /** The traced trail, read when placing new nodes (a trace also changes the nodes, which re-runs placement) */
  const tracedRef = useRef(traced)
  tracedRef.current = traced
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
  /** The auto trace that last tidied the graph */
  const lastTidy = useRef(tidyKey)

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
    const tracedValue = new Map<string, Map<string, number>>()
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
      const mv = tracedValue.get(k) ?? new Map<string, number>()
      mv.set(f.asset, (mv.get(f.asset) ?? 0) + valueAt(pricing, f.amount, f.asset, f.time))
      tracedValue.set(k, mv)
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
      const weight = es.length ? Math.max(...es.map(x => Math.log1p(x.amount) / Math.log1p(maxByAsset.get(x.asset) || 1))) : 0.6
      // Change keeps its value-based width (it can be most of the money), drawn dashed
      const width = tr ? 2.5 + 2 * Math.min(1, weight) : 1 + 3 * Math.min(1, Math.max(0, weight))
      const color = tr || followed ? 'rgb(var(--accent))' : isChange ? 'rgb(var(--faint))' : 'rgb(var(--muted))'
      // Breadcrumbs-style label written along the line: amount (value) · count, then dates
      const txs = es.reduce((n, x) => n + (x.txCount ?? 1), 0)
      const first = Math.min(...es.map(x => x.firstTimestamp || x.timestamp).filter(Boolean))
      const last = Math.max(...es.map(x => x.timestamp))
      const line1 = tr
        ? `${[...tr].map(([asset, amt]) => {
          const fiat = fmtFiatShort(tracedValue.get(key)?.get(asset) ?? 0, currency)
          return `${fmtCompact(amt, asset)} traced${fiat ? ` (${fiat})` : ''}`
        }).join(' | ')}${swappedBy.has(key) ? ` · swapped for ${[...swappedBy.get(key)!].map(([a, v]) => fmtCompact(v, a)).join(' + ')}` : ''}${pooledBy.has(key) ? ` · ${pooledBy.get(key)! > 0 && pooledBy.get(key)! < 0.01 ? '<1' : Math.round(pooledBy.get(key)! * 100)}% of pool` : ''}`
        : `${relationshipLabel(es, prices, txs, currency, pricing)}${isChange ? ' · likely change' : ''}`
      const line2 = !es.length ? '' : txs === 1 ? fmtDateTime(last) : isFinite(first) && fmtDay(first) !== fmtDay(last) ? `${fmtDay(first)} → ${fmtDay(last)}` : fmtDay(last)
      // The side panel shows both directions of a pair, so both lines highlight
      const isSel = selectedEdge === pairKey(source, target)
      return {
        id: key,
        source,
        target,
        type: 'label',
        // Money flowing both ways: bow the two lines apart (opposite sides) so labels don't stack
        data: { offset: groups.has(`${target}->${source}`) ? 26 : 0, line1, line2, color: tr ? 'rgb(var(--accent))' : isChange ? 'rgb(var(--faint))' : 'rgb(var(--fg))', bold: !!tr || isSel, glow: !!tr },
        zIndex: tr ? 2 : 1,
        markerEnd: arrowFor(tr || followed ? 'accent' : isChange ? 'faint' : 'muted'),
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
            line1: `${amountWithValue(e.amount, e.asset, valueAt(pricing, e.amount, e.asset, e.timestamp), currency)}${isTraced ? ' traced' : ''}`,
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
          data: { line1: amountWithValue(amount, asset, valueAt(pricing, amount, asset), currency) },
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
  }, [edgeData, nodeData, followedPairs, traced, hubs, itemized, prices, currency, pricing, selectedEdge, chains, bridges])

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  useEffect(() => {
    if (rawNodes.length === 0) return
    // An auto trace tidies the whole graph (left to right along the trail; addresses the user
    // dragged keep their spot). Anything else leaves what's on the graph where it is and only
    // places new addresses beside where they connect.
    const tidy = tidyKey !== lastTidy.current
    lastTidy.current = tidyKey
    let laid: Node[]
    if (tidy) {
      const fixed = new Map([...moved].flatMap(id => { const p = pinned.current.get(id); return p ? [[id, p] as const] : [] }))
      for (const [id, p] of tidyLayout(rawNodes, rawEdges, tracedRef.current, fixed)) pinned.current.set(id, p)
      laid = rawNodes.map(n => ({ ...n, position: pinned.current.get(n.id)! }))
      chainShift.current.clear()
    } else {
      // A reopened case keeps its saved layout exactly: its chains are already as the user left
      // them, so only chains collapsed from here on pull their end in
      const reopened = nodeCount.current === 0 && pinned.current.size > 0
      if (!reopened) compactChains(chainsRef.current, rawEdges, pinned.current, prevChains.current, chainShift.current)
      // Only new nodes need the automatic layout; a selection or highlight change skips dagre
      const needsLayout = rawNodes.some(n => !pinned.current.has(n.id))
      laid = placeNodes(needsLayout ? layoutGraph(rawNodes, rawEdges) : rawNodes, rawEdges, pinned.current, tracedRef.current)
    }
    prevChains.current = new Map(chainsRef.current.map(c => [c.id, c]))
    // Annotations keep their own positions and are never laid out
    setNodes(prev => [...laid, ...prev.filter(n => n.id.startsWith(NOTE_PREFIX))])
    setEdges(rawEdges)
    // Refit on first draw and after a tidy. Otherwise keep the user's zoom: removing nodes never
    // moves the view, and added nodes only pan into view when they land off-screen.
    const firstDraw = nodeCount.current === 0
    const quiet = lastQuiet.current !== quietKey
    lastQuiet.current = quietKey
    const added = laid.filter(n => !shownIds.current.has(n.id))
    nodeCount.current = rawNodes.length
    shownIds.current = new Set(laid.map(n => n.id))
    if (firstDraw) {
      // Refit again once new nodes have been measured
      setTimeout(() => rf.current?.fitView(FIT), 60)
      setTimeout(() => rf.current?.fitView({ ...FIT, duration: 250 }), 400)
    } else if (tidy) {
      setTimeout(() => rf.current?.fitView({ ...FIT, duration: 300 }), 80)
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
  }, [rawNodes, rawEdges, setNodes, setEdges, quietKey, chainsKey, moved, tidyKey])

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        // Remember where the user put a node; the final drag event can omit the position
        if (c.type === 'position' && c.position && !c.id.startsWith(NOTE_PREFIX)) pinned.current.set(c.id, c.position)
      }
      // The Delete key removes a selected annotation; addresses are removed from the panel instead
      const removed = changes.flatMap(c => (c.type === 'remove' && c.id.startsWith(NOTE_PREFIX) ? [c.id.slice(NOTE_PREFIX.length)] : []))
      if (removed.length) onAnnotations?.(annotationsRef.current.filter(a => !removed.includes(a.id)))
      onNodesChange(changes.filter(c => c.type !== 'remove' || c.id.startsWith(NOTE_PREFIX)))
    },
    [onNodesChange, onAnnotations]
  )

  // Annotations as graph nodes: shapes behind the addresses, text above them
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations
  useEffect(() => {
    const notes: Node[] = annotations.map(a => ({
      id: `${NOTE_PREFIX}${a.id}`, type: 'annotation', position: { x: a.x, y: a.y }, data: a,
      style: { width: a.w, height: a.h }, zIndex: a.kind === 'text' ? 5 : -1,
    }))
    setNodes(prev => [...prev.filter(n => !n.id.startsWith(NOTE_PREFIX)), ...notes.map(n => ({ ...n, selected: prev.find(p => p.id === n.id)?.selected }))])
  }, [annotations, setNodes])
  const noteApi = useMemo(() => ({
    update: (id: string, patch: Partial<Annotation>) => onAnnotations?.(annotationsRef.current.map(a => (a.id === id ? { ...a, ...patch } : a))),
    remove: (id: string) => onAnnotations?.(annotationsRef.current.filter(a => a.id !== id)),
  }), [onAnnotations])
  const addAnnotation = (kind: Annotation['kind']) => {
    const inst = rf.current
    const el = document.querySelector('.react-flow')
    if (!inst || !el || !onAnnotations) return
    const { w, h } = ANNOTATION_SIZE[kind]
    const c = inst.screenToFlowPosition({ x: el.getBoundingClientRect().left + el.clientWidth / 2, y: el.getBoundingClientRect().top + el.clientHeight / 2 })
    // Each new one steps down-right a little, so several added in a row don't stack exactly
    const step = (annotationsRef.current.length % 6) * 28
    onAnnotations([...annotationsRef.current, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, x: c.x - w / 2 + step, y: c.y - h / 2 + step, w, h }])
  }

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
    <AnnotationContext.Provider value={noteApi}>
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
          const dropped = dragged?.length ? dragged : [node]
          for (const n of dropped) {
            if (n.id.startsWith(NOTE_PREFIX)) continue
            pinned.current.set(n.id, n.position)
            moved.add(n.id)
          }
          const notes = new Map(dropped.filter(n => n.id.startsWith(NOTE_PREFIX)).map(n => [n.id.slice(NOTE_PREFIX.length), n.position]))
          if (notes.size) onAnnotations?.(annotationsRef.current.map(a => (notes.has(a.id) ? { ...a, ...notes.get(a.id)! } : a)))
          onLayoutChange?.()
        }}
        onNodeClick={(_, n) => {
          if (n.type === 'annotation') return
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
        <GraphTools onAdd={onAnnotations ? addAnnotation : undefined} fit={FIT} />
        <MiniMap
          nodeColor={n => {
            const d = n.data as AddressNodeData
            if (n.type === 'annotation') return 'transparent'
            if (n.type === 'tx') return 'rgb(var(--faint))'
            return d.isOrigin ? 'rgb(var(--accent))' : ENTITY_STYLE[d.label?.type ?? 'unknown'].hex
          }}
          maskColor="rgb(var(--bg) / 0.7)"
          style={{ background: 'rgb(var(--panel))', border: '1px solid rgb(var(--line))' }}
        />
      </ReactFlow>
    </div>
    </AnnotationContext.Provider>
    </NodeMenuContext.Provider>
  )
}
