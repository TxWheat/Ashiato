import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { hopFromAcross } from '@/lib/bridges/across'
import { hopFromRelay, relayRequests } from '@/lib/bridges/relay'
import { hopFromDeBridge } from '@/lib/bridges/debridge'
import { BRIDGE_NAME, lookupService, statusOk, statusText } from '@/lib/bridges/types'
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

describe('Across deposits (real API response, 26 Sep 2026)', () => {
  const filled = {
    id: 23782332, relayHash: '0xd2358bd6acb5a7f4add8049092613688bbb00d97535d700b4a1df3396ef536a2',
    depositId: '80717180384455562337988542929525184276410883053225890329314745146466711328707', originChainId: 42161, destinationChainId: 8453,
    depositor: '0x2890c52D0D49537C75ECc7d4720F861e89b6D371', recipient: '0xfB1B9D621011b47C18CC425bfbC677C28a337Bc0',
    inputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', inputAmount: '10000000', outputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', outputAmount: '10000000',
    depositTxHash: '0xcdf28c3f71d8826260654123cd85e5d7388ea7fec0a8513feefd68941075104d', depositBlockTimestamp: '2026-09-26T03:50:06.000Z', status: 'filled',
    fillTx: '0x4dbccfb0f343166a9209543b3ec0aafe4e74dbce41b1fc33d587392a94378f1d', depositTxnRef: '0xcdf28c3f71d8826260654123cd85e5d7388ea7fec0a8513feefd68941075104d',
    fillTxnRef: '0x4dbccfb0f343166a9209543b3ec0aafe4e74dbce41b1fc33d587392a94378f1d',
  }
  it('reads a filled Arbitrum → Base USDC transfer', () => {
    expect(hopFromAcross(filled)).toMatchObject({
      fromChainName: 'ARBITRUM', toChainName: 'BASE', fromAmount: 10, fromAsset: 'USDC', toAmount: 10, toAsset: 'USDC',
      toAddress: '0xfB1B9D621011b47C18CC425bfbC677C28a337Bc0', toHash: filled.fillTx, status: 'filled',
      orderId: `across:42161:${filled.depositId}`,
    })
  })
  it('reads an unfilled one (no payout yet)', () => {
    const h = hopFromAcross({ ...filled, originChainId: 4663, destinationChainId: 1, inputToken: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', inputAmount: '2200000000000000',
      outputToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', outputAmount: '2190558810991781', status: 'unfilled', fillTx: null, fillTxnRef: null })
    expect(h).toMatchObject({ fromChainName: 'ROBINHOOD', toChainName: 'ETH', toAsset: 'ETH', toHash: undefined, fromAmount: 0 })
    expect(h?.toAmount).toBeCloseTo(0.00219056)
    expect(statusText('unfilled')).toBe('Not filled yet')
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

describe('Relay API key', () => {
  it('explains that a key is needed instead of failing obscurely', async () => {
    const saved = process.env.RELAY_API_KEY
    delete process.env.RELAY_API_KEY
    await expect(relayRequests('0x1111111111111111111111111111111111111111')).rejects.toThrow(/RELAY_API_KEY/)
    if (saved !== undefined) process.env.RELAY_API_KEY = saved
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
