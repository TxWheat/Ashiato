import { EntityType, TraceResult } from './types'

// Recursive crawl with a per-hop top-K filter (idea from s0md3v/Orbit),
// stopping at "cash-out" entities. `backward` with topK=1 is the dominant-path
// source-of-funds walk from peterzen/heuristic.

export interface AutoTraceOptions {
  direction: 'forward' | 'backward'
  depth: number
  topK: number
  /** Do not expand past these entity types (the trail ends there) */
  stopAt: EntityType[]
}

export const DEFAULT_STOP: EntityType[] = ['exchange', 'deposit', 'mixer', 'coinjoin', 'sanctioned', 'defi']

export interface AutoTraceStep {
  hop: number
  from: string
  result: TraceResult
  picked: string[]
}

export async function autoTrace(
  start: string,
  opts: AutoTraceOptions,
  fetchPage: (address: string) => Promise<TraceResult>,
  onStep: (step: AutoTraceStep) => void,
  isCancelled: () => boolean
): Promise<{ visited: number; stoppedAt: string[] }> {
  const visited = new Set<string>([start])
  const stoppedAt: string[] = []
  let frontier = [start]

  for (let hop = 1; hop <= opts.depth && frontier.length; hop++) {
    const next: string[] = []
    for (const addr of frontier) {
      if (isCancelled()) return { visited: visited.size, stoppedAt }
      let result: TraceResult
      try {
        result = await fetchPage(addr)
      } catch {
        continue
      }

      // Rank counterparties by their share of this address's flow in each asset,
      // so BTC, ETH and token amounts are comparable
      const edges = result.edges.filter(e =>
        opts.direction === 'forward' ? e.source === addr && !e.isChange : e.target === addr
      )
      const assetTotal = new Map<string, number>()
      for (const e of edges) assetTotal.set(e.asset, (assetTotal.get(e.asset) ?? 0) + e.amount)
      const score = new Map<string, number>()
      for (const e of edges) {
        const other = opts.direction === 'forward' ? e.target : e.source
        if (other === addr) continue
        const s = e.amount / (assetTotal.get(e.asset) || 1)
        score.set(other, Math.max(score.get(other) ?? 0, s))
      }
      const picked = [...score.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, opts.topK)
        .map(([a]) => a)

      onStep({ hop, from: addr, result, picked })

      for (const p of picked) {
        if (visited.has(p)) continue
        visited.add(p)
        const type = result.nodes.find(n => n.address === p)?.label?.type
        if (type && opts.stopAt.includes(type)) stoppedAt.push(p)
        else next.push(p)
      }
    }
    frontier = next
  }
  return { visited: visited.size, stoppedAt }
}
