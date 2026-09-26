// Display currencies for values (prices come from CoinGecko in the chosen currency)

export const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US dollar' },
  { code: 'NZD', symbol: '$', name: 'New Zealand dollar' },
  { code: 'AUD', symbol: '$', name: 'Australian dollar' },
  { code: 'CAD', symbol: '$', name: 'Canadian dollar' },
  { code: 'SGD', symbol: '$', name: 'Singapore dollar' },
  { code: 'HKD', symbol: '$', name: 'Hong Kong dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese yen' },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss franc' },
  { code: 'KRW', symbol: '₩', name: 'South Korean won' },
  { code: 'INR', symbol: '₹', name: 'Indian rupee' },
] as const

export type CurrencyCode = (typeof CURRENCIES)[number]['code']

const BY_CODE = new Map<string, (typeof CURRENCIES)[number]>(CURRENCIES.map(c => [c.code, c]))
export const isCurrency = (c: unknown): c is CurrencyCode => typeof c === 'string' && BY_CODE.has(c)

const EURO_REGIONS = new Set(['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'])
const BY_REGION: Record<string, CurrencyCode> = { NZ: 'NZD', AU: 'AUD', CA: 'CAD', SG: 'SGD', HK: 'HKD', GB: 'GBP', JP: 'JPY', CH: 'CHF', KR: 'KRW', IN: 'INR' }

/** From the browser's language region (en-NZ → NZD); USD when unknown */
export function currencyForLocale(locale: string): CurrencyCode {
  const region = locale.split(/[-_]/)[1]?.toUpperCase() ?? ''
  return BY_REGION[region] ?? (EURO_REGIONS.has(region) ? 'EUR' : 'USD')
}

/** "$2.9K NZD", "€2.9K", "¥420K": dollar amounts name their currency, other symbols are clear on their own */
export function fmtMoney(v: number, code: CurrencyCode, full = false): string {
  if (!(v > 0)) return ''
  const c = BY_CODE.get(code)!
  const n = full || v < 1000
    ? v.toLocaleString('en-US', { maximumFractionDigits: full ? (v >= 100 ? 0 : 2) : v >= 10 ? 0 : 2 })
    : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  return `${c.symbol}${n}${c.symbol === '$' ? ` ${code}` : ''}`
}
