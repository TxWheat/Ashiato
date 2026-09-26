import 'server-only'
import { fetchJson } from '../http'
import { CrossChainHop, toOurChain } from './types'
import { num, Raw, str } from './util'

// Bridgers (bridgers.xyz, by SWFT) order records: every cross-chain swap has a source
// hash (money in) and a toHash (money out on the other chain).
//   POST https://api.bridgers.xyz/api/exchangeRecord/getTransData  { fromAddress, pageNo, pageSize, … }
// Docs: https://docs-bridgers-en.bridgers.xyz/bridgers-api-endpoints/query-transaction-records

const BASE = (process.env.BRIDGERS_API_URL || 'https://api.bridgers.xyz').replace(/\/$/, '')
const SOURCE_FLAG = process.env.BRIDGERS_SOURCE_FLAG || 'bridgers'

interface Response { resCode?: number | string; resMsg?: string; data?: unknown }

/** "USDT(TRON)" → "USDT"; plain codes pass through */
const assetOf = (code: string) => code.replace(/\(.*\)$/, '').trim().toUpperCase() || '?'
/** "USDT(TRON)" → "TRON" when a coin code carries its chain */
const chainInCode = (code: string) => code.match(/\(([^)]+)\)$/)?.[1] ?? ''

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
    // fromTokenAmount is human units; fromAmount is in base units (wei), so never fall back to it
    fromAmount: num(r.fromTokenAmount ?? r.depositCoinAmt),
    fromAsset: assetOf(fromCode),
    toAmount: num(r.toTokenAmount ?? r.receiveCoinAmt),
    toAsset: assetOf(toCode),
    createdText: str(r.createTime) || undefined,
    depositUrl: str(r.depositHashExplore) || undefined,
    receiveUrl: str(r.receiveHashExplore) || undefined,
    refundHash: str(r.refundHash) || undefined,
    refundUrl: str(r.refundHashExplore) || undefined,
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
  return list.map(hopFromBridgers).filter((h): h is CrossChainHop => !!h).sort((a, b) => (b.createdText ?? '').localeCompare(a.createdText ?? ''))
}
