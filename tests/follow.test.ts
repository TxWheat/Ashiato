import { describe, expect, it } from 'vitest'
import { BtcTxInfo, followFunds, seedsFromTx, backSeedsFromTx, FollowDeps } from '@/lib/follow'
import { EntityLabel, RawTransaction } from '@/lib/types'
import { btcTx, ethTx } from './fixtures'

const opts = { direction: 'forward' as const, maxHops: 5, maxBranches: 4, stopAt: ['exchange' as const] }

function ethDeps(txs: RawTransaction[], labels: Record<string, EntityLabel> = {}): FollowDeps {
  return {
    addressTxs: async a => txs.filter(t => t.inputs[0].address === a || t.outputs[0].address === a),
    btcTx: async () => { throw new Error('n/a') },
    labelOf: a => labels[a],
  }
}

describe('ETH forward (chronological, amount-bounded)', () => {
  it('follows only the traced amount, not unrelated large outflows (screenshot case)', async () => {
    const txs = [
      ethTx('0xvictim', '0xmule', 0.0101, 100),
      ethTx('0xmule', '0xnext', 0.0100, 200),          // the victim's money moving on
      ethTx('0xwhale', '0xmule', 28, 300),              // someone else's money arrives later
      ethTx('0xmule', '0xbig', 28, 400),                // …and leaves: must NOT be traced
    ]
    const { lots, flows } = seedsFromTx(txs[0], '0xvictim')
    const r = await followFunds(lots, opts, ethDeps(txs))
    const all = [...flows, ...r.flows]
    expect(all.map(f => `${f.from}->${f.to}`)).toEqual(['0xvictim->0xmule', '0xmule->0xnext'])
    expect(all.find(f => f.to === '0xbig')).toBeUndefined()
    expect(r.flows[0].amount).toBeCloseTo(0.01)
  })

  it('ignores outflows that happened before the funds arrived', async () => {
    const txs = [
      ethTx('0xmule', '0xearlier', 5, 50),
      ethTx('0xvictim', '0xmule', 1, 100),
      ethTx('0xmule', '0xlater', 1, 150),
    ]
    const r = await followFunds(seedsFromTx(txs[1], '0xvictim').lots, opts, ethDeps(txs))
    expect(r.flows.map(f => f.to)).toEqual(['0xlater'])
  })

  it('splits across several outflows until the amount is used, and stops at an exchange', async () => {
    const txs = [
      ethTx('0xvictim', '0xmule', 3, 100),
      ethTx('0xmule', '0xa', 1, 110),
      ethTx('0xmule', '0xbinance', 2, 120),
      ethTx('0xmule', '0xc', 5, 130),
      ethTx('0xbinance', '0xhot', 2, 140),
    ]
    const r = await followFunds(seedsFromTx(txs[0], '0xvictim').lots, opts, ethDeps(txs, { '0xbinance': { name: 'Binance', type: 'exchange' } }))
    expect(r.flows.map(f => [f.to, f.amount])).toEqual([['0xbinance', 2], ['0xa', 1]])
    expect(r.ends.find(e => e.address === '0xbinance')?.reason).toBe('entity')
    expect(r.flows.find(f => f.to === '0xhot')).toBeUndefined()
  })

  it('reports funds that have not moved on', async () => {
    const txs = [ethTx('0xvictim', '0xmule', 1, 100)]
    const r = await followFunds(seedsFromTx(txs[0], '0xvictim').lots, opts, ethDeps(txs))
    expect(r.ends[0]).toMatchObject({ address: '0xmule', reason: 'no-outflow' })
  })

  it('walks back to the most recent inflows before the funds left', async () => {
    const txs = [
      ethTx('0xold', '0xmule', 1, 10),
      ethTx('0xsource', '0xmule', 2, 90),
      ethTx('0xmule', '0xdest', 2, 100),
    ]
    const { lots, flows } = backSeedsFromTx(txs[2], '0xdest')
    const r = await followFunds(lots, { ...opts, direction: 'backward' }, ethDeps(txs))
    expect(flows[0]).toMatchObject({ from: '0xmule', to: '0xdest' })
    expect(r.flows.map(f => f.from)).toEqual(['0xsource'])
  })
})

describe('BTC (exact UTXO)', () => {
  const T1 = 'a'.repeat(64), T2 = 'b'.repeat(64), T3 = 'c'.repeat(64)
  // victim pays mule 1 BTC (T1:0); mule spends it with 1 BTC of other coins (T2) → X 1.5, Y 0.4999
  const t1 = btcTx([['1Victim', 1.2]], [['1Mule', 1], ['1Victim', 0.1999]], 100, T1)
  const t2 = btcTx([['1Mule', 1, `${T1}:0`], ['1Other', 1]], [['1X', 1.5], ['1Y', 0.4999]], 200, T2)
  const t3 = btcTx([['1X', 1.5, `${T2}:0`]], [['1Exchange', 1.4999]], 300, T3)
  const db: Record<string, BtcTxInfo> = {
    [T1]: { tx: t1, spentBy: [T2, null], labels: {} },
    [T2]: { tx: t2, spentBy: [T3, null], labels: {} },
    [T3]: { tx: t3, spentBy: [null], labels: {} },
  }
  const deps: FollowDeps = {
    addressTxs: async () => [],
    btcTx: async id => db[id],
    labelOf: a => (a === '1Exchange' ? { name: 'Kraken', type: 'exchange' } : undefined),
  }

  it('follows the exact coins and splits pro rata', async () => {
    const { lots, flows } = seedsFromTx(t1, '1Victim')
    expect(flows).toHaveLength(1) // change back to the victim is not a seed
    const r = await followFunds(lots, opts, deps)
    const x = r.flows.find(f => f.to === '1X')!
    expect(x.amount).toBeCloseTo(0.75) // 1.5 × (1 / 2)
    expect(r.flows.find(f => f.to === '1Y')!.amount).toBeCloseTo(0.24995)
    expect(r.flows.find(f => f.to === '1Exchange')!.amount).toBeCloseTo(0.74995)
    expect(r.ends.find(e => e.address === '1Y')?.reason).toBe('unspent')
    expect(r.ends.find(e => e.address === '1Exchange')?.reason).toBe('entity')
  })

  it('walks back exactly through inputs', async () => {
    const { lots } = backSeedsFromTx(t3, '1Exchange')
    const r = await followFunds(lots, { ...opts, direction: 'backward', stopAt: [] }, deps)
    const froms = r.flows.map(f => `${f.from}->${f.to}`)
    expect(froms).toContain('1X->1Exchange')
    expect(froms).toContain('1Mule->1X')
    expect(froms).toContain('1Victim->1Mule')
  })
})
