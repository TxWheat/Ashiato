import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { labelFromTronscan } from '@/lib/chains/tronscan'

const A = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G'

describe('Tronscan tags', () => {
  it('names exchanges from their public tag', () => {
    expect(labelFromTronscan(A, { publicTag: 'Binance-Hot 3' })).toMatchObject({ name: 'Binance-Hot 3', type: 'exchange', source: 'Tronscan tag' })
    expect(labelFromTronscan(A, { addressTag: 'HTX 12', publicTag: '' })).toMatchObject({ name: 'HTX 12', type: 'exchange' })
  })

  it('a red tag is always a warning, even on a named address', () => {
    expect(labelFromTronscan(A, { redTag: 'Scam' })).toMatchObject({ name: 'Flagged on Tronscan: Scam', type: 'scam' })
    expect(labelFromTronscan(A, { publicTag: 'Fake Binance', redTag: 'Phishing' })).toMatchObject({ name: 'Fake Binance (Phishing)', type: 'scam' })
    expect(labelFromTronscan(A, { redTag: 'Hack' })?.type).toBe('hack')
  })

  it('verified projects read as services; grey tags and empty bodies are ignored', () => {
    expect(labelFromTronscan(A, { blueTag: 'JustLend' })).toMatchObject({ name: 'JustLend', type: 'service' })
    expect(labelFromTronscan(A, { greyTag: 'Suspicious' })).toBeUndefined()
    expect(labelFromTronscan(A, {})).toBeUndefined()
    expect(labelFromTronscan(A, { publicTag: 42 })).toBeUndefined()
  })
})
