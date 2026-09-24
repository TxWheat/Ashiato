import { describe, expect, it } from 'vitest'
import { detectCoinJoin } from '@/lib/heuristics/btc/coinjoin'
import { detectChange } from '@/lib/heuristics/btc/change'
import { clusterAddresses } from '@/lib/heuristics/cluster'
import { buildGraph } from '@/lib/graph'
import { btcTx } from './fixtures'

describe('detectChange', () => {
  it('address reuse beats every other rule', () => {
    // Sender pays back to itself; the reused output is change even though it is larger and round
    const tx = btcTx([['bc1qsender', 1.5]], [['bc1qsender', 1.0], ['bc1qpayee', 0.4999]])
    expect(detectChange(tx)).toMatchObject({ index: 0 })
    expect(detectChange(tx)!.finding.confidence).toBeGreaterThan(0.9)
  })

  it('does not flag the payment when the sender reuses its address (old bug C5a)', () => {
    const tx = btcTx([['bc1qsender', 1]], [['bc1qpayee', 0.3], ['bc1qsender', 0.6999]])
    expect(detectChange(tx)!.index).toBe(1)
  })

  it('picks the non-round output as change', () => {
    const tx = btcTx([['bc1qa', 0.8]], [['bc1qpay', 0.5], ['bc1qchg', 0.29984321]])
    expect(detectChange(tx)!.index).toBe(1)
  })

  it('uses script type when amounts do not help', () => {
    const tx = btcTx([['bc1qa', 1]], [['3Payee111111111111111111111111', 0.51234567], ['bc1qchg', 0.48711111]])
    expect(detectChange(tx)!.index).toBe(1)
  })

  it('stays silent when nothing stands out', () => {
    const tx = btcTx([['bc1qa', 1]], [['bc1qb', 0.51234567], ['bc1qc', 0.48711111]])
    expect(detectChange(tx)).toBeUndefined()
  })

  it('never runs on CoinJoins', () => {
    const tx = btcTx([['bc1qa', 1]], [['bc1qa', 0.5], ['bc1qb', 0.4]])
    tx.coinjoin = { heuristic: 'coinjoin', kind: 'generic', confidence: 0.5, reasons: [] }
    expect(detectChange(tx)).toBeUndefined()
  })
})

describe('detectCoinJoin', () => {
  it('recognises a Whirlpool 5x5', () => {
    const ins = Array.from({ length: 5 }, (_, i) => [`bc1qin${i}`, 0.0105] as [string, number])
    const outs = Array.from({ length: 5 }, (_, i) => [`bc1qout${i}`, 0.01] as [string, number])
    expect(detectCoinJoin(btcTx(ins, outs))?.kind).toBe('whirlpool')
  })

  it('recognises a Wasabi 1 round', () => {
    const ins = Array.from({ length: 30 }, (_, i) => [`bc1qin${i}`, 0.15] as [string, number])
    const outs = [
      ...Array.from({ length: 25 }, (_, i) => [`bc1qmix${i}`, 0.1] as [string, number]),
      ...Array.from({ length: 20 }, (_, i) => [`bc1qchg${i}`, 0.04 + i / 1e5] as [string, number]),
    ]
    expect(detectCoinJoin(btcTx(ins, outs))?.kind).toBe('wasabi1')
  })

  it('ignores an ordinary batch payment from one wallet', () => {
    const tx = btcTx([['bc1qexchange', 5]], [['bc1qa', 0.1], ['bc1qb', 0.1], ['bc1qc', 0.1], ['bc1qexchange', 4.69]])
    expect(detectCoinJoin(tx)).toBeUndefined()
  })
})

describe('clusterAddresses', () => {
  it('joins co-spent inputs and inherits labels, but skips CoinJoins', () => {
    const a = btcTx([['1A', 1], ['1B', 1]], [['1X', 1.99]])
    const b = btcTx([['1B', 1], ['1C', 1]], [['1Y', 1.99]])
    const cj = btcTx([['1C', 1], ['1D', 1]], [['1Z', 1.99]])
    cj.coinjoin = { heuristic: 'coinjoin', kind: 'generic', confidence: 0.6, reasons: [] }
    const labels = new Map([['1A', { name: 'Binance', type: 'exchange' as const }]])
    const { byAddress, clusters } = clusterAddresses([a, b, cj], labels)
    expect(clusters).toHaveLength(1)
    expect(byAddress.get('1C')?.members).toEqual(['1A', '1B', '1C'])
    expect(byAddress.get('1D')).toBeUndefined()
    expect(byAddress.get('1B')?.label?.name).toContain('Binance')
  })

  it('links senders into the same exchange deposit address (tutela)', () => {
    const t1 = btcTx([['1Alice', 1]], [['1Dep', 0.99]])
    const t2 = btcTx([['1AliceAlt', 1]], [['1Dep', 0.99]])
    const labels = new Map([['1Dep', { name: 'Deposit address → Kraken', type: 'deposit' as const }]])
    const { byAddress } = clusterAddresses([t1, t2], labels)
    expect(byAddress.get('1Alice')?.members).toContain('1AliceAlt')
  })
})

describe('buildGraph', () => {
  it('splits incoming value by input share instead of repeating it (old bug C2)', () => {
    const tx = btcTx([['1A', 3], ['1B', 1]], [['1Me', 2], ['1A', 1.9999]])
    const { edges } = buildGraph('1Me', 'btc', [tx], () => undefined)
    const total = edges.reduce((s, e) => s + e.amount, 0)
    expect(total).toBeCloseTo(2)
    expect(edges.find(e => e.source === '1A')!.amount).toBeCloseTo(1.5)
    expect(edges.find(e => e.source === '1B')!.amount).toBeCloseTo(0.5)
  })

  it('draws no incoming edges for change paid back to the sender', () => {
    const tx = btcTx([['1Me', 1]], [['1Payee', 0.4], ['1Me', 0.5999]])
    const { edges } = buildGraph('1Me', 'btc', [tx], () => undefined)
    expect(edges.every(e => e.source === '1Me')).toBe(true)
  })
})

describe('aggregateEdges', () => {
  it('counts a tx once when it is loaded from both ends', async () => {
    const { txEdges, aggregateEdges } = await import('@/lib/graph')
    const tx = btcTx([['1A', 1]], [['1B', 0.9999]])
    const fromA = txEdges('1A', 'btc', [tx])
    const fromB = txEdges('1B', 'btc', [tx])
    const [edge] = aggregateEdges([...fromA, ...fromB])
    expect(edge.amount).toBeCloseTo(0.9999)
    expect(edge.txCount).toBe(1)
  })
})
