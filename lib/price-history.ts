import 'server-only'
import { fetchJson } from './http'
import { CurrencyCode } from './currency'

// Daily closing prices from CryptoCompare (CoinDesk Data): one request per coin returns
// up to 2,000 days, in any currency, so every transaction can be valued on its day.
//   GET https://min-api.cryptocompare.com/data/v2/histoday?fsym=ETH&tsym=NZD&limit=2000
// Works without a key at low volume; CRYPTOCOMPARE_API_KEY raises the limits.

const BASE = (process.env.CRYPTOCOMPARE_API_URL || 'https://min-api.cryptocompare.com').replace(/\/$/, '')

/** Our asset → the coin whose price it uses (stablecoins are valued as USDT) */
const COINS: Record<string, string> = { BTC: 'BTC', ETH: 'ETH', TRX: 'TRX', USD: 'USDT', BNB: 'BNB', POL: 'POL' }
/** Coins added with the extra networks: a gap in their history never fails the rest */
const OPTIONAL = new Set(['BNB', 'POL'])

interface HistoDay { Response?: string; Message?: string; Data?: { Data?: { time: number; close: number }[] } }

/** { ETH: { [dayNumber]: close }, ... } where dayNumber = floor(unixSeconds / 86400) */
export async function dailyPrices(currency: CurrencyCode): Promise<Record<string, Record<number, number>>> {
  const key = process.env.CRYPTOCOMPARE_API_KEY
  const headers: Record<string, string> = key ? { authorization: `Apikey ${key}` } : {}
  const out: Record<string, Record<number, number>> = {}
  await Promise.all(Object.entries(COINS).map(async ([asset, coin]) => {
    const res = await fetchJson<HistoDay>(`${BASE}/data/v2/histoday?fsym=${coin}&tsym=${currency}&limit=2000`, 6 * 3600, 2, undefined, { headers })
      .catch(e => { if (OPTIONAL.has(asset)) return { Data: { Data: [] } } as HistoDay; throw e })
    if (res.Response === 'Error') {
      if (OPTIONAL.has(asset)) return
      throw new Error(`Price history: ${res.Message ?? 'request failed'}`)
    }
    const days: Record<number, number> = {}
    for (const d of res.Data?.Data ?? []) if (d.close > 0) days[Math.floor(d.time / 86400)] = d.close
    out[asset] = days
  }))
  return out
}
