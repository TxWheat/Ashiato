import { EdgeData } from './types'

export interface Counterparty {
  address: string
  /** asset → amount received from this counterparty */
  received: Record<string, number>
  /** asset → amount sent to this counterparty */
  sent: Record<string, number>
  txCount: number
  receivedCount: number
  sentCount: number
  lastSeen: number
  lastReceived: number
  lastSent: number
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
    const c = map.get(other) ?? { address: other, received: {}, sent: {}, txCount: 0, receivedCount: 0, sentCount: 0, lastSeen: 0, lastReceived: 0, lastSent: 0, weight: 0 }
    const side = e.source === address ? c.sent : c.received
    side[e.asset] = (side[e.asset] ?? 0) + e.amount
    c.txCount += e.txCount ?? 1
    if (e.source === address) {
      c.sentCount += e.txCount ?? 1
      c.lastSent = Math.max(c.lastSent, e.timestamp)
    } else {
      c.receivedCount += e.txCount ?? 1
      c.lastReceived = Math.max(c.lastReceived, e.timestamp)
    }
    c.lastSeen = Math.max(c.lastSeen, e.timestamp)
    c.weight = Math.max(c.weight, e.amount / (totals.get(e.asset) || 1))
    map.set(other, c)
  }
  return [...map.values()].sort((a, b) => b.weight - a.weight)
}

export interface FlowSummary {
  /** asset → { amount, count } */
  incoming: Record<string, { amount: number; count: number }>
  outgoing: Record<string, { amount: number; count: number }>
}

/** Node-visualizer totals: everything that came in and went out, per asset (fake tokens excluded) */
export function flowSummary(address: string, edges: EdgeData[]): FlowSummary {
  const incoming: FlowSummary['incoming'] = {}
  const outgoing: FlowSummary['outgoing'] = {}
  for (const e of edges) {
    if (e.asset.endsWith('*') || e.source === e.target) continue
    const side = e.target === address ? incoming : e.source === address && !e.isChange ? outgoing : null
    if (!side) continue
    const s = side[e.asset] ?? { amount: 0, count: 0 }
    s.amount += e.amount
    s.count += e.txCount ?? 1
    side[e.asset] = s
  }
  return { incoming, outgoing }
}
