import dagre from 'dagre'
import type { Edge, Node } from 'reactflow'
import type { TracedFlow } from './follow'

// The graph's layout: always a tidy left-to-right tree, recomputed whenever addresses or links
// change. The traced trail is the backbone; addresses the user dragged keep their spot.
// Pure, so it can be tested without a browser.

export const NODE_W = 196
export const NODE_H = 78

export type XY = { x: number; y: number }

export const LAYOUT = { nodesep: 50, ranksep: 220 }

/** Identifies the graph's shape: the layout only needs recomputing when this changes */
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
