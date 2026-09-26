import 'server-only'
import { fetchJson } from '../http'
import { CrossChainHop, toOurChain } from './types'
import { chainName, checksum, list, Raw, str, units } from './util'

// Across (across.to) deposits: a deposit on one chain is filled by a relayer on another.
//   GET https://app.across.to/api/deposits?depositor=0x…&limit=100
// Each record has depositTxHash (money in), fillTx (money out), recipient and both chain ids.

const BASE = (process.env.ACROSS_API_URL || 'https://app.across.to/api').replace(/\/$/, '')

/** Across reports raw token amounts; decimals for the tokens it moves most (by chain and address) */
const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  '1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'ETH', decimals: 18 },
  '1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 },
  '1:0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6 },
  '1:0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', decimals: 18 },
  '1:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { symbol: 'WBTC', decimals: 8 },
  '10:0x4200000000000000000000000000000000000006': { symbol: 'ETH', decimals: 18 },
  '10:0x0b2c639c533813f4aa9d7837caf62653d097ff85': { symbol: 'USDC', decimals: 6 },
  '10:0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': { symbol: 'USDT', decimals: 6 },
  '8453:0x4200000000000000000000000000000000000006': { symbol: 'ETH', decimals: 18 },
  '8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  '42161:0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { symbol: 'ETH', decimals: 18 },
  '42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC', decimals: 6 },
  '42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { symbol: 'USDT', decimals: 6 },
  '137:0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': { symbol: 'WETH', decimals: 18 },
  '137:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { symbol: 'USDC', decimals: 6 },
  '137:0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { symbol: 'USDC.e', decimals: 6 },
  '137:0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { symbol: 'USDT', decimals: 6 },
  '56:0x55d398326f99059ff775485246999027b3197955': { symbol: 'USDT', decimals: 18 },
  '56:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { symbol: 'USDC', decimals: 18 },
}

function amountOf(chainId: string, token: string, raw: string): { amount: number; asset: string } {
  const t = TOKENS[`${chainId}:${token.toLowerCase()}`]
  // An unknown token's decimals are unknown: show no amount rather than a wrong one
  return t ? { amount: units(raw, t.decimals), asset: t.symbol } : { amount: 0, asset: token ? `${token.slice(0, 6)}…` : '?' }
}

export function hopFromAcross(d: Raw): CrossChainHop | null {
  const fromHash = str(d.depositTxHash) || str(d.depositTxnRef)
  const toAddress = str(d.recipient)
  if (!fromHash || !toAddress) return null
  const fromId = str(d.originChainId), toId = str(d.destinationChainId)
  const fromChainName = chainName(fromId), toChainName = chainName(toId)
  const input = amountOf(fromId, str(d.inputToken), str(d.inputAmount))
  const output = amountOf(toId, str(d.outputToken), str(d.outputAmount))
  const depositTime = str(d.depositBlockTimestamp)
  return {
    service: 'Across',
    orderId: `across:${fromId}:${str(d.depositId) || fromHash}`,
    status: str(d.status) || 'unknown',
    fromChainName, toChainName,
    fromChain: toOurChain(fromChainName), toChain: toOurChain(toChainName),
    fromAddress: str(d.depositor),
    toAddress,
    fromHash,
    toHash: str(d.fillTx) || str(d.fillTxnRef) || undefined,
    fromAmount: input.amount, fromAsset: input.asset,
    toAmount: output.amount, toAsset: output.asset,
    createdText: depositTime ? depositTime.replace('T', ' ').replace(/\.\d+Z?$|Z$/, '') + ' UTC' : undefined,
  }
}

/** Deposits a wallet made through Across, newest first */
export async function acrossDeposits(depositor: string): Promise<CrossChainHop[]> {
  const res = await fetchJson<unknown>(`${BASE}/deposits?depositor=${encodeURIComponent(checksum(depositor))}&limit=100`, 120, 2)
  const rows = Array.isArray(res) ? list(res) : list((res as Raw)?.deposits)
  return rows.map(hopFromAcross).filter((h): h is CrossChainHop => !!h).sort((a, b) => (b.createdText ?? '').localeCompare(a.createdText ?? ''))
}
