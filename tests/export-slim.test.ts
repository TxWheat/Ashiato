import { describe, expect, it } from 'vitest'
import { CaseFile, slimCase } from '@/lib/export'
import { ethTx } from './fixtures'

describe('slimCase', () => {
  it('keeps only what the graph uses, and marks trimmed pages', () => {
    const link = ethTx('0xa', '0xb', 1, 100)
    const traced = ethTx('0xa', '0xoff', 2, 200)
    const noise = Array.from({ length: 50 }, (_, i) => ethTx('0xa', `0xz${i}`, 0.1, 300 + i))
    const c = {
      version: 1, savedAt: '', origin: { address: '0xa', chain: 'eth' }, known: [], visible: ['0xa', '0xb'], followedPairs: [],
      pages: { '0xa': { rawTxs: [link, traced, ...noise] }, '0xgone': { rawTxs: noise } },
      traced: [{ from: '0xa', to: '0xoff', amount: 2, asset: 'ETH', txid: traced.txid, time: 200, hop: 1, reason: '' }],
    } as unknown as CaseFile
    const s = slimCase(c)
    expect(Object.keys(s.pages)).toEqual(['0xa'])
    expect(s.pages['0xa'].rawTxs.map(t => t.txid).sort()).toEqual([link.txid, traced.txid].sort())
    expect(s.pages['0xa'].trimmed).toBe(true)
  })
})
