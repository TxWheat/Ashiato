import 'server-only'
import crypto from 'node:crypto'
import { EntityLabel, RawTransaction, TraceResult, TxLookup } from '../types'
import { fetchJson } from '../http'
import { assemble } from '../trace'
import { getLabel } from '../labels'
import { tronscanLabel, tronscanLabels } from './tronscan'

/** Counterparties whose Tronscan tags are looked up per trace (most frequent first) */
const TAG_LOOKUPS = 15

// Tron via TronGrid. Account-based like Ethereum: TRX transfers plus TRC-20 token
// transfers (most scam money on Tron is USDT). Set TRONGRID_API_KEY (free at
// trongrid.io) for higher rate limits; TRONGRID_API_URL points at a proxy or mock.

const BASE = (process.env.TRONGRID_API_URL || 'https://api.trongrid.io').replace(/\/$/, '')
const PAGE = 200

const headers = (): Record<string, string> => (process.env.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY } : {})
const get = <T>(path: string, ttl = 60) => fetchJson<T>(`${BASE}${path}`, ttl, 3, undefined, { headers: headers() })
const post = <T>(path: string, body: unknown, ttl = 300) =>
  fetchJson<T>(`${BASE}${path}`, ttl, 3, undefined, { method: 'POST', body: JSON.stringify(body), headers: headers() })

// ── Addresses: base58check of 0x41 + 20 bytes ─────────────────────────────

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest()

export function hexToBase58(hex: string): string {
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(hex)) return hex // already base58
  let h = hex.replace(/^0x/, '').toLowerCase()
  if (h.length === 40) h = `41${h}`
  const payload = Buffer.from(h, 'hex')
  const bytes = Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)])
  let n = BigInt(`0x${bytes.toString('hex')}`)
  let out = ''
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out
    n /= 58n
  }
  for (const b of bytes) {
    if (b !== 0) break
    out = `1${out}`
  }
  return out
}

/** Hex (41…) for a base58 Tron address, or null if the checksum is wrong */
export function base58ToHex(addr: string): string | null {
  let n = 0n
  for (const c of addr) {
    const i = ALPHABET.indexOf(c)
    if (i < 0) return null
    n = n * 58n + BigInt(i)
  }
  const hex = n.toString(16).padStart(50, '0')
  const payload = Buffer.from(hex.slice(0, 42), 'hex')
  const check = hex.slice(42)
  return sha256(sha256(payload)).subarray(0, 4).toString('hex') === check && hex.startsWith('41') ? hex.slice(0, 42) : null
}

// ── Tokens ─────────────────────────────────────────────────────────────────

/** Real TRC-20 contracts for symbols scammers like to fake */
export const KNOWN_TRC20: Record<string, { symbol: string; decimals: number }> = {
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { symbol: 'USDT', decimals: 6 },
  TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: { symbol: 'USDC', decimals: 6 },
}
const REAL_BY_SYMBOL = Object.fromEntries(Object.entries(KNOWN_TRC20).map(([a, t]) => [t.symbol, a]))

const cleanSymbol = (s: string) => (s || 'TOKEN').replace(/[^\w.$-]/g, '').slice(0, 12) || 'TOKEN'

/** "USDT*" when a token calls itself USDT but isn't the real contract (poisoning spam) */
function assetFor(symbol: string, contract: string): string {
  const sym = cleanSymbol(symbol)
  if (['TRX', 'TRON'].includes(sym.replace(/[^a-z]/gi, '').toUpperCase())) return `${sym}*` // posing as native TRX
  const real = REAL_BY_SYMBOL[sym.toUpperCase()]
  return real && real !== contract ? `${sym}*` : sym
}

// ── Address history ────────────────────────────────────────────────────────

interface Account { balance?: number }
interface TrxTx {
  txID: string
  block_timestamp: number
  ret?: { contractRet?: string }[]
  raw_data?: { contract?: { type: string; parameter: { value: { amount?: number; owner_address?: string; to_address?: string } } }[] }
}
interface Trc20Tx {
  transaction_id: string
  block_timestamp: number
  from: string
  to: string
  value: string
  type?: string
  token_info: { symbol: string; address: string; decimals: number }
}
interface Page<T> { data?: T[]; success?: boolean; error?: string; meta?: { fingerprint?: string } }

