import { describe, expect, it } from 'vitest'
import { topAssets } from '@/lib/format'

const prices = { ETH: 4500, USD: 1.7 }

describe('topAssets', () => {
  it('ranks by NZD value, not raw amount', () => {
    const { shown } = topAssets([['ETH', 0.27], ['USDT', 2150]], prices)
    expect(shown.map(([a]) => a)).toEqual(['USDT', 'ETH'])
  })

  it('hides obscure and fake tokens behind a count when real assets moved', () => {
    const { shown, rest } = topAssets([['SHHH', 401], ['USDT', 300], ['GHOST', 8.7], ['USDT*', 5]], prices)
    expect(shown.map(([a]) => a)).toEqual(['USDT'])
    expect(rest).toBe(3)
  })

  it('names obscure tokens when nothing else moved', () => {
    const { shown, rest } = topAssets([['SHHH', 401], ['GHOST', 8.7], ['SP', 1]], prices)
    expect(shown).toHaveLength(2)
    expect(rest).toBe(1)
  })
})
