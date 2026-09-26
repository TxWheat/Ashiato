import { describe, expect, it } from 'vitest'
import { summaryFacts } from '@/lib/summary-facts'
import type { EdgeData, NodeData } from '@/lib/types'

const A = '0xaaaa000000000000000000000000000000000001'
const B = '0xbbbb000000000000000000000000000000000002'
const X = '0xeeee000000000000000000000000000000000003'

describe('summary facts', () => {
  const nodes = new Map<string, NodeData>([[X, { address: X, chain: 'eth', label: { name: 'Binance deposit', type: 'deposit', source: 't' } } as unknown as NodeData]])
  const edge = (source: string, target: string, amount: number, asset = 'ETH') =>
    ({ id: `${source}-${target}-${asset}`, source, target, amount, asset, txid: '0x1', timestamp: 1_760_000_000, chain: 'eth', txCount: 2 }) as EdgeData

  it('describes the trail, its end and exchange addresses, with labels', () => {
    const f = summaryFacts({
      chain: 'eth', origin: A, nodes, edges: [edge(A, B, 5)],
      traced: [{ from: A, to: B, amount: 5, asset: 'ETH', txid: '0x1', time: 1_760_000_000, hop: 1, reason: 'Next outflow', share: 0.5 }],
      ends: [{ address: X, amount: 5, asset: 'ETH', reason: 'entity', detail: 'Reached Binance deposit' }],
      nameOf: a => (a === A ? 'Victim' : undefined),
    })
    expect(f.origin).toEqual({ address: A, label: 'Victim' })
    expect(f.traced[0]).toMatchObject({ hop: 1, fromLabel: 'Victim', amount: 5, poolShare: 0.5, time: '2025-10-09 08:53 UTC' })
    expect(f.ended[0]).toMatchObject({ label: 'Binance deposit', reason: 'entity' })
    expect(f.exchanges).toEqual([{ address: X, label: 'Binance deposit', type: 'deposit' }])
    expect(f.flows).toEqual([]) // a trace replaces the raw flows
  })

  it('without a trace, lists the largest real flows (no spam tokens)', () => {
    const f = summaryFacts({ chain: 'eth', origin: A, nodes, edges: [edge(A, B, 1), edge(A, X, 9), edge(B, X, 1e9, 'FAKE*')], traced: [], ends: [], nameOf: () => undefined })
    expect(f.flows.map(x => x.amount)).toEqual([9, 1])
    expect(f.flows[0]).toMatchObject({ to: X, toLabel: 'Binance deposit', transactions: 2 })
  })
})
