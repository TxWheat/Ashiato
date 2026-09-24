import { EdgeData } from './types'

export interface Counterparty {
  address: string
  /** asset → amount received from this counterparty */
  received: Record<string, number>
  /** asset → amount sent to this counterparty */
  sent: Record<string, number>
  txCount: number
  lastSeen: number
  /** Largest share of any single asset's flow; used for ranking */
  weight: number
}

/** Everyone `address` exchanged value with (per loaded transactions), largest first. Change is excluded. */
export function counterparties(address: string, edges: EdgeData[]): Counterparty[] {
  const mine = edges.filter(e => (e.source === address || e.target === address) && e.source !== e.target && !(e.source === address && e.isChange))
  const totals = new Map<string, number>()
  for (const e of mine) totals.set(e.asset, (totals.get(e.asset) ?? 0) + e.amount)

  const map = new Map<string, Counterparty>()
  for (const e of mine) {
    const other = e.source === address ? e.target : e.source
    const c = map.get(other) ?? { address: other, received: {}, sent: {}, txCount: 0, lastSeen: 0, weight: 0 }
    const side = e.source === address ? c.sent : c.received
    side[e.asset] = (side[e.asset] ?? 0) + e.amount
    c.txCount += e.txCount ?? 1
    c.lastSeen = Math.max(c.lastSeen, e.timestamp)
    c.weight = Math.max(c.weight, e.amount / (totals.get(e.asset) || 1))
    map.set(other, c)
  }
  return [...map.values()].sort((a, b) => b.weight - a.weight)
}
