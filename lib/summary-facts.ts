import { Chain, EdgeData, NodeData } from './types'
import type { TracedFlow, TraceEnd } from './follow'

// The facts of a case, compact enough to send for a written summary: the traced trail,
// where it ended, exchange addresses and, without a trace, the biggest flows on the graph.

const iso = (t: number) => (t ? new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : undefined)
const round = (n: number) => Number(n.toPrecision(8))

export interface SummaryFacts {
  chain: Chain
  origin: { address: string; label?: string }
  traced: { hop: number; from: string; fromLabel?: string; to: string; toLabel?: string; amount: number; asset: string; time?: string; txid: string; why: string; poolShare?: number; swappedTo?: string }[]
  ended: { address: string; label?: string; amount: number; asset: string; reason: string; detail: string }[]
  exchanges: { address: string; label: string; type: string }[]
  flows: { from: string; fromLabel?: string; to: string; toLabel?: string; amount: number; asset: string; transactions: number; first?: string; last?: string }[]
}

export function summaryFacts(opts: {
  chain: Chain
  origin: string
  nodes: Map<string, NodeData>
  edges: EdgeData[]
  traced: TracedFlow[]
  ends: TraceEnd[]
  nameOf: (a: string) => string | undefined
}): SummaryFacts {
  const label = (a: string) => opts.nameOf(a) ?? opts.nodes.get(a)?.label?.name
  return {
    chain: opts.chain,
    origin: { address: opts.origin, label: label(opts.origin) },
    traced: opts.traced.slice(0, 150).map(f => ({
      hop: f.hop, from: f.from, fromLabel: label(f.from), to: f.to, toLabel: label(f.to),
      amount: round(f.amount), asset: f.asset, time: iso(f.time), txid: f.txid, why: f.reason,
      poolShare: f.share !== undefined ? Math.round(f.share * 100) / 100 : undefined,
      swappedTo: f.swap ? `${round(f.swap.amount)} ${f.swap.asset}` : undefined,
    })),
    ended: opts.ends.slice(0, 80).map(e => ({ address: e.address, label: label(e.address), amount: round(e.amount), asset: e.asset, reason: e.reason, detail: e.detail })),
    exchanges: [...opts.nodes.values()]
      .filter(n => n.label && ['exchange', 'deposit'].includes(n.label.type))
      .slice(0, 40)
      .map(n => ({ address: n.address, label: n.label!.name, type: n.label!.type })),
    // Without a trace, the largest flows on the graph (spam tokens, marked *, left out)
    flows: opts.traced.length ? [] : opts.edges.filter(e => !e.asset.endsWith('*'))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 40)
      .map(e => ({
        from: e.source, fromLabel: label(e.source), to: e.target, toLabel: label(e.target), amount: round(e.amount), asset: e.asset,
        transactions: e.txCount ?? e.txids?.length ?? 1, first: iso(e.firstTimestamp ?? e.timestamp), last: iso(e.timestamp),
      })),
  }
}
