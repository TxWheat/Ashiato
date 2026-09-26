import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { NODE_H, NODE_W, layoutKey, tidyLayout } from '@/lib/layout'
import type { TracedFlow } from '@/lib/follow'

const node = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: {} })
const edge = (s: string, t: string, id = `${s}>${t}`): Edge => ({ id, source: s, target: t })
const flow = (from: string, to: string, hop: number, amount = 1): TracedFlow => ({ from, to, hop, amount, asset: 'ETH', txid: `0x${from}${to}`, time: 0, reason: '' })

describe('tidy layout', () => {
  // A case like the real one: V → S → W, a busy router R linked to W and the trail, and a
  // trace from W that branches (W → A → B → K, A → C → D, C ↔ D going back and forth)
  const ids = ['V', 'S', 'W', 'R', 'r1', 'r2', 'A', 'B', 'K', 'C', 'D']
  const trail = [flow('W', 'A', 1, 6), flow('A', 'B', 2, 4), flow('B', 'K', 3, 4), flow('A', 'C', 2, 2), flow('C', 'D', 3, 1), flow('D', 'C', 4, 0.5)]
  const edges = [edge('V', 'S'), edge('S', 'W'), edge('R', 'W'), edge('R', 'r1'), edge('R', 'r2'), edge('R', 'B'), edge('K', 'A'),
    ...trail.map(f => edge(f.from, f.to))]
  const pos = tidyLayout(ids.map(node), edges, trail)
  const at = (id: string) => pos.get(id)!

  it('reads left to right along the trail, one column per hop', () => {
    expect(at('A').x).toBeGreaterThan(at('W').x)
    expect(at('B').x).toBeGreaterThan(at('A').x)
    expect(at('K').x).toBeGreaterThan(at('B').x)
    expect(at('C').x).toBeGreaterThan(at('A').x)
    // A link back from K to A doesn't drag K behind A
    expect(at('K').x).toBeGreaterThan(at('A').x)
  })

  it('never overlaps', () => {
    const all = [...pos.values()]
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      expect(Math.abs(all[i].x - all[j].x) >= NODE_W || Math.abs(all[i].y - all[j].y) >= NODE_H).toBe(true)
    }
  })

  it('is the same every time (reopening a case gives the same picture)', () => {
    expect(tidyLayout(ids.map(node), edges, trail)).toEqual(pos)
  })

  it('keeps addresses the user dragged where they put them', () => {
    const moved = tidyLayout(ids.map(node), edges, trail, new Map([['R', { x: -999, y: 5 }]]))
    expect(moved.get('R')).toEqual({ x: -999, y: 5 })
  })

  it('knows when the shape changed', () => {
    expect(layoutKey(ids.map(node), edges)).toBe(layoutKey([...ids].reverse().map(node), [...edges].reverse()))
    expect(layoutKey(ids.map(node), edges)).not.toBe(layoutKey(ids.map(node), edges.slice(1)))
  })
})