const units = (raw: string | number, decimals: number) => Number(BigInt(String(raw).split('.')[0] || '0')) / 10 ** decimals

function transfer(txid: string, from: string, to: string, amount: number, asset: string, ms: number, kind: RawTransaction['kind'], eventId?: string): RawTransaction {
  return {
    txid, timestamp: Math.floor(ms / 1000), chain: 'tron', asset, kind, eventId,
    inputs: [{ address: from, amount: 0 }],
    outputs: [{ address: to, amount }],
  }
}

/** Cursor: TRX fingerprint and TRC-20 fingerprint ("-" = that list is finished) */
const encodeCursor = (trx?: string, trc?: string) => (trx || trc ? `${trx || '-'}~${trc || '-'}` : undefined)

export async function traceTronAddress(address: string, cursor?: string): Promise<TraceResult> {
  const [fpTrx, fpTrc] = cursor ? cursor.split('~') : [undefined, undefined]
  const q = (fp?: string) => `limit=${PAGE}&only_confirmed=true&order_by=block_timestamp,desc${fp ? `&fingerprint=${encodeURIComponent(fp)}` : ''}`
  const warnings: string[] = []

  const [account, trx, trc] = await Promise.all([
    cursor ? Promise.resolve(null) : get<Page<Account>>(`/v1/accounts/${address}`, 60),
    fpTrx === '-' ? Promise.resolve({ data: [] } as Page<TrxTx>) : get<Page<TrxTx>>(`/v1/accounts/${address}/transactions?${q(fpTrx)}&search_internal=false`, 60),
    fpTrc === '-' ? Promise.resolve({ data: [] } as Page<Trc20Tx>) : get<Page<Trc20Tx>>(`/v1/accounts/${address}/transactions/trc20?${q(fpTrc)}`, 60),
  ])
  for (const p of [trx, trc]) if (p.success === false || p.error) warnings.push(`TronGrid: ${p.error ?? 'request failed'}`)

  const rawTxs: RawTransaction[] = []
  for (const t of trx.data ?? []) {
    const c = t.raw_data?.contract?.[0]
    if (c?.type !== 'TransferContract' || (t.ret?.[0]?.contractRet && t.ret[0].contractRet !== 'SUCCESS')) continue
    const v = c.parameter.value
    if (!v.owner_address || !v.to_address || !v.amount) continue
    rawTxs.push(transfer(t.txID, hexToBase58(v.owner_address), hexToBase58(v.to_address), v.amount / 1e6, 'TRX', t.block_timestamp, 'normal'))
  }
  let spam = 0
  let fake = 0
  const seenInTx = new Map<string, number>()
  for (const t of trc.data ?? []) {
    if (t.type && t.type !== 'Transfer') continue
    const amount = units(t.value, t.token_info.decimals || 0)
    if (amount <= 0) {
      spam++
      continue
    }
    const asset = assetFor(t.token_info.symbol, t.token_info.address)
    if (asset.endsWith('*')) fake++
    const n = seenInTx.get(t.transaction_id) ?? 0
    seenInTx.set(t.transaction_id, n + 1)
    rawTxs.push(transfer(t.transaction_id, t.from, t.to, amount, asset, t.block_timestamp, 'token', String(n)))
  }
  if (spam) warnings.push(`${spam} zero-value token transfer(s) hidden (typical address-poisoning spam)`)
  if (fake) warnings.push(`${fake} transfer(s) of fake tokens posing as real ones (e.g. a fake USDT contract). These are usually address-poisoning spam; no real funds moved`)

  rawTxs.sort((a, b) => b.timestamp - a.timestamp)
  // A finished list stays marked done ("-") so later pages don't fetch it again
  const nextCursor = encodeCursor(
    fpTrx === '-' ? undefined : trx.meta?.fingerprint,
    fpTrc === '-' ? undefined : trc.meta?.fingerprint
  )

  // Tronscan names for this address and its busiest counterparties (first page only)
  let extraLabel: EntityLabel | undefined
  let extraLabels: Map<string, EntityLabel> | undefined
  if (!cursor) {
    const count = new Map<string, number>()
    for (const t of rawTxs) {
      if (t.asset.endsWith('*')) continue
      for (const a of [t.inputs[0]?.address, t.outputs[0]?.address]) if (a && a !== address) count.set(a, (count.get(a) ?? 0) + 1)
    }
    const top = [...count].sort((x, y) => y[1] - x[1]).map(([a]) => a).filter(a => !getLabel(a, 'tron')).slice(0, TAG_LOOKUPS)
    ;[extraLabel, extraLabels] = await Promise.all([getLabel(address, 'tron') ? undefined : tronscanLabel(address), tronscanLabels(top)])
  }

  return assemble({
    address,
    chain: 'tron',
    extraLabel,
    extraLabels,
    balance: (account?.data?.[0]?.balance ?? 0) / 1e6,
    txCount: rawTxs.length,
    rawTxs,
    nextCursor,
    warnings,
  })
}

