import { describe, expect, it } from 'vitest'
import { getLabel, labelStats } from '@/lib/labels'

describe('label dataset', () => {
  it('loads both chains', () => {
    const s = labelStats()
    expect(s.btc).toBeGreaterThan(50_000)
    expect(s.eth).toBeGreaterThan(5_000)
  })
  it('tags BTC exchanges from GraphSense TagPacks (was zero BTC labels before, bug C3)', () => {
    expect(getLabel('34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', 'btc')?.type).toBe('exchange')
  })
  it('flags OFAC sanctioned addresses', () => {
    expect(getLabel('123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX', 'btc')?.type).toBe('sanctioned')
    expect(getLabel('0x0330070FD38Ec3bB94F58FA55D40368271E9e54A'.toUpperCase().replace('0X', '0x'), 'eth')?.type).toBe('sanctioned')
  })
  it('keeps base58 case-sensitive and matches the BitMEX vanity prefix', () => {
    expect(getLabel('34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo'.toLowerCase(), 'btc')).toBeUndefined()
    expect(getLabel('3BMEXqGpG4FxBA1KWhRFufXfSTRgzfDBhJ', 'btc')?.type).toBe('deposit')
  })
  it('never labels the null or burn address as a scam', () => {
    expect(getLabel('0x0000000000000000000000000000000000000000', 'eth')?.type).toBe('service')
    expect(getLabel('0x000000000000000000000000000000000000dEaD', 'eth')?.name).toBe('Burn address')
  })
  it('has the corrected Tornado pool names', () => {
    expect(getLabel('0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936', 'eth')?.name).toBe('Tornado Cash 1 ETH pool')
  })
})
