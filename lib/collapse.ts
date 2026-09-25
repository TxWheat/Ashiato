import { EdgeData } from './types'
import type { TracedFlow } from './follow'

/** A run of pass-through hops drawn as one line */
export interface CollapsedChain {
  /** `${from}=>${to}` */
  id: string
  from: string
  to: string
  /** Addresses hidden inside the run, in order */
  middle: string[]
  hops: number
  asset: string
  firstAmount: number
  lastAmount: number
  firstTime: number
  lastTime: number
}

/**
 * Finds runs like A → m1 → m2 → … → B where every middle address has exactly one
 * link in and one link out on the chart (a peel chain or relay), and collapses runs
 * of at least `minHops` hops. Addresses in `keep` (origin, selected, labelled, noted)
 * are never hidden; runs in `expanded` are left alone.
 */
export function collapseChains(opts: {
  nodes: string[]
  edges: EdgeData[]
  traced: TracedFlow[]
  keep: Set<string>
  expanded: Set<string>
  minHops?: number
}): { chains: CollapsedChain[]; hidden: Set<string> } {
  const minHops = opts.minHops ?? 3
  const nodeSet = new Set(opts.nodes)
  const outs = new Map<string, Set<string>>()
  const ins = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    if (a === b || !nodeSet.has(a) || !nodeSet.has(b)) return
    if (!outs.has(a)) outs.set(a, new Set())
    if (!ins.has(b)) ins.set(b, new Set())
    outs.get(a)!.add(b)
    ins.get(b)!.add(a)
  }
  for (const e of opts.edges) link(e.source, e.target)
  for (const f of opts.traced) link(f.from, f.to)

  const isMid = (x: string) => {
    if (!nodeSet.has(x) || opts.keep.has(x)) return false
    const i = ins.get(x), o = outs.get(x)
    if (i?.size !== 1 || o?.size !== 1) return false
    return [...i][0] !== [...o][0] // not a there-and-back
  }

  // Amount and time of the hop a → b (traced flows first, else the relationship)
  const hop = (a: string, b: string) => {
    const f = opts.traced.filter(x => x.from === a && x.to === b)
    if (f.length) return { amount: f.reduce((s, x) => s + x.amount, 0), asset: f[0].asset, time: Math.min(...f.map(x => x.time)) }
    const e = opts.edges.filter(x => x.source === a && x.target === b)
    return e.length ? { amount: e[0].amount, asset: e[0].asset, time: e[0].timestamp } : { amount: 0, asset: '', time: 0 }
  }

  const chains: CollapsedChain[] = []
  const hidden = new Set<string>()
  for (const start of opts.nodes) {
    if (isMid(start)) continue
    for (const first of outs.get(start) ?? []) {
      if (!isMid(first)) continue
      const path = [start]
      let cur = first
      while (isMid(cur) && !path.includes(cur)) {
        path.push(cur)
        cur = [...outs.get(cur)!][0]
      }
      if (isMid(cur) || path.includes(cur)) continue // loops back on itself
      path.push(cur)
      const hops = path.length - 1
      const id = `${start}=>${cur}`
      if (hops < minHops || opts.expanded.has(id)) continue
      const steps = path.slice(1).map((b, k) => hop(path[k], b))
      const times = steps.map(s => s.time).filter(Boolean)
      path.slice(1, -1).forEach(x => hidden.add(x))
      chains.push({
        id, from: start, to: cur, middle: path.slice(1, -1), hops,
        asset: steps.find(s => s.asset)?.asset ?? '',
        firstAmount: steps[0].amount,
        lastAmount: steps[steps.length - 1].amount,
        firstTime: times.length ? Math.min(...times) : 0,
        lastTime: times.length ? Math.max(...times) : 0,
      })
    }
  }
  return { chains, hidden }
}
