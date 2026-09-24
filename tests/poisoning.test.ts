import { describe, expect, it } from 'vitest'
import { detectPoisoning } from '@/lib/heuristics/eth/poisoning'
import { scoreRisk } from '@/lib/risk'
import { ethTx } from './fixtures'

const VICTIM = '0xa62c000000000000000000000000000000000fa24'
const REAL = '0xb3b221f5000000000000000000000000b99aeb703'.slice(0, 42)
const FAKE = '0xb3b211aa000000000000000000000000cc11eb703'.slice(0, 42)

describe('address poisoning (stanleee.eth case)', () => {
  const txs = [
    ethTx(VICTIM, REAL, 60.18657, 100, 'USDT', 'token'),   // genuine payment
    ethTx(VICTIM, FAKE, 60.18657, 160, 'USDT*', 'token'),  // fake-token look-alike written into history
  ]

  it('labels the look-alike address, not the real one', () => {
    const r = detectPoisoning(VICTIM, txs)
    expect(r.labels.get(FAKE)?.name).toMatch(/look-alike of 0xb3b221/)
    expect(r.labels.has(REAL)).toBe(false)
    expect(r.finding?.heuristic).toBe('address-poisoning')
  })

  it('does not raise the victim\'s risk score', () => {
    const labels = detectPoisoning(VICTIM, txs).labels
    const risk = scoreRisk(VICTIM, undefined, txs, a => labels.get(a))
    expect(risk.level).toBe('clean')
  })
})
