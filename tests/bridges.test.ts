import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { hopFromBridgers } from '@/lib/bridges/bridgers'
import { BRIDGE_NAME, chainDisplay, hopTxUrl, toOurChain } from '@/lib/bridges/types'

describe('Bridgers orders', () => {
  it('turns an order record into a cross-chain hop', () => {
    const h = hopFromBridgers({
      orderId: 'ORD-1', fromCoinCode: 'ETH', toCoinCode: 'USDT(TRON)', fromTokenAmount: '0.9175', toTokenAmount: '1742.545527',
      fromAddress: '0x32d376020b6707cc1ec634286096a15ecdabcab8', toAddress: 'TRwY5mtmqYm83BoaGwWkqTzYRqN2gGbCvk',
      fromChain: 'ETH', toChain: 'TRX', hash: '0x865e555c6fe', toHash: 'abc123', status: 'receive_complete', createTime: '2026-08-19 03:18:35',
    })
    expect(h).toMatchObject({
      fromChain: 'eth', toChain: 'tron', fromAsset: 'ETH', toAsset: 'USDT', fromAmount: 0.9175, toAmount: 1742.545527,
      toAddress: 'TRwY5mtmqYm83BoaGwWkqTzYRqN2gGbCvk', fromHash: '0x865e555c6fe', toHash: 'abc123',
    })
    // Bridgers reports Beijing time (UTC+8)
    expect(new Date(h!.time! * 1000).toISOString()).toBe('2026-08-18T19:18:35.000Z')
  })

  it('reads the chain from the coin code when the chain field is missing', () => {
    const h = hopFromBridgers({ hash: '0x1', toAddress: 'Tx', fromCoinCode: 'USDT(ETH)', toCoinCode: 'USDT(BSC)', fromTokenAmount: 5, toTokenAmount: 4.9 })
    expect(h).toMatchObject({ fromChainName: 'ETH', toChainName: 'BSC', fromChain: 'eth', toChain: undefined })
  })

  it('skips records without a hash or destination', () => {
    expect(hopFromBridgers({ toAddress: 'T1' })).toBeNull()
    expect(hopFromBridgers({ hash: '0x1' })).toBeNull()
  })

  it('recognises swap services by name and links explorers', () => {
    expect(BRIDGE_NAME.test('Bridgers (verified contract)')).toBe(true)
    expect(BRIDGE_NAME.test('Bridgers: cross-chain swap router')).toBe(true)
    expect(BRIDGE_NAME.test('Binance 14')).toBe(false)
    expect(toOurChain('trx')).toBe('tron')
    expect(chainDisplay('BSC')).toBe('BNB Chain')
    expect(hopTxUrl('TRX', 'ab')).toBe('https://tronscan.org/#/transaction/ab')
  })
})
