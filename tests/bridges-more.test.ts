import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { hopFromAcross } from '@/lib/bridges/across'
import { hopFromRelay } from '@/lib/bridges/relay'
import { hopFromDeBridge } from '@/lib/bridges/debridge'
import { BRIDGE_NAME, lookupService, statusOk } from '@/lib/bridges/types'
import { units } from '@/lib/bridges/util'

const H = (c: string) => `0x${c.repeat(64)}`

describe('Across deposits', () => {
  // Shape as the Across indexer returns it (fields used by DefiLlama's adapter)
  const d = {
    depositId: 1234, depositor: '0x1111111111111111111111111111111111111111', recipient: '0x2222222222222222222222222222222222222222',
    inputToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', outputToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    inputAmount: '1500000000000000000', outputAmount: '1499000000000000000', originChainId: 1, destinationChainId: 42161,
    depositTxHash: H('a'), fillTx: H('b'), status: 'filled', depositBlockTimestamp: '2026-09-01T10:00:00.000Z',
  }
  it('reads both sides, chains and amounts', () => {
    expect(hopFromAcross(d)).toMatchObject({
      service: 'Across', orderId: 'across:1:1234', fromChainName: 'ETH', toChainName: 'ARBITRUM', fromChain: 'eth',
      fromAmount: 1.5, fromAsset: 'ETH', toAmount: 1.499, toAsset: 'ETH', toAddress: d.recipient, fromHash: H('a'), toHash: H('b'),
      createdText: '2026-09-01 10:00:00 UTC',
    })
    expect(statusOk('filled')).toBe(true)
  })
  it('shows no amount for a token whose decimals are unknown', () => {
    expect(hopFromAcross({ ...d, outputToken: '0x9999999999999999999999999999999999999999' })).toMatchObject({ toAmount: 0, toAsset: '0x9999…' })
  })
})

describe('Relay requests', () => {
  const r = {
    id: '0xreq', status: 'success', user: '0x1111111111111111111111111111111111111111', recipient: 'TRwY5mtmqYm83BoaGwWkqTzcjFSVodXE8k',
    createdAt: '2026-09-02T08:30:00.000Z',
    data: {
      inTxs: [{ hash: H('c'), chainId: 1 }], outTxs: [{ hash: 'd'.repeat(64), chainId: 728126428 }],
      route: { actual: {
        origin: { inputCurrency: { currency: { symbol: 'eth', chainId: 1 }, amountFormatted: '0.5' } },
        destination: { outputCurrency: { currency: { symbol: 'USDT', chainId: 728126428 }, amountFormatted: '1300.12' } },
      } },
    },
  }
  it('reads a request to Tron', () => {
    expect(hopFromRelay(r)).toMatchObject({
      service: 'Relay', fromChainName: 'ETH', toChainName: 'TRON', toChain: 'tron', fromAmount: 0.5, fromAsset: 'ETH',
      toAmount: 1300.12, toAsset: 'USDT', fromHash: H('c'), toHash: 'd'.repeat(64), toAddress: r.recipient,
    })
  })
})

describe('deBridge orders', () => {
  const o = {
    orderId: { stringValue: '0xorder' }, state: 'Fulfilled', makerSrc: { stringValue: '0x1111111111111111111111111111111111111111' },
    receiverDst: { stringValue: '0x3333333333333333333333333333333333333333' },
    giveOfferWithMetadata: { chainId: { bigIntegerValue: 1 }, amount: { bigIntegerValue: '2000000' }, metadata: { symbol: 'USDC', decimals: 6 } },
    takeOfferWithMetadata: { chainId: { bigIntegerValue: 56 }, amount: { bigIntegerValue: '1990000000000000000' }, metadata: { symbol: 'USDT', decimals: 18 } },
    createdSrcEventMetadata: { transactionHash: { stringValue: H('e') }, blockTimeStamp: 1788000000 },
    fulfilledDstEventMetadata: { transactionHash: { stringValue: H('f') } },
  }
  it('unwraps values and reads both sides', () => {
    expect(hopFromDeBridge(o, H('e'))).toMatchObject({
      service: 'deBridge', orderId: 'debridge:0xorder', fromChainName: 'ETH', toChainName: 'BSC', fromAmount: 2, fromAsset: 'USDC',
      toAmount: 1.99, toAsset: 'USDT', toAddress: '0x3333333333333333333333333333333333333333', fromHash: H('e'), toHash: H('f'),
    })
    expect(statusOk('Fulfilled')).toBe(true)
  })
})

describe('which service to ask', () => {
  it('reads it from the bridge label', () => {
    expect(lookupService('Across Protocol: Spoke Pool')).toBe('Across')
    expect(lookupService('Relay: Router')).toBe('Relay')
    expect(lookupService('deBridge: DLN Source')).toBe('deBridge')
    expect(lookupService('Bridgers: cross-chain swap router')).toBe('Bridgers')
    expect(lookupService('Authereum: Relayer 0010')).toBeUndefined()
    expect(BRIDGE_NAME.test('Authereum: Relayer 0010')).toBe(false)
  })
  it('converts raw amounts exactly', () => {
    expect(units('1990000000000000000', 18)).toBe(1.99)
    expect(units('5', 6)).toBe(0.000005)
  })
})
