// Valuing amounts: at the time they moved (daily history) or at today's price

export type PriceHistory = Record<string, Record<number, number>>

const STABLE = /^(USDT|USDC|DAI|BUSD|FDUSD|PYUSD|TUSD|USDE)$/

/** Which price series an asset uses */
export const priceKey = (asset: string) => (asset === 'WETH' ? 'ETH' : STABLE.test(asset) ? 'USD' : asset)

/** Closing price on the day of `ts` (or the nearest earlier day within a week) */
export function priceOn(history: PriceHistory | null, asset: string, ts: number): number | undefined {
  const days = history?.[priceKey(asset)]
  if (!days || !ts) return undefined
  const day = Math.floor(ts / 86400)
  for (let d = day; d > day - 7; d--) if (days[d]) return days[d]
  return undefined
}

export interface Pricing {
  /** Today's prices by asset */
  today: Record<string, number>
  history: PriceHistory | null
  /** Value transfers at the time they moved (true) or at today's price */
  atTransfer: boolean
}

/** Value of `amount` of `asset` moved at `ts`; falls back to today's price when history is missing */
export function valueAt(p: Pricing, amount: number, asset: string, ts?: number): number {
  const then = p.atTransfer && ts ? priceOn(p.history, asset, ts) : undefined
  const price = then ?? p.today[priceKey(asset)] ?? p.today[asset] ?? 0
  return price ? amount * price : 0
}

/** An aggregated line's value: each transaction at its own time */
export function edgeValue(p: Pricing, e: { amount: number; asset: string; timestamp: number; parts?: { amount: number; timestamp: number }[] }): number {
  return e.parts?.length ? e.parts.reduce((v, x) => v + valueAt(p, x.amount, e.asset, x.timestamp), 0) : valueAt(p, e.amount, e.asset, e.timestamp)
}
