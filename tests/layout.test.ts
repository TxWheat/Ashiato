import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { NODE_H, NODE_W, layoutKey, placeNodes, tidyLayout, type XY } from '@/lib/layout'
import type { TracedFlow } from '@/lib/follow'

const node = (id: string, x = 0, y = 0): Node => ({ id, position: { x, y }, data: {} })
const edge = (s: string, t: string, id = `${s}>${t}`): Edge => ({ id, source: s, target: t })
const flow = (from: string, to: string, hop: number, amount = 1): TracedFlow => ({ from, to, hop, amount, asset: 'ETH', txid: `0x${from}${to}`, time: 0, reason: '' })

describe('tidy layout', () => {
  // A case like the real one: V → S → W, a busy router R linked to W and the trail, and a
  // trace from W that branches (W → A → B → K, A → C → D, C ↔ D going back and forth)
  const ids = ['V', 'S', 'W', 'R', 'r1', 'r2', 'A', 'B', 'K', 'C', 'D']
  const trail = [flow('W', 'A', 1, 6), flow('A', 'B', 2, 4), flow('B', 'K', 3, 4), flow('A', 'C', 2, 2), flow('C', 'D', 3, 1), flow('D', 'C', 4, 0.5)]
  const edges = [edge('V', 'S'), edge('S', 'W'), edge('R', 'W'), edge('R', 'r1'), edge('R', 'r2'), edge('R', 'B'), edge('K', 'A'),
    ...trail.map(f => edge(f.from, f.to))]
  const pos = tidyLayout(ids.map(id => node(id)), edges, trail)
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
    expect(tidyLayout(ids.map(id => node(id)), edges, trail)).toEqual(pos)
  })

  it('keeps addresses the user dragged where they put them', () => {
    const moved = tidyLayout(ids.map(id => node(id)), edges, trail, new Map([['R', { x: -999, y: 5 }]]))
    expect(moved.get('R')).toEqual({ x: -999, y: 5 })
  })

  it('knows when the shape changed', () => {
    expect(layoutKey(ids.map(id => node(id)), edges)).toBe(layoutKey([...ids].reverse().map(id => node(id)), [...edges].reverse()))
    expect(layoutKey(ids.map(id => node(id)), edges)).not.toBe(layoutKey(ids.map(id => node(id)), edges.slice(1)))
  })
})

describe('placing traced addresses', () => {
  it('puts each traced address right of the address the money came from, not beside a busy hub', () => {
    // An existing case: V (victim) pays M; a busy router R already sits far away, linked to many
    const placed = new Map<string, XY>([['V', { x: 0, y: 0 }], ['M', { x: 440, y: 0 }], ['R', { x: 440, y: 900 }]])
    for (let i = 0; i < 6; i++) placed.set(`r${i}`, { x: 880, y: 900 + i * 110 })
    // The trace: M → A → B, and A → C (smaller). A and B also touched the router at some point.
    const trail = [flow('M', 'A', 1, 6), flow('A', 'B', 2, 5), flow('A', 'C', 2, 1)]
    const ids = ['V', 'M', 'R', 'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'A', 'B', 'C']
    const edges = [edge('V', 'M'), edge('R', 'A'), edge('R', 'B'), edge('M', 'A'), edge('A', 'B'), edge('A', 'C'), ...[0, 1, 2, 3, 4, 5].map(i => edge('R', `r${i}`))]
    const laid = placeNodes(ids.map(id => node(id)), edges, placed, trail)
    const at = (id: string) => laid.find(n => n.id === id)!.position
    // Existing nodes never move
    expect(at('R')).toEqual({ x: 440, y: 900 })
    // The trail reads left to right from M, near M's row, not down by the router
    expect(at('A').x).toBeGreaterThan(at('M').x)
    expect(at('B').x).toBeGreaterThan(at('A').x)
    expect(Math.abs(at('A').y - at('M').y)).toBeLessThan(300)
    // The main branch (B, 5 ETH) sits on A's row; the side branch (C) goes beside it
    expect(at('B').y).toBe(at('A').y)
    expect(at('C').x).toBe(at('B').x)
    // Nothing overlaps
    const all = laid.map(n => n.position)
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      expect(Math.abs(all[i].x - all[j].x) >= NODE_W || Math.abs(all[i].y - all[j].y) >= NODE_H).toBe(true)
    }
  })

  it('walking back puts sources to the left', () => {
    const placed = new Map<string, XY>([['M', { x: 1000, y: 0 }]])
    const laid = placeNodes([node('M'), node('S')], [edge('S', 'M')], placed, [flow('S', 'M', 1)])
    expect(laid.find(n => n.id === 'S')!.position.x).toBeLessThan(1000)
  })
})
