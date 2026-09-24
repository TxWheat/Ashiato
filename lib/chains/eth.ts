import 'server-only'
import { RawTransaction, TraceResult } from '../types'
import { fetchJson } from '../http'
import { assemble } from '../trace'

// Etherscan API V2 (V1 was shut down on 2025-08-15). One key covers 60+ EVM
// chains via `chainid`; we use Ethereum mainnet.
// Override with ETHERSCAN_API_URL for a compatible proxy or tests
const BASE = process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/v2/api'
const CHAIN_ID = 1
const PAGE_SIZE = 50

// Real contracts for commonly spoofed tokens. Scam airdrops mint look-alike
// "USDT" tokens; a symbol from any other contract is shown as e.g. "USDT*".
export const KNOWN_TOKENS: Record<string, string> = {
  USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  DAI: '0x6b175474e89094c44da98b954eedeac495271d0f',
  WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  WBTC: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
}

interface EtherscanResponse<T> {
  status: string
  message: string
  result: T[] | string
}

interface NormalTx {
  hash: string; from: string; to: string; value: string; timeStamp: string
  isError: string; gasPrice?: string; contractAddress?: string
}
interface InternalTx {
  hash: string; from: string; to: string; value: string; timeStamp: string
  isError: string; contractAddress?: string; traceId?: string
}
interface TokenTx {
  hash: string; from: string; to: string; value: string; timeStamp: string
  tokenSymbol: string; tokenDecimal: string; contractAddress: string; logIndex?: string
}

export class MissingApiKeyError extends Error {}

/** Converts an integer string in base units to a float without going through parseInt */
export function toUnits(raw: string, decimals: number): number {
  if (!/^\d+$/.test(raw)) return 0
  const b = BigInt(raw)
  const d = 10n ** BigInt(decimals)
  return Number(b / d) + Number(b % d) / Number(d)
}

function apiKey(): string {
  const key = process.env.ETHERSCAN_API_KEY
  if (!key || key === 'your_etherscan_api_key_here') {
    throw new MissingApiKeyError(
      'ETH tracing needs a free Etherscan API key. Copy .env.local.example to .env.local, set ETHERSCAN_API_KEY, then restart the dev server.'
    )
  }
  return key
}

function url(params: Record<string, string | number>): string {
  const qs = new URLSearchParams({ chainid: String(CHAIN_ID) })
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
  qs.set('apikey', apiKey())
  return `${BASE}?${qs}`
}

/** Etherscan reports rate limiting as a normal 200 response */
const rateLimited = (b: { status?: string; result?: unknown }) =>
  b?.status === '0' && typeof b.result === 'string' && /rate limit|max calls/i.test(b.result)

async function etherscan<T>(params: Record<string, string | number>, ttl = 120): Promise<T[]> {
  const body = await fetchJson<EtherscanResponse<T>>(url(params), ttl, 4, rateLimited)
  if (body.status === '1' && Array.isArray(body.result)) return body.result
  if (/no transactions found|no records found/i.test(body.message) || (Array.isArray(body.result) && body.result.length === 0)) return []
  throw new Error(`Etherscan: ${typeof body.result === 'string' ? body.result : body.message}`)
}

