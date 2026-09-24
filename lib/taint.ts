import { RawTransaction } from './types'

// Taint analysis: how much of the funds from a "dirty" source reached each
// address. Methods as described by TrailBit-Labs/TaintTrail and tintiron/taintedtx:
//
//  poison  – any tainted input taints every output in full (upper bound)
//  haircut – each output gets taint in proportion to tainted/total input value
//  fifo    – first-in-first-out: tainted value fills outputs in order (Clayton's case)
//
// BTC is traced exactly through UTXOs (each input points at the output it spends).
// ETH is account-based, so each address keeps a running balance: haircut uses its
// tainted share, FIFO a queue of received lots. Only loaded transactions are used,
// so results are a lower bound on how far the money actually spread.

export type TaintMethod = 'poison' | 'haircut' | 'fifo'

export interface TaintResult {
  method: TaintMethod
  asset: string
  seeds: string[]
  /** Total tainted value that entered / left each address */
  byAddress: Map<string, { received: number; sent: number }>
  /** Tainted value per `from->to` pair */
  byEdge: Map<string, number>
  /** Non-seed addresses holding taint, most first */
  reached: { address: string; received: number; remaining: number }[]
  txsUsed: number
}

const EPS = 1e-12

export function edgeKey(from: string, to: string) {
  return `${from}->${to}`
}

function dedupe(txs: RawTransaction[], asset: string) {
  const m = new Map<string, RawTransaction>()
  for (const t of txs) if (t.asset === asset) m.set(`${t.txid}:${t.kind ?? ''}:${t.inputs[0]?.address ?? ''}:${t.outputs[0]?.address ?? ''}`, t)
  return [...m.values()]
}

/** Orders BTC txs so every tx comes after the txs whose outputs it spends */
function topoSort(txs: RawTransaction[]): RawTransaction[] {
  const byId = new Map(txs.map(t => [t.txid, t]))
  const sorted = [...txs].sort((a, b) => (a.timestamp || Infinity) - (b.timestamp || Infinity))
  const done = new Set<string>()
  const out: RawTransaction[] = []
  const visit = (t: RawTransaction, stack: Set<string>) => {
    if (done.has(t.txid) || stack.has(t.txid)) return
    stack.add(t.txid)
    for (const i of t.inputs) {
      const parent = i.prev ? byId.get(i.prev.split(':')[0]) : undefined
      if (parent) visit(parent, stack)
    }
    done.add(t.txid)
    out.push(t)
  }
  for (const t of sorted) visit(t, new Set())
  return out
}

