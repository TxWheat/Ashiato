// Shared by the bridge API clients: tolerant field readers and chain ids

export type Raw = Record<string, unknown>

export const str = (v: unknown): string => {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  // deBridge wraps values: { stringValue } / { bigIntegerValue }
  if (v && typeof v === 'object') {
    const o = v as Raw
    for (const k of ['stringValue', 'bigIntegerValue', 'value']) if (o[k] !== undefined) return str(o[k])
  }
  return ''
}
export const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(str(v))
  return Number.isFinite(n) ? n : 0
}
export const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {})
export const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Raw[] : [])

/** Raw integer amount → units, without losing precision on 18-decimal numbers first */
export function units(raw: string, decimals: number): number {
  if (!/^\d+$/.test(raw)) return num(raw)
  const s = raw.padStart(decimals + 1, '0')
  return Number(`${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)}`)
}

/** EVM chain ids (and the ids bridges use for other chains) → the short names hops use */
const CHAIN_BY_ID: Record<string, string> = {
  1: 'ETH', 10: 'OPTIMISM', 56: 'BSC', 100: 'GNOSIS', 130: 'UNICHAIN', 137: 'POLYGON', 250: 'FANTOM', 324: 'ZKSYNC',
  480: 'WORLD', 999: 'HYPEREVM', 5000: 'MANTLE', 8453: 'BASE', 9745: 'PLASMA', 34443: 'MODE', 42161: 'ARBITRUM',
  43114: 'AVAX', 59144: 'LINEA', 81457: 'BLAST', 534352: 'SCROLL', 7777777: 'ZORA',
  // Non-EVM chains, as Across / Relay / deBridge number them
  728126428: 'TRON', 34268394551451: 'SOLANA', 792703809: 'SOLANA', 7565164: 'SOLANA', 8253038: 'BTC', 100000026: 'TRON',
}
export const chainName = (id: unknown) => CHAIN_BY_ID[str(id)] ?? (str(id) ? `Chain ${str(id)}` : '?')