export async function traceEthAddress(address: string, cursor?: string): Promise<TraceResult> {
  const addr = address.toLowerCase()
  const page = cursor ? Math.max(1, parseInt(cursor, 10) || 1) : 1
  const list = { module: 'account', address: addr, page, offset: PAGE_SIZE, sort: 'desc' }
  const warnings: string[] = []

  const balanceRes = await fetchBalance(addr)
  const [normal, internal, tokens] = await Promise.all([
    etherscan<NormalTx>({ ...list, action: 'txlist' }),
    etherscan<InternalTx>({ ...list, action: 'txlistinternal' }).catch(e => {
      warnings.push(`Internal transactions unavailable: ${e.message}`)
      return [] as InternalTx[]
    }),
    etherscan<TokenTx>({ ...list, action: 'tokentx' }).catch(e => {
      warnings.push(`Token transfers unavailable: ${e.message}`)
      return [] as TokenTx[]
    }),
  ])

  const rawTxs: RawTransaction[] = []
  const transfer = (
    txid: string, from: string, to: string, amount: number, asset: string,
    ts: string, kind: RawTransaction['kind'], gasPriceGwei?: number, eventId?: string
  ): RawTransaction => ({
    txid, timestamp: parseInt(ts, 10), chain: 'eth', asset, kind, gasPriceGwei, eventId,
    inputs: [{ address: from.toLowerCase(), amount: 0 }],
    outputs: [{ address: to.toLowerCase(), amount }],
  })

  for (const t of normal) {
    if (t.isError === '1') continue
    const to = t.to || t.contractAddress || ''
    if (!to) continue
    const gas = t.gasPrice ? Number(t.gasPrice) / 1e9 : undefined
    rawTxs.push(transfer(t.hash, t.from, to, toUnits(t.value, 18), 'ETH', t.timeStamp, 'normal', gas))
  }
  for (const t of internal) {
    if (t.isError === '1') continue
    const to = t.to || t.contractAddress || ''
    const v = toUnits(t.value, 18)
    if (!to || v <= 0) continue
    rawTxs.push(transfer(t.hash, t.from, to, v, 'ETH', t.timeStamp, 'internal', undefined, t.traceId))
  }
  let spam = 0
  let fake = 0
  for (const t of tokens) {
    const v = toUnits(t.value, parseInt(t.tokenDecimal, 10) || 0)
    if (v <= 0) {
      spam++
      continue
    }
    let symbol = (t.tokenSymbol || 'TOKEN').replace(/[^\w.$-]/g, '').slice(0, 12) || 'TOKEN'
    const real = KNOWN_TOKENS[symbol.toUpperCase()]
    if (real && real !== t.contractAddress.toLowerCase()) {
      symbol = `${symbol}*`
      fake++
    }
    rawTxs.push(transfer(t.hash, t.from, t.to, v, symbol, t.timeStamp, 'token', undefined, t.logIndex))
  }
  if (spam) warnings.push(`${spam} zero-value token transfer(s) hidden (typical address-poisoning spam)`)
  if (fake) warnings.push(`${fake} transfer(s) of fake tokens posing as real ones (e.g. a fake USDT contract). These are usually address-poisoning spam; no real funds moved`)

  rawTxs.sort((a, b) => b.timestamp - a.timestamp)
  const more = normal.length >= PAGE_SIZE || internal.length >= PAGE_SIZE || tokens.length >= PAGE_SIZE

  return assemble({
    address: addr,
    chain: 'eth',
    balance: balanceRes,
    txCount: rawTxs.length,
    rawTxs,
    nextCursor: more ? String(page + 1) : undefined,
    warnings,
  })
}

async function fetchBalance(addr: string): Promise<number> {
  const body = await fetchJson<{ status: string; message: string; result: string }>(
    url({ module: 'account', action: 'balance', address: addr, tag: 'latest' }),
    60,
    4,
    rateLimited
  )
  if (body.status !== '1') throw new Error(`Etherscan: ${body.result || body.message}`)
  return toUnits(body.result, 18)
}

/** Transaction receipt via Etherscan's proxy module (fallback when the public RPC fails) */
export async function receiptViaEtherscan<T>(hash: string): Promise<T | undefined> {
  const body = await fetchJson<{ result?: T }>(url({ module: 'proxy', action: 'eth_getTransactionReceipt', txhash: hash }), 600, 4, rateLimited)
  return body.result ?? undefined
}

/** Internal ETH transfers made by one transaction (needs an Etherscan key) */
export async function internalTransfersByHash(hash: string): Promise<{ from: string; to: string; value: number; traceId?: string }[]> {
  const rows = await etherscan<InternalTx>({ module: 'account', action: 'txlistinternal', txhash: hash }, 600)
  return rows
    .filter(r => r.isError !== '1' && (r.to || r.contractAddress))
    .map(r => ({ from: r.from.toLowerCase(), to: (r.to || r.contractAddress || '').toLowerCase(), value: toUnits(r.value, 18), traceId: r.traceId }))
    .filter(r => r.value > 0)
}
