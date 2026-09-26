import 'server-only'
import { fetchJson } from '../http'
import { CrossChainHop, toOurChain } from './types'
import { chainName, checksum, list, num, obj, Raw, str } from './util'

// Relay (relay.link) requests: a solver pays out on the destination chain.
//   GET https://api.relay.link/requests/v3?user=0x…&limit=50   (header x-api-key: RELAY_API_KEY)
// Each request has inTxs (money in), outTxs (money out), the recipient, and the route
// with both currencies and formatted amounts.

const BASE = (process.env.RELAY_API_URL || 'https://api.relay.link').replace(/\/$/, '')

const leg = (v: unknown) => {
  const c = obj(v)
  const cur = obj(c.currency)
  return { amount: num(c.amountFormatted), asset: str(cur.symbol).toUpperCase() || '?', chainId: str(cur.chainId) }
}

export function hopFromRelay(r: Raw): CrossChainHop | null {
  const data = obj(r.data)
  const inTx = list(data.inTxs)[0]
  const outTx = list(data.outTxs)[0]
  const toAddress = str(r.recipient)
  const fromHash = str(inTx?.hash) || str(inTx?.txHash)
  if (!fromHash || !toAddress) return null
  const route = obj(obj(data.route).actual ?? obj(data.route).quoted)
  const input = leg(obj(route.origin).inputCurrency)
  const output = leg(obj(route.destination).outputCurrency)
  const fromChainName = chainName(input.chainId || str(inTx?.chainId))
  const toChainName = chainName(output.chainId || str(outTx?.chainId))
  return {
    service: 'Relay',
    orderId: `relay:${str(r.id) || fromHash}`,
    status: str(r.status) || 'unknown',
    fromChainName, toChainName,
    fromChain: toOurChain(fromChainName), toChain: toOurChain(toChainName),
    fromAddress: [str(r.user), str(r.sender)].find(a => a && !/^0x0{40}$/i.test(a)) ?? '',
    toAddress,
    fromHash,
    toHash: str(outTx?.hash) || str(outTx?.txHash) || undefined,
    fromAmount: input.amount, fromAsset: input.asset,
    toAmount: output.amount, toAsset: output.asset,
    createdText: str(r.createdAt) ? str(r.createdAt).replace('T', ' ').replace(/\.\d+Z?$|Z$/, '') + ' UTC' : undefined,
  }
}

const ZERO = /^0x0{40}$/i
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Relay transfers from a wallet, newest first. Relay's API needs a key (x-api-key).
 * Its search filters can be ignored (it then returns everyone's latest requests), so
 * nothing is trusted unless it provably belongs here: the incoming transaction is one of
 * `txids`, or the request's user / sender is the wallet.
 */
export async function relayRequests(wallet: string, txids: string[] = []): Promise<CrossChainHop[]> {
  const key = process.env.RELAY_API_KEY
  if (!key) throw new Error('Relay lookups need an API key on this server (RELAY_API_KEY, free from relay.link)')
  const get = (q: string) => fetchJson<Raw>(`${BASE}/requests/v3?${q}`, 120, 2, undefined, { headers: { 'x-api-key': key } })
  const ours = new Set(txids.map(t => t.toLowerCase()))
  const found = new Map<string, CrossChainHop>()
  const keep = (r: Raw, hop: CrossChainHop | null) => {
    if (!hop) return
    const inHashes = list(obj(r.data).inTxs).map(t => (str(t.hash) || str(t.txHash)).toLowerCase())
    const byTx = inHashes.some(h => ours.has(h))
    const byWallet = [str(r.user), str(r.sender)].some(a => a && !ZERO.test(a) && same(a, wallet))
    if (byTx || byWallet) found.set(hop.orderId, hop)
  }
  for (const tx of txids.slice(0, 5)) {
    const res = await get(`hash=${encodeURIComponent(tx)}`).catch(() => null)
    for (const r of list(res?.requests)) keep(r, hopFromRelay(r))
  }
  const res = await get(`user=${encodeURIComponent(checksum(wallet))}&limit=50`)
  for (const r of list(res?.requests)) keep(r, hopFromRelay(r))
  return [...found.values()].sort((a, b) => (b.createdText ?? '').localeCompare(a.createdText ?? ''))
}
