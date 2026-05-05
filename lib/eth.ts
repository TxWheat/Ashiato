import { TraceResult, NodeData, EdgeData } from './types'
import { getLabel } from './labels'

interface EtherscanTx {
  hash: string
  from: string
  to: string
  value: string
  timeStamp: string
  isError: string
}

export async function traceEthAddress(address: string): Promise<TraceResult> {
  const apiKey = process.env.ETHERSCAN_API_KEY
  const addr = address.toLowerCase()

  const [balRes, txRes] = await Promise.all([
    fetch(
      `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${apiKey}`
    ).then(r => r.json()),
    fetch(
      `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&page=1&offset=25&sort=desc&apikey=${apiKey}`
    ).then(r => r.json()),
  ])

  if (balRes.status === '0' || txRes.status === '0') {
    if (txRes.message !== 'No transactions found') {
      throw new Error(txRes.result ?? 'Etherscan API error')
    }
  }

  const balance = parseInt(balRes.result ?? '0')
  const txs: EtherscanTx[] = Array.isArray(txRes.result) ? txRes.result : []

  const nodeMap = new Map<string, NodeData>()
  const edges: EdgeData[] = []

  nodeMap.set(addr, {
    address: addr,
    chain: 'eth',
    label: getLabel(addr),
    balance,
    txCount: txs.length,
    isOrigin: true,
  })

  for (const tx of txs) {
    if (tx.isError === '1') continue
    const from = tx.from.toLowerCase()
    const to = tx.to?.toLowerCase()
    if (!to) continue

    for (const a of [from, to]) {
      if (!nodeMap.has(a)) {
        nodeMap.set(a, {
          address: a,
          chain: 'eth',
          label: getLabel(a),
          balance: 0,
          txCount: 0,
          isOrigin: false,
        })
      }
    }

    edges.push({
      id: tx.hash,
      source: from,
      target: to,
      amount: parseInt(tx.value),
      txid: tx.hash,
      timestamp: parseInt(tx.timeStamp),
      chain: 'eth',
    })
  }

  return {
    address: addr,
    chain: 'eth',
    balance,
    txCount: txs.length,
    nodes: Array.from(nodeMap.values()),
    edges: dedupeEdges(edges),
    entity: getLabel(addr),
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
