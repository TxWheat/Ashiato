import { Chain } from './types'

export function detectChain(input: string): Chain | null {
  const t = input.trim()
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) return 'eth'
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(t)) return 'btc'
  if (/^bc1[a-z0-9]{6,87}$/.test(t)) return 'btc'
  return null
}

export function truncate(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address
  return `${address.slice(0, chars)}...${address.slice(-4)}`
}
