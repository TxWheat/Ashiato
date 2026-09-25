import { describe, expect, it } from 'vitest'
import { collapseChains } from '@/lib/collapse'
import { TracedFlow } from '@/lib/follow'

const flow = (from: string, to: string, amount: number, time: number): TracedFlow =>
  ({ from, to, amount, asset: 'BTC', txid: `${from}${to}`, time, hop: 1, reason: '' })

// origin → a → m1 → m2 → m3 → m4 → end, plus a side branch a → side
const chain = ['a', 'm1', 'm2', 'm3', 'm4', 'end']
const traced = [flow('origin', 'a', 15, 1), ...chain.slice(1).map((b, k) => flow(chain[k], b, 15 - k, 10 + k)), flow('a', 'side', 1, 5)]
const nodes = ['origin', 'side', ...chain]

describe('collapseChains', () => {
  it('collapses a long pass-through run into one chain and hides its middle', () => {
    const { chains, hidden } = collapseChains({ nodes, edges: [], traced, keep: new Set(['origin']), expanded: new Set() })
    expect(chains).toHaveLength(1)
    expect(chains[0]).toMatchObject({ from: 'a', to: 'end', hops: 5, firstAmount: 15, lastAmount: 11, firstTime: 10, lastTime: 14 })
    expect([...hidden]).toEqual(['m1', 'm2', 'm3', 'm4'])
  })
  it('never hides kept addresses (labelled, selected) and splits the run there', () => {
    const { chains } = collapseChains({ nodes, edges: [], traced, keep: new Set(['origin', 'm2']), expanded: new Set() })
    expect(chains.map(c => c.id)).toEqual(['m2=>end'])
  })
  it('leaves expanded chains and short runs alone', () => {
    expect(collapseChains({ nodes, edges: [], traced, keep: new Set(), expanded: new Set(['a=>end']) }).chains.map(c => c.id)).not.toContain('a=>end')
    expect(collapseChains({ nodes, edges: [], traced, keep: new Set(), expanded: new Set(), minHops: 10 }).chains).toHaveLength(0)
  })
  it('folds dead-end side addresses (peeled payees) into the chain', () => {
    const peels = ['p1', 'p2', 'p3']
    const edges = peels.map((p, k) => ({ id: p, source: chain[k + 1], target: p, amount: 0.5, asset: 'BTC', txid: p, timestamp: 1, chain: 'btc' as const }))
    const { chains, hidden } = collapseChains({ nodes: [...nodes, ...peels], edges, traced, keep: new Set(['origin']), expanded: new Set() })
    expect(chains).toHaveLength(1)
    expect(chains[0]).toMatchObject({ from: 'a', to: 'end', hops: 5, peels: 3 })
    expect(peels.every(p => hidden.has(p))).toBe(true)
  })
})
