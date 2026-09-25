import { describe, expect, it } from 'vitest'
import { counterparties, flowSummary } from '@/lib/counterparties'
import { txEdges, aggregateEdges } from '@/lib/graph'
import { seedsFromTx } from '@/lib/follow'
import { RawTransaction } from '@/lib/types'

// 15bS9Q… spends 17 BTC: 15 BTC to 19h6MN… (flagged likely change) and 2 BTC to 1K7gSU…
const ME = '15bS9QZx4aMrxFEZEQM1wn6rCWiZqPmomL'
const CHANGE = '19h6MNxxxxxxxxxxxxxxxxxxxxxxxXX6R'
const PAY = '1K7gSUxxxxxxxxxxxxxxxxxxxxxxxr4eX'
const tx: RawTransaction = {
  txid: 'ebc6db'.padEnd(64, '0'), timestamp: 1498949280, chain: 'btc', asset: 'BTC',
  inputs: [{ address: ME, amount: 17 }],
  outputs: [
    { address: CHANGE, amount: 15, index: 0, isChange: true },
    { address: PAY, amount: 2, index: 1 },
  ],
}

describe('likely-change outputs stay visible', () => {
  const edges = aggregateEdges(txEdges(ME, 'btc', [tx]))
  it('lists the change address as an outgoing relationship, tagged', () => {
    const cps = counterparties(ME, edges)
    expect(cps.map(c => c.address).sort()).toEqual([CHANGE, PAY].sort())
    expect(cps.find(c => c.address === CHANGE)).toMatchObject({ sent: { BTC: 15 }, likelyChange: true })
    expect(cps.find(c => c.address === PAY)?.likelyChange).toBe(false)
  })
  it('counts change in the outgoing total', () => {
    expect(flowSummary(ME, edges).outgoing.BTC).toEqual({ amount: 17, count: 2 })
  })
  it('can follow the change output (every-output mode)', () => {
    const { lots, flows } = seedsFromTx(tx, ME, undefined, false)
    expect(lots.map(l => [l.address, l.amount])).toEqual([[CHANGE, 15], [PAY, 2]])
    expect(flows[0].reason).toMatch(/likely change/)
  })
  it('adaptive tracing follows the peel-chain remainder (the change) and lists the payment', () => {
    const { lots, ends } = seedsFromTx(tx, ME)
    expect(lots.map(l => l.address)).toEqual([CHANGE])
    expect(ends).toMatchObject([{ address: PAY, reason: 'peel' }])
  })
})
