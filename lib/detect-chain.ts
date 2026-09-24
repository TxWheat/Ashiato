import { Chain } from './types'

export function detectChain(input: string): Chain | null {
  const t = input.trim()
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) return 'eth'
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(t)) return 'btc'
  // bech32 / bech32m addresses are valid in all-lower or all-upper case
  if (/^bc1[a-z0-9]{6,87}$/.test(t) || /^BC1[A-Z0-9]{6,87}$/.test(t)) return 'btc'
  return null
}

/** Canonical form used as node IDs and label keys */
export function normaliseAddress(address: string, chain: Chain): string {
  const a = address.trim()
  if (chain === 'eth') return a.toLowerCase()
  return /^bc1/i.test(a) ? a.toLowerCase() : a
}

export function truncate(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address
  return `${address.slice(0, chars)}...${address.slice(-4)}`
}