export function runTaint(
  allTxs: RawTransaction[],
  seedAddrs: string[],
  method: TaintMethod,
  asset: string
): TaintResult {
  const seeds = new Set(seedAddrs)
  const txs = dedupe(allTxs, asset)
  const byAddress = new Map<string, { received: number; sent: number }>()
  const byEdge = new Map<string, number>()
  const acc = (a: string) => {
    let e = byAddress.get(a)
    if (!e) byAddress.set(a, (e = { received: 0, sent: 0 }))
    return e
  }
  const addEdge = (from: string, to: string, v: number) => {
    if (v <= EPS || from === to) return
    byEdge.set(edgeKey(from, to), (byEdge.get(edgeKey(from, to)) ?? 0) + v)
  }
  let used = 0

  const isUtxo = txs.length > 0 && txs[0].chain === 'btc'

  if (isUtxo) {
    const utxoTaint = new Map<string, number>()
    for (const tx of topoSort(txs)) {
      const ins = tx.inputs.map(i => ({
        address: i.address,
        value: i.amount,
        taint: i.prev !== undefined && utxoTaint.has(i.prev)
          ? utxoTaint.get(i.prev)!
          : seeds.has(i.address) ? i.amount : 0,
      }))
      const totalIn = ins.reduce((s, i) => s + i.value, 0)
      const taintIn = ins.reduce((s, i) => s + i.taint, 0)
      if (taintIn <= EPS || totalIn <= 0) continue
      used++
      const outs = [...tx.outputs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      const outTaint: number[] = []

      if (method === 'poison') {
        outs.forEach(o => outTaint.push(o.amount))
      } else if (method === 'haircut') {
        const r = taintIn / totalIn
        outs.forEach(o => outTaint.push(o.amount * r))
      } else {
        // FIFO: lay inputs end to end, then cut the line into outputs
        const segs: { start: number; end: number; frac: number }[] = []
        let pos = 0
        for (const i of ins) {
          segs.push({ start: pos, end: pos + i.value, frac: i.value > 0 ? i.taint / i.value : 0 })
          pos += i.value
        }
        let cursor = 0
        for (const o of outs) {
          const a = cursor
          const b = cursor + o.amount
          let t = 0
          for (const s of segs) t += Math.max(0, Math.min(b, s.end) - Math.max(a, s.start)) * s.frac
          outTaint.push(t)
          cursor = b
        }
      }

      for (const i of ins) if (i.taint > EPS) acc(i.address).sent += i.taint
      outs.forEach((o, k) => {
        const t = Math.min(o.amount, outTaint[k])
        if (o.index !== undefined) utxoTaint.set(`${tx.txid}:${o.index}`, t)
        if (t <= EPS) return
        acc(o.address).received += t
        for (const i of ins) if (i.taint > EPS) addEdge(i.address, o.address, (t * i.taint) / taintIn)
      })
    }
  } else {
    // Account model
    const poisoned = new Set<string>()
    const hc = new Map<string, { bal: number; t: number }>()
    const lots = new Map<string, { amt: number; taint: number }[]>()
    const ordered = [...txs].sort((a, b) => a.timestamp - b.timestamp)

    for (const tx of ordered) {
      const from = tx.inputs[0]?.address
      const to = tx.outputs[0]?.address
      const v = tx.outputs[0]?.amount ?? 0
      if (!from || !to || v <= 0) continue
      let tt = 0

      if (seeds.has(from)) {
        tt = v
      } else if (method === 'poison') {
        tt = poisoned.has(from) ? v : 0
      } else if (method === 'haircut') {
        const s = hc.get(from) ?? { bal: 0, t: 0 }
        const eff = Math.max(s.bal, v) // unseen earlier income counts as clean
        tt = eff > 0 ? (v * s.t) / eff : 0
        s.bal = Math.max(0, s.bal - v)
        s.t = Math.max(0, s.t - tt)
        hc.set(from, s)
      } else {
        const q = lots.get(from) ?? []
        let need = v
        while (need > EPS && q.length) {
          const lot = q[0]
          const take = Math.min(need, lot.amt)
          const frac = lot.amt > 0 ? lot.taint / lot.amt : 0
          tt += take * frac
          lot.amt -= take
          lot.taint -= take * frac
          need -= take
          if (lot.amt <= EPS) q.shift()
        }
        lots.set(from, q)
      }

      // Receiver side
      if (method === 'poison') {
        if (tt > EPS) poisoned.add(to)
      } else if (method === 'haircut') {
        const s = hc.get(to) ?? { bal: 0, t: 0 }
        s.bal += v
        s.t += tt
        hc.set(to, s)
      } else {
        const q = lots.get(to) ?? []
        q.push({ amt: v, taint: tt })
        lots.set(to, q)
      }

      if (tt > EPS) {
        used++
        acc(from).sent += tt
        acc(to).received += tt
        addEdge(from, to, tt)
      }
    }
  }

  const reached = [...byAddress.entries()]
    .filter(([a, e]) => !seeds.has(a) && e.received > EPS)
    .map(([address, e]) => ({ address, received: e.received, remaining: Math.max(0, e.received - e.sent) }))
    .sort((a, b) => b.received - a.received)

  return { method, asset, seeds: [...seeds], byAddress, byEdge, reached, txsUsed: used }
}
