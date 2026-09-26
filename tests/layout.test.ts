import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { NODE_H, NODE_W, placeNodes, type XY } from '@/lib/layout'
import type { TracedFlow } from '@/lib/follow'

const node = (id: string, x = 0, y = 0): Node => ({ id, position: { x, y }, data: {} })
const edge = (s: string, t: string): Edge => ({ id: `${s}>${t}`, source: s, target: t })
const flow = (from: string, to: string, hop: number, amount = 1): TracedFlow => ({ from, to, hop, amount, asset: 'ETH', txid: `0x${from}${to}`, time: 0, reason: '' })

describe('placing traced addresses', () => {
  it('puts each traced address right of the address the money came from, not beside a busy hub', () => {
    // An existing case: V (victim) pays M; a busy router R already sits far away, linked to many
    const placed = new Map<string, XY>([['V', { x: 0, y: 0 }], ['M', { x: 440, y: 0 }], ['R', { x: 440, y: 900 }]])
    for (let i = 0; i < 6; i++) placed.set(`r${i}`, { x: 880, y: 900 + i * 110 })
    // The trace: M → A → B, and A → C (smaller). A and B also touched the router at some point.
    const trail = [flow('M', 'A', 1, 6), flow('A', 'B', 2, 5), flow('A', 'C', 2, 1)]
    const ids = ['V', 'M', 'R', 'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'A', 'B', 'C']
    const edges = [edge('V', 'M'), edge('R', 'A'), edge('R', 'B'), edge('M', 'A'), edge('A', 'B'), edge('A', 'C'), ...[0, 1, 2, 3, 4, 5].map(i => edge('R', `r${i}`))]
    const laid = placeNodes(ids.map(id => node(id, 0, 0)), edges, placed, trail)
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
