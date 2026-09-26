import { describe, expect, it } from 'vitest'
import { currencyForLocale, fmtMoney } from '@/lib/currency'

describe('display currency', () => {
  it('picks a default from the browser region', () => {
    expect(currencyForLocale('en-NZ')).toBe('NZD')
    expect(currencyForLocale('en-GB')).toBe('GBP')
    expect(currencyForLocale('de-DE')).toBe('EUR')
    expect(currencyForLocale('ja-JP')).toBe('JPY')
    expect(currencyForLocale('en')).toBe('USD')
  })
  it('names dollar currencies, not unambiguous symbols', () => {
    expect(fmtMoney(2900, 'NZD')).toBe('$2.9K NZD')
    expect(fmtMoney(2900, 'EUR')).toBe('€2.9K')
    expect(fmtMoney(29166.4, 'NZD', true)).toBe('$29,166 NZD')
    expect(fmtMoney(0, 'USD')).toBe('')
  })
})
