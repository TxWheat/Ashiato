import { describe, expect, it } from 'vitest'
import { addressFits, normaliseAddress } from '@/lib/detect-chain'
import { explorerAddressUrl, explorerTxUrl } from '@/lib/format'
import { isProChain, nativeAsset } from '@/lib/evm'
import { priceKey } from '@/lib/prices'

const A = '0xAbCd000000000000000000000000000000000001'

describe('Ethereum-style networks', () => {
  it('a 0x address fits every Ethereum-style network, and only those', () => {
    for (const c of ['eth', 'base', 'arbitrum', 'optimism', 'bsc', 'polygon']) expect(addressFits(A, c)).toBe(true)
    expect(addressFits(A, 'btc')).toBe(false)
    expect(addressFits(A, 'solana')).toBe(false)
    expect(addressFits('TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7', 'tron')).toBe(true)
    expect(normaliseAddress(A, 'base')).toBe(A.toLowerCase())
  })

  it('links to the right explorer and prices the native coin', () => {
    expect(explorerAddressUrl('0x1', 'base')).toBe('https://basescan.org/address/0x1')
    expect(explorerTxUrl('0xab', 'bsc')).toBe('https://bscscan.com/tx/0xab')
    expect(nativeAsset('polygon')).toBe('POL')
    expect(priceKey('WBNB')).toBe('BNB')
    expect(priceKey('USDC')).toBe('USD')
  })

  it('Ethereum, Bitcoin and Tron stay free; the rest are Pro', () => {
    expect(['btc', 'tron', 'eth'].map(c => isProChain(c as 'eth'))).toEqual([false, false, false])
    expect(isProChain('base')).toBe(true)
  })
})
