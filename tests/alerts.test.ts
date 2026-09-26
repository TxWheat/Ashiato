import { describe, expect, it } from 'vitest'
import { alertEvents } from '@/lib/alerts/detect'
import type { EntityLabel, RawTransaction } from '@/lib/types'

const W = '0xaaaa000000000000000000000000000000000001'
const X = '0xeeee000000000000000000000000000000000003'
const P = '0xbbbb000000000000000000000000000000000002'
const tx = (txid: string, time: number, from: string, to: string, amount: number, asset = 'ETH'): RawTransaction =>
  ({ txid, timestamp: time, chain: 'eth', asset, inputs: [{ address: from, amount }], outputs: [{ address: to, amount }] })
const labels: Record<string, EntityLabel> = { [X]: { name: 'Binance deposit', type: 'deposit' } }

describe('alert events', () => {
  it('reports new transfers in and out, and flags money reaching an exchange', () => {
    const events = alertEvents(W, 'eth', [
      tx('0x1', 100, P, W, 2),              // old: before the watch started
      tx('0x2', 300, P, W, 5),              // in
      tx('0x3', 400, W, X, 4.9),            // out to an exchange deposit
      tx('0x4', 500, P, W, 1e6, 'FAKE*'),   // spam token
    ], 200, a => labels[a])
    expect(events.map(e => [e.txid, e.direction, e.amount, e.urgent])).toEqual([['0x3', 'out', 4.9, true], ['0x2', 'in', 5, false]])
    expect(events[0].counterpartyLabel).toBe('Binance deposit')
  })

  it('adds up several transfers of one asset in the same transaction, and matches addresses in any case', () => {
    const events = alertEvents(W.toUpperCase().replace('0X', '0x'), 'eth', [tx('0x5', 300, W, P, 1), tx('0x5', 300, W, P, 2)], 0, () => undefined)
    expect(events).toHaveLength(1)
    expect(events[0].amount).toBe(3)
  })

  it('Bitcoin: money out counts what left, not the change', () => {
    const btc: RawTransaction = { txid: 'b1', timestamp: 10, chain: 'btc', asset: 'BTC', inputs: [{ address: 'bc1w', amount: 1 }], outputs: [{ address: 'bc1p', amount: 0.3 }, { address: 'bc1w', amount: 0.69 }] }
    expect(alertEvents('bc1w', 'btc', [btc], 0, () => undefined)).toMatchObject([{ direction: 'out', amount: 0.3, counterparty: 'bc1p' }])
  })
})

describe('alert noise', () => {
  it('ignores dust, poisoning and airdropped tokens, but not unknown tokens leaving', () => {
    const events = alertEvents(W, 'eth', [
      tx('0x6', 300, P, W, 0.0001),            // dust in
      tx('0x7', 300, P, W, 0.5, 'USDT'),       // below the stablecoin floor
      tx('0x8', 300, P, W, 5000, 'GHOST'),     // airdrop
      tx('0x9', 300, W, P, 5000, 'GHOST'),     // the scammer moving a token out
    ], 0, () => undefined)
    expect(events.map(e => [e.txid, e.direction])).toEqual([['0x9', 'out']])
  })
})
