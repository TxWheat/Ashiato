import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { edgeValue, priceOn, valueAt, Pricing } from '@/lib/prices'
import { dailyPrices } from '@/lib/price-history'
import { aggregateEdges } from '@/lib/graph'

const DAY = 86400
const d = (n: number) => n * DAY + 3600 // a time during day n

describe('valuing transfers', () => {
  const history = { ETH: { 100: 2000, 101: 3000 }, USD: { 100: 1.6 } }
  const p: Pricing = { today: { ETH: 4000, USD: 1.7 }, history, atTransfer: true }

  it('uses the price on the day of the transfer', () => {
    expect(valueAt(p, 2, 'ETH', d(100))).toBe(4000)
    expect(valueAt(p, 2, 'WETH', d(101))).toBe(6000)
    expect(valueAt(p, 10, 'USDT', d(100))).toBe(16)
  })
  it("falls back to the nearest earlier day, then to today's price", () => {
    expect(priceOn(history, 'ETH', d(103))).toBe(3000)
    expect(valueAt(p, 1, 'ETH', d(50))).toBe(4000)
    expect(valueAt({ ...p, atTransfer: false }, 1, 'ETH', d(100))).toBe(4000)
  })
  it('values a line of several transactions each at its own time', () => {
    const [e] = aggregateEdges([
      { id: 'a', source: 'x', target: 'y', amount: 1, asset: 'ETH', txid: 't1', timestamp: d(100), chain: 'eth' },
      { id: 'b', source: 'x', target: 'y', amount: 1, asset: 'ETH', txid: 't2', timestamp: d(101), chain: 'eth' },
    ])
    expect(edgeValue(p, e)).toBe(5000)
  })
})

describe('CryptoCompare daily history', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reads daily closes into day numbers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({
      Response: 'Success', Data: { Data: [{ time: 100 * DAY, close: url.includes('fsym=ETH') ? 2000 : 1 }, { time: 101 * DAY, close: 0 }] },
    }))))
    const prices = await dailyPrices('NZD')
    expect(prices.ETH).toEqual({ 100: 2000 })
    expect(Object.keys(prices).sort()).toEqual(['BTC', 'ETH', 'TRX', 'USD'])
  })
})
