import 'server-only'
import { fetchJson } from '../http'
import { CrossChainHop, toOurChain } from './types'

// Bridgers (bridgers.xyz, by SWFT) order records: every cross-chain swap has a source
// hash (money in) and a toHash (money out on the other chain).
//   POST https://api.bridgers.xyz/api/exchangeRecord/getTransData  { fromAddress, pageNo, pageSize, … }
// Docs: https://docs-bridgers-en.bridgers.xyz/bridgers-api-endpoints/query-transaction-records

const BASE = (process.env.BRIDGERS_API_URL || 'https://api.bridgers.xyz').replace(/\/$/, '')
const SOURCE_FLAG = process.env.BRIDGERS_SOURCE_FLAG || 'bridgers'

type Raw = Record<string, unknown>
interface Response { resCode?: number | string; resMsg?: string; data?: unknown }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(str(v))
  return Number.isFinite(n) ? n : 0
}

/** "USDT(TRON)" → "USDT"; plain codes pass through */
const assetOf = (code: string) => code.replace(/\(.*\)$/, '').trim().toUpperCase() || '?'
/** "USDT(TRON)" → "TRON" when a coin code carries its chain */
const chainInCode = (code: string) => code.match(/\(([^)]+)\)$/)?.[1] ?? ''

function timeOf(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v
  const s = str(v)
  if (!s) return undefined
  if (/^\d+$/.test(s)) return timeOf(Number(s))
  // "2026-08-19 04:18:35" (the API reports UTC+8, Beijing time)
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}+08:00`)
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined
}

/** One order record → a hop (tolerant of field-name variations between API versions) */
export function hopFromBridgers(r: Raw): CrossChainHop | null {
  const fromCode = str(r.fromCoinCode) || str(r.fromTokenSymbol)
  const toCode = str(r.toCoinCode) || str(r.toTokenSymbol)
  const fromChainName = (str(r.fromChain) || chainInCode(fromCode) || '?').toUpperCase()
  const toChainName = (str(r.toChain) || chainInCode(toCode) || '?').toUpperCase()
  const fromHash = str(r.hash) || str(r.depositHash) || str(r.fromHash)
  const toAddress = str(r.toAddress) || str(r.receiveAddress) || str(r.destinationAddr)
  if (!fromHash || !toAddress) return null
  return {
    service: 'Bridgers',
    orderId: str(r.orderId) || fromHash,
    status: str(r.status) || str(r.orderStatus) || 'unknown',
    fromChainName, toChainName,
    fromChain: toOurChain(fromChainName), toChain: toOurChain(toChainName),
    fromAddress: str(r.fromAddress),
    toAddress,
    fromHash,
    toHash: str(r.toHash) || str(r.receiveHash) || undefined,
    fromAmount: num(r.fromTokenAmount ?? r.fromAmount ?? r.depositCoinAmt),
    fromAsset: assetOf(fromCode),
    toAmount: num(r.toTokenAmount ?? r.toAmount ?? r.receiveCoinAmt),
    toAsset: assetOf(toCode),
    time: timeOf(r.createTime ?? r.createdAt ?? r.time),
  }
}

/** Cross-chain swaps a wallet made through Bridgers, newest first */
export async function bridgersOrders(fromAddress: string): Promise<CrossChainHop[]> {
  const body = {
    fromAddress,
    // The API asks for a device id and source; the sender's address is what Bridgers' own site sends
    equipmentNo: fromAddress,
    sourceType: 'H5',
    sourceFlag: SOURCE_FLAG,
    pageNo: 1,
    pageSize: 100,
  }
  const res = await fetchJson<Response>(`${BASE}/api/exchangeRecord/getTransData`, 120, 2, undefined, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  const code = str(res.resCode)
  if (code && code !== '100' && code !== '0') throw new Error(`Bridgers: ${res.resMsg || `error ${code}`}`)
  const d = res.data as Raw | Raw[] | undefined
  const list: Raw[] = Array.isArray(d) ? d : Array.isArray(d?.list) ? (d!.list as Raw[]) : Array.isArray(d?.records) ? (d!.records as Raw[]) : []
  return list.map(hopFromBridgers).filter((h): h is CrossChainHop => !!h).sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
}
