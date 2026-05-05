import { TraceResult, NodeData, EdgeData } from './types'
import { getLabel } from './labels'

const BASE = 'https://blockstream.info/api'

interface BlockstreamAddress {
  address: string
  chain_stats: {
    funded_txo_sum: number
    spent_txo_sum: number
    tx_count: number
  }
}

interface BlockstreamVout {
  scriptpubkey_address?: string
  value: number
}

interface BlockstreamVin {
  prevout?: {
    scriptpubkey_address?: string
    value: number
  }
}

interface BlockstreamTx {
  txid: string
  vin: BlockstreamVin[]
  vout: BlockstreamVout[]
  status: {
    confirmed: boolean
    block_time?: number
  }
}

export async function traceBtcAddress(address: string): Promise<TraceResult> {
  const [addrData, txsData] = await Promise.all([
    fetch(`${BASE}/address/${address}`).then(r => {
      if (!r.ok) throw new Error(`Blockstream error: ${r.status}`)
      return r.json() as Promise<BlockstreamAddress>
    }),
    fetch(`${BASE}/address/${address}/txs`).then(r => {
      if (!r.ok) throw new Error(`Blockstream error: ${r.status}`)
      return r.json() as Promise<BlockstreamTx[]>
    }),
  ])

  const balance =
    addrData.chain_stats.funded_txo_sum - addrData.chain_stats.spent_txo_sum
  const txCount = addrData.chain_stats.tx_count

  const nodeMap = new Map<string, NodeData>()
  const edges: EdgeData[] = []

  nodeMap.set(address, {
    address,
    chain: 'btc',
    label: getLabel(address),
    balance,
    txCount,
    isOrigin: true,
  })

  for (const tx of txsData.slice(0, 15)) {
    const inputAddrs = tx.vin
      .map(v => v.prevout?.scriptpubkey_address)
      .filter((a): a is string => !!a)

    const outputs = tx.vout
      .map(v => ({ addr: v.scriptpubkey_address, value: v.value }))
      .filter((o): o is { addr: string; value: number } => !!o.addr)

    const isReceiver = outputs.some(o => o.addr === address)
    const isSender = inputAddrs.includes(address)

    if (isReceiver) {
      for (const inputAddr of inputAddrs) {
        if (inputAddr === address) continue
        if (!nodeMap.has(inputAddr)) {
          nodeMap.set(inputAddr, {
            address: inputAddr,
            chain: 'btc',
            label: getLabel(inputAddr),
            balance: 0,
            txCount: 0,
            isOrigin: false,
          })
        }
        const received = outputs.find(o => o.addr === address)?.value ?? 0
        edges.push({
          id: `${tx.txid}-${inputAddr}-${address}`,
          source: inputAddr,
          target: address,
          amount: received,
          txid: tx.txid,
          timestamp: tx.status.block_time ?? 0,
          chain: 'btc',
        })
      }
    }

    if (isSender) {
      for (const out of outputs) {
        if (out.addr === address) continue
        if (!nodeMap.has(out.addr)) {
          nodeMap.set(out.addr, {
            address: out.addr,
            chain: 'btc',
            label: getLabel(out.addr),
            balance: 0,
            txCount: 0,
            isOrigin: false,
          })
        }
        edges.push({
          id: `${tx.txid}-${address}-${out.addr}`,
          source: address,
          target: out.addr,
          amount: out.value,
          txid: tx.txid,
          timestamp: tx.status.block_time ?? 0,
          chain: 'btc',
        })
      }
    }
  }

  return {
    address,
    chain: 'btc',
    balance,
    txCount,
    nodes: Array.from(nodeMap.values()),
    edges: dedupeEdges(edges),
    entity: getLabel(address),
  }
}

function dedupeEdges(edges: EdgeData[]): EdgeData[] {
  const seen = new Set<string>()
  return edges.filter(e => {
    const key = `${e.source}-${e.target}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
