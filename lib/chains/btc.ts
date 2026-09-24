import 'server-only'
import { EntityLabel, RawTransaction, TraceResult } from '../types'
import { getLabel } from '../labels'
import { fetchJson } from '../http'
import { detectCoinJoin } from '../heuristics/btc/coinjoin'
import { annotateChange } from '../heuristics/btc/change'
import { assemble } from '../trace'

// Esplora API (Blockstream by default, mempool.space as fallback).
// Override with ESPLORA_URL to point at your own node's Esplora/electrs.
const BASES = process.env.ESPLORA_URL
  ? [process.env.ESPLORA_URL.replace(/\/$/, '')]
  : ['https://blockstream.info/api', 'https://mempool.space/api']

const PAGE = 25 // Esplora returns 25 confirmed txs per page

interface EsploraAddress {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }
}

interface EsploraTx {
  txid: string
  fee?: number
  vin: {
    txid: string
    vout: number
    is_coinbase?: boolean
    prevout?: { scriptpubkey_address?: string; scriptpubkey_type?: string; value: number } | null
  }[]
  vout: { scriptpubkey_address?: string; scriptpubkey_type?: string; value: number }[]
  status: { confirmed: boolean; block_time?: number }
}

async function esplora<T>(path: string, ttl: number): Promise<T> {
  let lastErr: unknown
  for (const base of BASES) {
    try {
      return await fetchJson<T>(`${base}${path}`, ttl)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Esplora request failed')
}

export function normaliseBtcTx(tx: EsploraTx): RawTransaction {
  const isCoinbase = tx.vin.some(v => v.is_coinbase)
  const raw: RawTransaction = {
    txid: tx.txid,
    timestamp: tx.status.block_time ?? 0,
    chain: 'btc',
    asset: 'BTC',
    isCoinbase,
    fee: tx.fee !== undefined ? tx.fee / 1e8 : undefined,
    inputs: tx.vin
      .filter(v => v.prevout?.scriptpubkey_address)
      .map(v => ({
        address: v.prevout!.scriptpubkey_address!,
        amount: v.prevout!.value / 1e8,
        prev: `${v.txid}:${v.vout}`,
        scriptType: v.prevout!.scriptpubkey_type,
      })),
    outputs: tx.vout
      .map((v, index) => ({
        address: v.scriptpubkey_address ?? '',
        amount: v.value / 1e8,
        index,
        scriptType: v.scriptpubkey_type,
      }))
      .filter(o => o.address),
  }
  raw.coinjoin = detectCoinJoin(raw)
  return annotateChange(raw)
}

export async function traceBtcAddress(address: string, cursor?: string): Promise<TraceResult> {
  const [info, txs] = await Promise.all([
    esplora<EsploraAddress>(`/address/${address}`, 60),
    esplora<EsploraTx[]>(cursor ? `/address/${address}/txs/chain/${cursor}` : `/address/${address}/txs`, 30),
  ])

  const s = info.chain_stats
  const m = info.mempool_stats
  const balance = (s.funded_txo_sum - s.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum) / 1e8
  const txCount = s.tx_count + m.tx_count

  const confirmed = txs.filter(t => t.status.confirmed)
  const nextCursor = confirmed.length >= PAGE ? confirmed[confirmed.length - 1].txid : undefined

  return assemble({
    address,
    chain: 'btc',
    balance,
    txCount,
    rawTxs: txs.map(normaliseBtcTx),
    nextCursor,
  })
}

export interface BtcTxDetail {
  tx: RawTransaction
  /** Per output: the txid that spent it, null if unspent */
  spentBy: (string | null)[]
  labels: Record<string, EntityLabel>
}

/** One transaction plus where each of its outputs went (exact UTXO following) */
export async function fetchBtcTx(txid: string): Promise<BtcTxDetail> {
  const [tx, outspends] = await Promise.all([
    esplora<EsploraTx>(`/tx/${txid}`, 300),
    esplora<{ spent: boolean; txid?: string }[]>(`/tx/${txid}/outspends`, 30),
  ])
  const raw = normaliseBtcTx(tx)
  // normaliseBtcTx drops address-less outputs (OP_RETURN), so map by output index
  const spentBy = raw.outputs.map(o => {
    const s = outspends[o.index ?? -1]
    return s?.spent && s.txid ? s.txid : null
  })
  const labels: Record<string, EntityLabel> = {}
  for (const io of [...raw.inputs, ...raw.outputs]) {
    const l = getLabel(io.address, 'btc')
    if (l) labels[io.address] = l
  }
  return { tx: raw, spentBy, labels }
}
