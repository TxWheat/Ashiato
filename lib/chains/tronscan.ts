import 'server-only'
import { EntityLabel } from '../types'
import { fetchJson } from '../http'
import { classifyTag } from './eth-labels'

// Tron address labels from Tronscan (the explorer), for addresses the offline label files
// don't know. Tracing itself stays on TronGrid. Tronscan tags addresses with:
//   publicTag / addressTag  a name, e.g. "Binance-Hot 3"
//   redTag                  a warning, e.g. "Scam", "Phishing", "Fake_Token"
//   blueTag                 a verified project
//   greyTag                 unverified / low-signal: not used
// Set TRONSCAN_API_KEY (free at tronscan.org → API Keys) for higher limits.

const BASE = (process.env.TRONSCAN_API_URL || 'https://apilist.tronscanapi.com').replace(/\/$/, '')

const headers = (): Record<string, string> => (process.env.TRONSCAN_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRONSCAN_API_KEY } : {})

/** Tag fields as Tronscan returns them (strings, sometimes empty or absent) */
export interface TronscanTags {
  publicTag?: unknown
  addressTag?: unknown
  redTag?: unknown
  blueTag?: unknown
  greyTag?: unknown
}

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/[\t\r\n]+/g, ' ').trim().slice(0, 80) : '')

/** Our label for an address from its Tronscan tags, or undefined when it has none worth showing */
export function labelFromTronscan(address: string, b: TronscanTags | undefined): EntityLabel | undefined {
  if (!b) return undefined
  const name = text(b.publicTag) || text(b.addressTag)
  const red = text(b.redTag)
  const blue = text(b.blueTag)
  const base = { source: 'Tronscan tag', sourceUrl: `https://tronscan.org/#/address/${address}` }
  if (red) {
    // A red tag is a warning: never let it read as a harmless service
    const type = classifyTag(red)
    return {
      ...base,
      name: name ? `${name} (${red})` : `Flagged on Tronscan: ${red}`,
      type: type === 'service' || type === 'exchange' || type === 'deposit' ? 'scam' : type,
      source: `Tronscan warning tag (${red})`,
    }
  }
  if (name) return { ...base, name, type: classifyTag(name) }
  if (blue) return { ...base, name: blue, type: classifyTag(blue) }
  return undefined
}

/** Best-effort: labels never fail a trace */
export async function tronscanLabel(address: string): Promise<EntityLabel | undefined> {
  try {
    const body = await fetchJson<TronscanTags>(`${BASE}/api/accountv2?address=${encodeURIComponent(address)}`, 86400, 2, undefined, { headers: headers() })
    return labelFromTronscan(address, body)
  } catch {
    return undefined
  }
}

/** Labels for several addresses (the ones a trace is most likely to reach) */
export async function tronscanLabels(addresses: string[]): Promise<Map<string, EntityLabel>> {
  const out = new Map<string, EntityLabel>()
  const results = await Promise.all(addresses.map(async a => [a, await tronscanLabel(a)] as const))
  for (const [a, l] of results) if (l) out.set(a, l)
  return out
}
