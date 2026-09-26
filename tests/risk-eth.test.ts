import { describe, expect, it } from 'vitest'
import { scoreRisk } from '@/lib/risk'
import { detectDepositAddress } from '@/lib/heuristics/deposit'
import { tornadoFindings, tornadoLinks } from '@/lib/heuristics/eth/tornado'
import { toUnits } from '@/lib/chains/eth'
import { EntityLabel } from '@/lib/types'
import { btcTx, ethTx } from './fixtures'

describe('scoreRisk', () => {
  const labels: Record<string, EntityLabel> = {
    '0xofac': { name: 'OFAC sanctioned address', type: 'sanctioned' },
    '0xbinance': { name: 'Binance', type: 'exchange' },
  }
  const labelOf = (a: string) => labels[a]

  it('is critical for a sanctioned address', () => {
    expect(scoreRisk('0xofac', labels['0xofac'], [], labelOf).level).toBe('critical')
  })
  it('rates direct receipts from a sanctioned address highly', () => {
    const r = scoreRisk('0xme', undefined, [ethTx('0xofac', '0xme', 1, 1), ethTx('0xbinance', '0xme', 9, 2)], labelOf)
    expect(r.level).toBe('high')
    expect(r.reasons.join(' ')).toMatch(/sanctioned/)
  })
  it('is clean with no exposure', () => {
    expect(scoreRisk('0xme', undefined, [ethTx('0xbinance', '0xme', 1, 1)], labelOf).level).toBe('clean')
  })
})

describe('detectDepositAddress (tutela / FC20)', () => {
  const labelOf = (a: string): EntityLabel | undefined =>
    a === '0xbinance' ? { name: 'Binance 14', type: 'exchange' } : undefined

  it('finds an ETH deposit address from receive-then-forward', () => {
    const txs = [
      ethTx('0xvictimscammer', '0xdep', 2.5, 1000),
      ethTx('0xdep', '0xbinance', 2.495, 1000 + 3600),
    ]
    const f = detectDepositAddress('0xdep', 'eth', txs, labelOf)
    expect(f?.exchange).toBe('Binance 14')
    expect(f!.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('rejects forwards outside the time window', () => {
    const txs = [ethTx('0xa', '0xdep', 2.5, 0), ethTx('0xdep', '0xbinance', 2.495, 3 * 86400)]
    expect(detectDepositAddress('0xdep', 'eth', txs, labelOf)).toBeUndefined()
  })

  it('finds a BTC deposit address from sweeps', () => {
    const btcLabel = (a: string): EntityLabel | undefined => (a === '1Hot' ? { name: 'Kraken', type: 'exchange' } : undefined)
    const sweep = btcTx([['1Dep', 0.5], ['1Dep2', 0.7]], [['1Hot', 1.1999]])
    expect(detectDepositAddress('1Dep', 'btc', [sweep], btcLabel)?.exchange).toBe('Kraken')
  })
})

describe('Tornado Cash reveals (tutela)', () => {
  const pool: EntityLabel = { name: 'Tornado Cash 1 ETH pool', type: 'mixer' }
  const pool01: EntityLabel = { name: 'Tornado Cash 0.1 ETH pool', type: 'mixer' }
  const labelOf = (a: string) => (a === '0xpool1' ? pool : a === '0xpool01' ? pool01 : undefined)

  it('flags address reuse across deposit and withdrawal', () => {
    const txs = [ethTx('0xme', '0xpool1', 1, 10), ethTx('0xpool1', '0xme', 1, 20, 'ETH', 'internal')]
    const f = tornadoFindings('0xme', txs, labelOf)
    expect(f.map(x => x.heuristic)).toContain('tornado-address-match')
  })

  it('links by unique gas price and by multi-denomination pattern', () => {
    const txs = [
      ethTx('0xdep', '0xpool1', 1, 10, 'ETH', 'normal', 147.4535436),
      ethTx('0xdep', '0xpool01', 0.1, 11, 'ETH', 'normal', 20),
      ethTx('0xpool1', '0xwd', 1, 50, 'ETH', 'internal', 147.4535436),
      ethTx('0xpool01', '0xwd', 0.1, 51, 'ETH', 'internal'),
    ]
    const links = tornadoLinks(txs, labelOf)
    expect(links.map(l => l.heuristic).sort()).toEqual(['tornado-gas-price', 'tornado-multi-denomination'])
    expect(links.every(l => l.depositor === '0xdep' && l.withdrawer === '0xwd')).toBe(true)
  })
})

describe('toUnits', () => {
  it('converts wei exactly enough for display', () => {
    expect(toUnits('1234567890123456789012', 18)).toBeCloseTo(1234.567890123456789, 9)
    expect(toUnits('1000000', 6)).toBe(1)
    expect(toUnits('garbage', 18)).toBe(0)
  })
})
