import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { hopFromBridgers } from '@/lib/bridges/bridgers'
import { BRIDGE_NAME, chainDisplay, hopTxUrl, statusText, toOurChain } from '@/lib/bridges/types'

describe('Bridgers orders', () => {
  // A real record (Bridgers API, 0x32d3…cab8, 19 Aug 2026)
  const real = {
    id: 7502507, orderId: 'pmhhfwqw_ordo_l9bd_2lqt_jkh4uzs7eulu', fromTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', toTokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    fromTokenAmount: '0.9175', toTokenAmount: '1742.545527', fromAmount: '917500000000000000', toAmount: '1742545527', fromDecimals: '18', toDecimals: '6',
    fromAddress: '0x32d376020B6707Cc1ec634286096a15eCDAbcAB8', fromChain: 'ETH', toChain: 'TRON',
    hash: '0x865e555c6fe289ac93bc27e5a4d5ef20fab74650ff47b142d6f7658b2e7adc7e',
    depositHashExplore: 'https://cn.etherscan.com/tx/0x865e555c6fe289ac93bc27e5a4d5ef20fab74650ff47b142d6f7658b2e7adc7e',
    status: 'receive_complete', createTime: '2026-08-19 20:19:13', finishTime: '2026-08-19 20:21:50',
    toAddress: 'TRwY5mtmqYm83BoaGwWkqTzcjFSVodXE8k', toHash: 'a902c7eeaef9960b691a75dad0949a0ad3b0f669a412ab2c778e9e5b83da0dbe',
    receiveHashExplore: 'https://tronscan.io/#/transaction/a902c7eeaef9960b691a75dad0949a0ad3b0f669a412ab2c778e9e5b83da0dbe',
    refundHash: '', refundHashExplore: '', fromCoinCode: 'ETH', toCoinCode: 'USDT(TRON)',
  }

  it('turns a real Bridgers order into a cross-chain hop', () => {
    expect(hopFromBridgers(real)).toMatchObject({
      orderId: 'pmhhfwqw_ordo_l9bd_2lqt_jkh4uzs7eulu', fromChainName: 'ETH', toChainName: 'TRON', fromChain: 'eth', toChain: 'tron',
      fromAsset: 'ETH', toAsset: 'USDT', fromAmount: 0.9175, toAmount: 1742.545527,
      toAddress: 'TRwY5mtmqYm83BoaGwWkqTzcjFSVodXE8k', fromHash: real.hash, toHash: real.toHash,
      depositUrl: real.depositHashExplore, receiveUrl: real.receiveHashExplore, refundHash: undefined, createdText: '2026-08-19 20:19:13',
    })
  })

  it('never reads base units (wei) as the amount', () => {
    expect(hopFromBridgers({ ...real, fromTokenAmount: undefined })?.fromAmount).toBe(0)
  })

  it('handles BNB Chain sources', () => {
    const h = hopFromBridgers({ ...real, fromChain: 'BSC', fromCoinCode: 'BNB(BSC)', fromTokenAmount: '4.5' })
    expect(h).toMatchObject({ fromChainName: 'BSC', fromChain: undefined, fromAsset: 'BNB', fromAmount: 4.5, toChain: 'tron' })
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
    expect(statusText('receive_complete')).toBe('Completed')
    expect(statusText('some_new_state')).toBe('some new state')
  })
})
