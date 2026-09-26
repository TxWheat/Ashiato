import { describe, expect, it } from 'vitest'
import { tokenAsset } from '@/lib/chains/eth'
import { detectPoisoning } from '@/lib/heuristics/eth/poisoning'
import { RawTransaction } from '@/lib/types'

describe('fake tokens', () => {
  it('a token calling itself ETH is fake', () => {
    expect(tokenAsset('ETH', '0x1234000000000000000000000000000000000000')).toBe('ETH*')
    expect(tokenAsset('Ether', '0x1234000000000000000000000000000000000000')).toBe('Ether*')
    expect(tokenAsset('$ETH', '0x1234000000000000000000000000000000000000')).toBe('$ETH*')
  })
  it('real and unrelated tokens keep their name', () => {
    expect(tokenAsset('WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')).toBe('WETH')
    expect(tokenAsset('stETH', '0xae7ab96520de3a18e5e111b5eaab095312d7fe84')).toBe('stETH')
    expect(tokenAsset('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe('USDT')
    expect(tokenAsset('USDT', '0x9999000000000000000000000000000000000000')).toBe('USDT*')
  })

  it('flags a fake-ETH transfer to a look-alike as poisoning (the 0xc39d…bb03 case)', () => {
    const me = '0xc39d534d39d6395f2623d8b74ff4c8172141bb03'
    const real = '0x32d37000000000000000000000000000000fcab8'
    const fake = '0x32d3bb40fbad2d0acd5d52874b653796e642cab8'
    const tx = (txid: string, to: string, asset: string, t: number): RawTransaction => ({
      txid, timestamp: t, chain: 'eth', asset, kind: asset === 'ETH' ? 'normal' : 'token',
      inputs: [{ address: me, amount: 0 }], outputs: [{ address: to, amount: 0.9674 }],
    })
    const r = detectPoisoning(me, [tx('0x1', real, 'ETH', 100), tx('0x2', fake, tokenAsset('ETH', '0xbad0000000000000000000000000000000000000'), 330)])
    expect(r.labels.get(fake)?.name).toMatch(/look-alike of 0x32d370/)
    expect(r.labels.has(real)).toBe(false)
  })
})

describe('real tokens per network', () => {
  it('knows each network has its own USDT and native coin', () => {
    // BNB Chain's real USDT is a different contract from Ethereum's
    expect(tokenAsset('USDT', '0x55d398326f99059ff775485246999027b3197955', 'bsc')).toBe('USDT')
    expect(tokenAsset('USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7', 'bsc')).toBe('USDT*')
    // On BNB Chain, "ETH" is a real bridged token and "BNB" is the native coin
    expect(tokenAsset('ETH', '0x2170ed0880ac9a755fd29b2688956bd959f933f8', 'bsc')).toBe('ETH')
    expect(tokenAsset('BNB', '0x1234000000000000000000000000000000000000', 'bsc')).toBe('BNB*')
    expect(tokenAsset('USDC', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'base')).toBe('USDC')
    expect(tokenAsset('MATIC', '0x1234000000000000000000000000000000000000', 'polygon')).toBe('MATIC*')
  })
})
