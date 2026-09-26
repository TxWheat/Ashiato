import 'server-only'
import { RawTransaction, TraceResult } from '../types'
import { fetchJson } from '../http'
import { assemble } from '../trace'
import { getLabel } from '../labels'
import { etherscanLabel } from './eth-labels'
import { warmScamLists } from '../scam-lists'
import { EVM, EvmChain } from '../evm'

// Etherscan API V2 (V1 was shut down on 2025-08-15). One key covers every Ethereum-style
// network via `chainid` (lib/evm.ts); Ethereum works on the free plan, the others need a paid one.
// Override with ETHERSCAN_API_URL for a compatible proxy or tests
const BASE = process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/v2/api'
// Per list (normal, internal, token): 3 calls load up to 1,500 rows. Etherscan caps page × offset at 10,000.
const PAGE_SIZE = 500

// Real contracts for commonly spoofed tokens, per network. Scam airdrops mint look-alike
// "USDT" tokens; a symbol from any other contract is shown as e.g. "USDT*".
export const KNOWN_TOKENS: Record<EvmChain, Record<string, string>> = {
  eth: {
    USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7', USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    DAI: '0x6b175474e89094c44da98b954eedeac495271d0f', WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    WBTC: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  },
  base: {
    USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', USDBC: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
    USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', DAI: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
    WETH: '0x4200000000000000000000000000000000000006',
  },
  arbitrum: {
    USDC: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', USDCE: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
    USDT: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', DAI: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
    WETH: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', WBTC: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f',
  },
  optimism: {
    USDC: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', USDT: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
    DAI: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', WETH: '0x4200000000000000000000000000000000000006',
    WBTC: '0x68f180fcce6836688e9084f035309e29bf0a2095',
  },
  bsc: {
    USDT: '0x55d398326f99059ff775485246999027b3197955', USDC: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    DAI: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', ETH: '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
    WBNB: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', BTCB: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
  },
  polygon: {
    USDT: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', USDC: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    USDCE: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', DAI: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
    WETH: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', WBTC: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6',
    WPOL: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
  },
}

/** Names only the native coin can have: a token calling itself one is always fake */
const NATIVE_NAMES: Record<string, string[]> = {
  ETH: ['ETH', 'ETHER', 'ETHEREUM'], BNB: ['BNB'], POL: ['POL', 'MATIC'],
}

/**
 * The asset name for a token transfer. Look-alikes of well-known tokens, and tokens
 * posing as native ETH (address-poisoning spam), get a "*" and are shown as fake.
 */
export function tokenAsset(rawSymbol: string, contract: string, chain: EvmChain = 'eth'): string {
  const symbol = (rawSymbol || 'TOKEN').replace(/[^\w.$-]/g, '').slice(0, 12) || 'TOKEN'
  const letters = symbol.replace(/[^a-z]/gi, '').toUpperCase()
  if (NATIVE_NAMES[EVM[chain].native].includes(letters)) return `${symbol}*`
  const real = KNOWN_TOKENS[chain][letters]
  return real && real !== contract.toLowerCase() ? `${symbol}*` : symbol
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
      'ETH tracing needs a free Etherscan API key. Add ETHERSCAN_API_KEY to .env.local (or the hosting environment variables), then restart.'
    )
  }
  return key
}

export function etherscanUrl(params: Record<string, string | number>, chain: EvmChain = 'eth'): string {
  const qs = new URLSearchParams({ chainid: String(EVM[chain].id) })
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
  qs.set('apikey', apiKey())
  return `${BASE}?${qs}`
}

/** Etherscan reports rate limiting as a normal 200 response */
export const etherscanRateLimited = (b: { status?: string; result?: unknown }) =>
  b?.status === '0' && typeof b.result === 'string' && /rate limit|max calls/i.test(b.result)

async function etherscan<T>(params: Record<string, string | number>, chain: EvmChain, ttl = 120): Promise<T[]> {
  const body = await fetchJson<EtherscanResponse<T>>(etherscanUrl(params, chain), ttl, 4, etherscanRateLimited)
  if (body.status === '1' && Array.isArray(body.result)) return body.result
  if (/no transactions found|no records found/i.test(body.message) || (Array.isArray(body.result) && body.result.length === 0)) return []
  throw new Error(`Etherscan: ${typeof body.result === 'string' ? body.result : body.message}`)
}

