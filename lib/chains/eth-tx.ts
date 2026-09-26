import 'server-only'
import { EntityLabel, RawTransaction } from '../types'
import { rpcBatch, ethCall } from '../rpc'
import { getLabel } from '../labels'
import { lookupEnsNames } from '../ens'
import { tokenAsset, internalTransfersByHash, receiptViaEtherscan, toUnits } from './eth'
import { warmScamLists } from '../scam-lists'

// One Ethereum transaction and every value transfer inside it: the ETH value,
// ERC-20 Transfer events from the receipt, and internal ETH transfers.
// Uses JSON-RPC (not the Etherscan quota) except for internal transfers.

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

interface RpcTx { hash: string; from: string; to: string | null; value: string; blockNumber: string | null; gasPrice?: string }
interface RpcLog { address: string; topics: string[]; data: string; logIndex: string }
interface RpcReceipt { status: string; contractAddress: string | null; logs: RpcLog[] }

export interface EthTxDetail {
  chain: 'eth'
  txid: string
  timestamp: number
  failed: boolean
  transfers: RawTransaction[]
  labels: Record<string, EntityLabel>
  ens: Record<string, string>
  warnings: string[]
}

const hexToBig = (h: string) => BigInt(h && h !== '0x' ? h : '0x0')
const topicAddr = (t: string) => '0x' + t.slice(-40).toLowerCase()

function decodeSymbol(result: string | undefined): string | null {
  if (!result || result === '0x') return null
  const hex = result.slice(2)
  try {
    if (hex.length === 64) {
      // Old tokens (e.g. MKR) return bytes32
      return Buffer.from(hex, 'hex').toString('utf8').replace(/\0+$/, '') || null
    }
    const len = parseInt(hex.slice(64, 128), 16)
    return Buffer.from(hex.slice(128, 128 + len * 2), 'hex').toString('utf8') || null
  } catch {
    return null
  }
}

export async function fetchEthTx(hash: string): Promise<EthTxDetail> {
  await warmScamLists()
  const txid = hash.toLowerCase()
  const warnings: string[] = []
  const [tx, rpcReceipt] = await rpcBatch<RpcTx & RpcReceipt>([
    { method: 'eth_getTransactionByHash', params: [txid] },
    { method: 'eth_getTransactionReceipt', params: [txid] },
  ], true) as [RpcTx | undefined, RpcReceipt | undefined]
  if (!tx) throw new Error('Transaction not found on Ethereum mainnet')

  // Token transfers live in the receipt logs; without it they would silently vanish
  let receipt = rpcReceipt
  if (!receipt?.logs) receipt = await receiptViaEtherscan<RpcReceipt>(txid).catch(() => undefined)
  if (!receipt?.logs) warnings.push('Could not load this transaction\'s receipt, so token transfers (e.g. USDT) may be missing. Try again shortly.')

  const tokenLogs = (receipt?.logs ?? []).filter(l => l.topics[0] === TRANSFER_TOPIC && l.topics.length === 3)
  const tokens = [...new Set(tokenLogs.map(l => l.address.toLowerCase()))]
  const meta = await rpcBatch<string | { timestamp: string }>([
    ...(tx.blockNumber ? [{ method: 'eth_getBlockByNumber', params: [tx.blockNumber, false] }] : []),
    ...tokens.flatMap(t => [ethCall(t, '0x95d89b41'), ethCall(t, '0x313ce567')]),
  ])
  const block = tx.blockNumber ? (meta.shift() as { timestamp: string } | undefined) : undefined
  const timestamp = block ? Number(hexToBig(block.timestamp)) : 0

  const tokenInfo = new Map<string, { symbol: string; decimals: number }>()
  tokens.forEach((t, i) => {
    const symbol = tokenAsset(decodeSymbol(meta[i * 2] as string) ?? 'TOKEN', t)
    const d = meta[i * 2 + 1] as string | undefined
    tokenInfo.set(t, { symbol, decimals: d && d !== '0x' ? Number(hexToBig(d)) : 18 })
  })

  const failed = receipt?.status === '0x0'
  const base = { txid, timestamp, chain: 'eth' as const, gasPriceGwei: tx.gasPrice ? Number(hexToBig(tx.gasPrice)) / 1e9 : undefined }
  const transfers: RawTransaction[] = []
  const to = (tx.to ?? receipt?.contractAddress ?? '').toLowerCase()
  const value = toUnits(hexToBig(tx.value).toString(), 18)
  if (to) {
    transfers.push({ ...base, asset: 'ETH', kind: 'normal', inputs: [{ address: tx.from.toLowerCase(), amount: 0 }], outputs: [{ address: to, amount: failed ? 0 : value }] })
  }
  if (!failed) {
    for (const l of tokenLogs) {
      const info = tokenInfo.get(l.address.toLowerCase())!
      const amount = toUnits(hexToBig(l.data.slice(0, 66)).toString(), info.decimals)
      if (amount <= 0) continue
      transfers.push({
        ...base, asset: info.symbol, kind: 'token', eventId: String(Number(hexToBig(l.logIndex))),
        inputs: [{ address: topicAddr(l.topics[1]), amount: 0 }], outputs: [{ address: topicAddr(l.topics[2]), amount }],
      })
    }
    try {
      for (const it of await internalTransfersByHash(txid)) {
        transfers.push({ ...base, asset: 'ETH', kind: 'internal', eventId: it.traceId, inputs: [{ address: it.from, amount: 0 }], outputs: [{ address: it.to, amount: it.value }] })
      }
    } catch (e) {
      warnings.push(`Internal ETH transfers unavailable: ${e instanceof Error ? e.message : 'error'}`)
    }
  } else {
    warnings.push('This transaction failed on-chain; no value moved')
  }

  // A zero-value call to a token contract is just the mechanism of a token transfer
  const hasTokens = transfers.some(t => t.kind === 'token')
  for (let i = transfers.length - 1; i >= 0; i--) {
    if (hasTokens && transfers[i].kind === 'normal' && transfers[i].outputs[0].amount === 0) transfers.splice(i, 1)
  }

  const addrs = [...new Set(transfers.flatMap(t => [t.inputs[0].address, t.outputs[0].address]))]
  const labels: Record<string, EntityLabel> = {}
  for (const a of addrs) {
    const l = getLabel(a, 'eth')
    if (l) labels[a] = l
  }
  const ens = Object.fromEntries(await lookupEnsNames(addrs))
  return { chain: 'eth', txid, timestamp, failed, transfers, labels, ens, warnings }
}