// ── Single transaction ─────────────────────────────────────────────────────

interface TxById {
  txID?: string
  ret?: { contractRet?: string }[]
  raw_data?: { timestamp?: number; contract?: { type: string; parameter: { value: { amount?: number; owner_address?: string; to_address?: string; contract_address?: string } } }[] }
}
interface TxInfo { id?: string; blockTimeStamp?: number; log?: { address: string; topics: string[]; data: string }[]; receipt?: { result?: string } }

const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function decodeString(hex?: string): string | null {
  if (!hex) return null
  try {
    if (hex.length === 64) return Buffer.from(hex, 'hex').toString('utf8').replace(/\0+$/, '') || null
    const len = parseInt(hex.slice(64, 128), 16)
    return Buffer.from(hex.slice(128, 128 + len * 2), 'hex').toString('utf8') || null
  } catch {
    return null
  }
}

async function tokenMeta(contract: string): Promise<{ symbol: string; decimals: number }> {
  if (KNOWN_TRC20[contract]) return KNOWN_TRC20[contract]
  const call = (fn: string) =>
    post<{ constant_result?: string[] }>('/wallet/triggerconstantcontract', { owner_address: contract, contract_address: contract, function_selector: fn, visible: true }, 86400)
      .then(r => r.constant_result?.[0])
      .catch(() => undefined)
  const [sym, dec] = await Promise.all([call('symbol()'), call('decimals()')])
  return { symbol: decodeString(sym) ?? 'TRC20', decimals: dec ? parseInt(dec, 16) || 0 : 0 }
}

export async function fetchTronTx(txid: string): Promise<TxLookup> {
  const id = txid.toLowerCase()
  const [tx, info] = await Promise.all([
    post<TxById>('/wallet/gettransactionbyid', { value: id, visible: true }),
    post<TxInfo>('/wallet/gettransactioninfobyid', { value: id }),
  ])
  if (!tx?.txID) throw new Error('Transaction not found on Tron')
  const ms = info.blockTimeStamp ?? tx.raw_data?.timestamp ?? 0
  const failed = (tx.ret?.[0]?.contractRet && tx.ret[0].contractRet !== 'SUCCESS') || (info.receipt?.result && info.receipt.result !== 'SUCCESS')
  const transfers: RawTransaction[] = []
  const c = tx.raw_data?.contract?.[0]
  if (c?.type === 'TransferContract' && c.parameter.value.amount) {
    const v = c.parameter.value
    transfers.push(transfer(id, v.owner_address!, v.to_address!, v.amount! / 1e6, 'TRX', ms, 'normal'))
  }
  let k = 0
  for (const log of info.log ?? []) {
    if (log.topics?.[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue
    const contract = hexToBase58(log.address)
    const meta = await tokenMeta(contract)
    const amount = units(BigInt(`0x${log.data || '0'}`).toString(), meta.decimals)
    if (amount <= 0) continue
    transfers.push(transfer(id, hexToBase58(log.topics[1].slice(-40)), hexToBase58(log.topics[2].slice(-40)), amount, assetFor(meta.symbol, contract), ms, 'token', String(k++)))
  }
  const labels: Record<string, EntityLabel> = {}
  const unknown = new Set<string>()
  for (const t of transfers) for (const a of [t.inputs[0].address, t.outputs[0].address]) {
    const l = getLabel(a, 'tron')
    if (l) labels[a] = l
    else unknown.add(a)
  }
  for (const [a, l] of await tronscanLabels([...unknown].slice(0, TAG_LOOKUPS))) labels[a] = l
  return { chain: 'tron', txid: id, timestamp: Math.floor(ms / 1000), transfers, labels, ens: {}, failed: !!failed, warnings: failed ? ['This transaction failed on-chain'] : [] }
}
