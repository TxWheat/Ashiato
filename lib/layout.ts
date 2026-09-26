import type { Edge, Node } from 'reactflow'
import type { TracedFlow } from './follow'

// Where new addresses go on the graph. Pure, so it can be tested without a browser.

export const NODE_W = 196
export const NODE_H = 78

export type XY = { x: number; y: number }

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

