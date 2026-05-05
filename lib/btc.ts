import { TraceResult, NodeData, EdgeData, RawTransaction, TxOutput } from './types'
import { getLabel } from './labels'

const BASE = 'https://blockstream.info/api'

interface BlockstreamAddress {
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
  status: { confirmed: boolean; block_time?: number }
}

function addrType(addr: string): string {
  if (/^1/.test(addr)) return 'p2pkh'
  if (/^3/.test(addr)) return 'p2sh'
  if (/^bc1q/.test(addr)) return 'p2wpkh'
  if (/^bc1p/.test(addr)) return 'p2tr'
  return 'unknown'
}

// Heuristic: in a 2-output tx where we are the sender, identify which output is change.
// Rule 1: output with same script type as sender → likely change.
// Rule 2: if both same type, the smaller amount is likely change.
function detectChange(
  senderAddr: string,
  outputs: { addr: string; value: number }[]
): boolean[] {
  if (outputs.length !== 2) return outputs.map(() => false)

  const senderType = addrType(senderAddr)
  const [o0, o1] = outputs
  const t0 = addrType(o0.addr)
  const t1 = addrType(o1.addr)

  if (t0 === senderType && t1 !== senderType) return [true, false]
  if (t1 === senderType && t0 !== senderType) return [false, true]

  // Both same type — smaller value is likely change
  return o0.value <= o1.value ? [true, false] : [false, true]
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
  const edgeMap = new Map<string, EdgeData>()
  const rawTxs: RawTransaction[] = []

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

    const changeFlags = isSender ? detectChange(address, outputs) : outputs.map(() => false)

    // Build raw transaction record
    const txOutputs: TxOutput[] = outputs.map((o, i) => ({
      address: o.addr,
      amount: o.value,
      isChange: changeFlags[i],
    }))

    rawTxs.push({
      txid: tx.txid,
      timestamp: tx.status.block_time ?? 0,
      fromAddresses: inputAddrs,
      outputs: txOutputs,
      chain: 'btc',
    })

    // Build graph edges
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
        const edgeId = `${tx.txid}-${inputAddr}-${address}`
        if (!edgeMap.has(edgeId)) {
          edgeMap.set(edgeId, {
            id: edgeId,
            source: inputAddr,
            target: address,
            amount: received,
            txid: tx.txid,
            timestamp: tx.status.block_time ?? 0,
            chain: 'btc',
          })
        }
      }
    }

    if (isSender) {
      for (let i = 0; i < outputs.length; i++) {
        const out = outputs[i]
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
        const edgeId = `${tx.txid}-${address}-${out.addr}`
        if (!edgeMap.has(edgeId)) {
          edgeMap.set(edgeId, {
            id: edgeId,
            source: address,
            target: out.addr,
            amount: out.value,
            txid: tx.txid,
            timestamp: tx.status.block_time ?? 0,
            chain: 'btc',
            isChange: changeFlags[i],
          })
        }
      }
    }
  }

  // Aggregate per-tx edges into one edge per source→target pair
  const pairMap = new Map<string, EdgeData>()
  for (const edge of edgeMap.values()) {
    const key = `${edge.source}--${edge.target}`
    const ex = pairMap.get(key)
    if (!ex) {
      pairMap.set(key, { ...edge, id: key, txCount: 1 })
    } else {
      pairMap.set(key, {
        ...ex,
        amount: ex.amount + edge.amount,
        timestamp: Math.max(ex.timestamp ?? 0, edge.timestamp ?? 0),
        txCount: (ex.txCount ?? 1) + 1,
        isChange: ex.isChange && edge.isChange,
      })
    }
  }

  return {
    address,
    chain: 'btc',
    balance,
    txCount,
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(pairMap.values()),
    entity: getLabel(address),
    rawTxs,
  }
}
