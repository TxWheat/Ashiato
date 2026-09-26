import dagre from 'dagre'
import type { Edge, Node } from 'reactflow'
import type { TracedFlow } from './follow'

// The graph's layout. An auto trace lays the whole graph out as a tidy left-to-right tree
// (tidyLayout), with the traced trail as the backbone. Anything done by hand leaves what's on
// the graph where it is and only places the new addresses (placeNodes).
// Pure, so it can be tested without a browser.

export const NODE_W = 196
export const NODE_H = 78

export type XY = { x: number; y: number }

export const LAYOUT = { nodesep: 50, ranksep: 220 }

/** Identifies the graph's shape (addresses and links) */
export function layoutKey(nodes: Pick<Node, 'id'>[], edges: Pick<Edge, 'id' | 'source' | 'target'>[]): string {
  const ns = nodes.map(n => n.id).sort().join(',')
  const es = [...new Set(edges.map(e => `${e.source}>${e.target}${e.id.startsWith('chain:') ? '~' : ''}`))].sort().join(',')
  return `${ns}|${es}`
}

/**
 * Positions (top-left corners) for every node. Traced flows set the columns: money moves
 * left to right, one column per hop. Other links place the addresses that are not on the
 * trail, but never pull the trail out of line. `fixed` (dragged by the user) wins.
 */
export function tidyLayout(nodes: Node[], edges: Edge[], trail: TracedFlow[], fixed: Map<string, XY> = new Map()): Map<string, XY> {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: LAYOUT.nodesep, ranksep: LAYOUT.ranksep })
  const ids = new Set(nodes.map(n => n.id))
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })

  const onTrail = new Set<string>()
  // The trail first, heavily weighted so its hops sit in straight rows
  for (const f of [...trail].sort((a, b) => a.hop - b.hop || b.amount - a.amount)) {
    if (!ids.has(f.from) || !ids.has(f.to) || f.from === f.to) continue
    onTrail.add(f.from).add(f.to)
    if (!g.hasEdge(f.from, f.to) && !g.hasEdge(f.to, f.from)) g.setEdge(f.from, f.to, { weight: 10, minlen: 1 })
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue
    // A link between two trail addresses is drawn, but the trail alone decides their columns
    if (onTrail.has(e.source) && onTrail.has(e.target)) continue
    if (g.hasEdge(e.source, e.target) || g.hasEdge(e.target, e.source)) continue
    // Collapsed chains get a longer line so their summary label fits
    g.setEdge(e.source, e.target, { weight: 1, minlen: e.id.startsWith('chain:') ? 2 : 1 })
  }
  dagre.layout(g)

  const out = new Map<string, XY>()
  for (const n of nodes) {
    const f = fixed.get(n.id)
    if (f) { out.set(n.id, f); continue }
    const p = g.node(n.id)
    out.set(n.id, p ? { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } : { x: 0, y: 0 })
  }
  return out
}

/** Plain automatic layout, the starting point for placing new addresses */
export function layoutGraph(nodes: Node[], edges: Edge[]) {
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

/**
 * Nodes already on screen stay exactly where they are (whether auto-placed or
 * dragged). A new node goes in the column beside a neighbour that's already placed,
 * in the nearest free row. An address a trace reached goes beside the address the money
 * came from (right of it; left when walking back), never beside some other busy neighbour.
 * `placed` is updated with every final position.
 */
export function placeNodes(laid: Node[], edges: Edge[], placed: Map<string, XY>, trail: TracedFlow[] = []): Node[] {
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
  // Traced flows, earliest hop and biggest amount first: the main trail gets the nearest rows
  const flows = [...trail].sort((a, b) => a.hop - b.hop || b.amount - a.amount)
  const trailAnchor = (id: string): { anchor: string; dir: 1 | -1 } | undefined => {
    for (const f of flows) {
      if (f.to === id && f.from !== id && final.has(f.from)) return { anchor: f.from, dir: 1 }
      if (f.from === id && f.to !== id && final.has(f.to)) return { anchor: f.to, dir: -1 }
    }
    return undefined
  }
  const rank = new Map<string, number>()
  flows.forEach((f, i) => { if (!rank.has(f.to)) rank.set(f.to, i); if (!rank.has(f.from)) rank.set(f.from, i) })

  const pending = laid.filter(n => !final.has(n.id))
  for (let guard = 0; pending.length && guard < 10_000; guard++) {
    // Trail nodes whose money-source is placed go first, in trail order; then other neighbours
    let i = -1
    let best = Infinity
    pending.forEach((n, k) => { const r = rank.get(n.id); if (r !== undefined && r < best && trailAnchor(n.id)) { best = r; i = k } })
    if (i < 0) i = pending.findIndex(n => (neighbours.get(n.id) ?? []).some(id => final.has(id)))
    const n = pending.splice(i >= 0 ? i : 0, 1)[0]
    const viaTrail = trailAnchor(n.id)
    const anchor = viaTrail?.anchor ?? (neighbours.get(n.id) ?? []).find(id => final.has(id))
    const me = auto.get(n.id)!
    let pos: XY
    if (anchor) {
      const a = final.get(anchor)!
      const dir = viaTrail?.dir ?? (outgoing.has(`${anchor}>${n.id}`) ? 1 : outgoing.has(`${n.id}>${anchor}`) ? -1 : me.x >= auto.get(anchor)!.x ? 1 : -1)
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

