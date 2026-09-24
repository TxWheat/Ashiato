import { Chain, EdgeData, EntityLabel, NodeData, RawTransaction } from './types'

/**
 * Per-transaction edges around `address`, one per (tx, from, to, asset).
 *
 * Value attribution:
 *  - Incoming: each other input address is credited with its share of the
 *    inputs, so a 3-input tx paying 1 BTC draws three edges totalling 1 BTC
 *    (not 3 BTC).
 *  - Outgoing: when `address` co-spends with other addresses, outputs are
 *    scaled by `address`'s share of the inputs.
 *  - A tx where `address` is both sender and receiver draws no incoming edges:
 *    the amount paid back is change, not money from the co-signers.
 */
export function txEdges(address: string, chain: Chain, rawTxs: RawTransaction[]): EdgeData[] {
  const perTx: EdgeData[] = []
  for (const tx of rawTxs) {
    const myIns = tx.inputs.filter(i => i.address === address)
    const isSender = myIns.length > 0
    const received = tx.outputs.filter(o => o.address === address).reduce((s, o) => s + o.amount, 0)
    const totalIn = tx.inputs.reduce((s, i) => s + i.amount, 0)

    if (received > 0 && !isSender) {
      const byAddr = new Map<string, number>() // one address can fund several inputs
      for (const i of tx.inputs) if (i.address && i.address !== address) byAddr.set(i.address, (byAddr.get(i.address) ?? 0) + i.amount)
      for (const [from, value] of byAddr) {
        const share = totalIn > 0 ? value / totalIn : 1 / byAddr.size
        perTx.push({
          id: `${tx.txid}|${tx.eventId ?? ''}|${from}|${address}|${tx.asset}`, source: from, target: address, amount: received * share,
          asset: tx.asset, txid: tx.txid, timestamp: tx.timestamp, chain,
        })
      }
    }

    if (isSender) {
      const mine = myIns.reduce((s, i) => s + i.amount, 0)
      const share = totalIn > 0 && mine > 0 ? mine / totalIn : 1
      for (const o of tx.outputs) {
        if (!o.address || o.address === address || o.amount <= 0) continue
        perTx.push({
          id: `${tx.txid}|${tx.eventId ?? ''}|${address}|${o.address}|${tx.asset}`, source: address, target: o.address, amount: o.amount * share,
          asset: tx.asset, txid: tx.txid, timestamp: tx.timestamp, chain, isChange: o.isChange,
        })
      }
    }
  }
  return perTx
}

/** Merges per-tx edges (deduplicated by id) into one edge per source → target → asset */
export function aggregateEdges(perTx: Iterable<EdgeData>): EdgeData[] {
  const seen = new Set<string>()
  const pairs = new Map<string, EdgeData>()
  for (const e of perTx) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    const id = `${e.source}--${e.target}--${e.asset}`
    const ex = pairs.get(id)
    if (!ex) {
      pairs.set(id, { ...e, id, txCount: 1, txids: [e.txid], firstTimestamp: e.timestamp })
    } else {
      ex.amount += e.amount
      ex.timestamp = Math.max(ex.timestamp, e.timestamp)
      if (e.timestamp && (!ex.firstTimestamp || e.timestamp < ex.firstTimestamp)) ex.firstTimestamp = e.timestamp
      if (!ex.txids!.includes(e.txid)) ex.txids!.push(e.txid)
      ex.txCount = ex.txids!.length
      ex.isChange = !!ex.isChange && !!e.isChange
    }
  }
  return [...pairs.values()]
}

/** The 1-hop graph around `address`: counterparty nodes plus aggregated edges */
export function buildGraph(
  address: string,
  chain: Chain,
  rawTxs: RawTransaction[],
  labelOf: (a: string) => EntityLabel | undefined
): { nodes: NodeData[]; edges: EdgeData[] } {
  const edges = aggregateEdges(txEdges(address, chain, rawTxs))
  const nodes = new Map<string, NodeData>()
  for (const e of edges) {
    for (const a of [e.source, e.target]) {
      if (a !== address && !nodes.has(a)) {
        nodes.set(a, { address: a, chain, label: labelOf(a), balance: 0, txCount: 0, isOrigin: false })
      }
    }
  }
  return { nodes: [...nodes.values()], edges }
}
