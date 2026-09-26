import 'server-only'
import { EntityLabel } from './types'

// ScamSniffer's database (GPL-3.0) of phishing and wallet-drainer addresses. It isn't
// copied into this repo; the server downloads it and keeps it for a few hours.
const SCAMSNIFFER_URL = process.env.SCAMSNIFFER_URL || 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json'
const REFRESH_MS = 6 * 3600 * 1000

let addresses: Set<string> | null = null
let loadedAt = 0
let pending: Promise<void> | null = null

async function refresh() {
  try {
    const res = await fetch(SCAMSNIFFER_URL, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return
    const list = (await res.json()) as unknown
    if (!Array.isArray(list)) return
    addresses = new Set(list.filter((a): a is string => typeof a === 'string').map(a => a.toLowerCase()))
    loadedAt = Date.now()
  } catch {
    // Keep the last copy (or none): a missing list only means fewer labels
  } finally {
    pending = null
  }
}

/** Call before labelling Ethereum addresses; cheap once the list is loaded */
export async function warmScamLists(): Promise<void> {
  if (addresses && Date.now() - loadedAt < REFRESH_MS) return
  pending ??= refresh()
  // The first request waits for the list; later refreshes happen in the background
  if (!addresses) await pending
}

export function scamSnifferLabel(address: string): EntityLabel | undefined {
  if (!addresses?.has(address.toLowerCase())) return undefined
  return {
    name: 'Phishing / wallet drainer (ScamSniffer)',
    type: 'scam',
    source: 'ScamSniffer scam database (GPL-3.0, fetched at runtime)',
    sourceUrl: 'https://github.com/scamsniffer/scam-database',
  }
}