export async function traceEthAddress(address: string, cursor?: string, chain: EvmChain = 'eth'): Promise<TraceResult> {
  await warmScamLists()
  const addr = address.toLowerCase()
  const page = cursor ? Math.max(1, parseInt(cursor, 10) || 1) : 1
  const list = { module: 'account', address: addr, page, offset: PAGE_SIZE, sort: 'desc' }
  const warnings: string[] = []

  const native = EVM[chain].native
  const balanceRes = await fetchBalance(addr, chain)
  // Name tag / contract name for addresses the offline label files don't know (first page only)
  const extraLabel = !cursor && !getLabel(addr, chain) ? etherscanLabel(addr, chain) : Promise.resolve(undefined)
  const [normal, internal, tokens] = await Promise.all([
    etherscan<NormalTx>({ ...list, action: 'txlist' }, chain),
    etherscan<InternalTx>({ ...list, action: 'txlistinternal' }, chain).catch(e => {
      warnings.push(`Internal transactions unavailable: ${e.message}`)
      return [] as InternalTx[]
    }),
    etherscan<TokenTx>({ ...list, action: 'tokentx' }, chain).catch(e => {
      warnings.push(`Token transfers unavailable: ${e.message}`)
      return [] as TokenTx[]
    }),
  ])

  const rawTxs: RawTransaction[] = []
  const transfer = (
    txid: string, from: string, to: string, amount: number, asset: string,
    ts: string, kind: RawTransaction['kind'], gasPriceGwei?: number, eventId?: string
  ): RawTransaction => ({
    txid, timestamp: parseInt(ts, 10), chain, asset, kind, gasPriceGwei, eventId,
    inputs: [{ address: from.toLowerCase(), amount: 0 }],
    outputs: [{ address: to.toLowerCase(), amount }],
  })

  for (const t of normal) {
    if (t.isError === '1') continue
    const to = t.to || t.contractAddress || ''
    if (!to) continue
    const gas = t.gasPrice ? Number(t.gasPrice) / 1e9 : undefined
    rawTxs.push(transfer(t.hash, t.from, to, toUnits(t.value, 18), native, t.timeStamp, 'normal', gas))
  }
  for (const t of internal) {
    if (t.isError === '1') continue
    const to = t.to || t.contractAddress || ''
    const v = toUnits(t.value, 18)
    if (!to || v <= 0) continue
    rawTxs.push(transfer(t.hash, t.from, to, v, native, t.timeStamp, 'internal', undefined, t.traceId))
  }
  let spam = 0
  let fake = 0
  for (const t of tokens) {
    const v = toUnits(t.value, parseInt(t.tokenDecimal, 10) || 0)
    if (v <= 0) {
      spam++
      continue
    }
    const symbol = tokenAsset(t.tokenSymbol, t.contractAddress, chain)
    if (symbol.endsWith('*')) fake++
    rawTxs.push(transfer(t.hash, t.from, t.to, v, symbol, t.timeStamp, 'token', undefined, t.logIndex))
  }
  if (spam) warnings.push(`${spam} zero-value token transfer(s) hidden (typical address-poisoning spam)`)
  if (fake) warnings.push(`${fake} transfer(s) of fake tokens posing as real ones (e.g. a fake USDT contract, or a token calling itself ETH). These are usually address-poisoning spam; no real funds moved`)

  rawTxs.sort((a, b) => b.timestamp - a.timestamp)
  const more = normal.length >= PAGE_SIZE || internal.length >= PAGE_SIZE || tokens.length >= PAGE_SIZE

  return assemble({
    address: addr,
    chain,
    balance: balanceRes,
    txCount: rawTxs.length,
    rawTxs,
    nextCursor: more ? String(page + 1) : undefined,
    warnings,
    extraLabel: await extraLabel,
  })
}

async function fetchBalance(addr: string, chain: EvmChain): Promise<number> {
  const body = await fetchJson<{ status: string; message: string; result: string }>(
    etherscanUrl({ module: 'account', action: 'balance', address: addr, tag: 'latest' }, chain),
    60,
    4,
    etherscanRateLimited
  )
  if (body.status !== '1') throw new Error(`Etherscan: ${body.result || body.message}`)
  return toUnits(body.result, 18)
}

/** Transaction receipt via Etherscan's proxy module (fallback when the public RPC fails) */
export async function receiptViaEtherscan<T>(hash: string, chain: EvmChain = 'eth'): Promise<T | undefined> {
  const body = await fetchJson<{ result?: T }>(etherscanUrl({ module: 'proxy', action: 'eth_getTransactionReceipt', txhash: hash }, chain), 600, 4, etherscanRateLimited)
  return body.result ?? undefined
}

/** Internal ETH transfers made by one transaction (needs an Etherscan key) */
export async function internalTransfersByHash(hash: string, chain: EvmChain = 'eth'): Promise<{ from: string; to: string; value: number; traceId?: string }[]> {
  const rows = await etherscan<InternalTx>({ module: 'account', action: 'txlistinternal', txhash: hash }, chain, 600)
  return rows
    .filter(r => r.isError !== '1' && (r.to || r.contractAddress))
    .map(r => ({ from: r.from.toLowerCase(), to: (r.to || r.contractAddress || '').toLowerCase(), value: toUnits(r.value, 18), traceId: r.traceId }))
    .filter(r => r.value > 0)
}
