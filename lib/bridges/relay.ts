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
    fromAddress: str(r.user) || str(r.sender),
    toAddress,
    fromHash,
    toHash: str(outTx?.hash) || str(outTx?.txHash) || undefined,
    fromAmount: input.amount, fromAsset: input.asset,
    toAmount: output.amount, toAsset: output.asset,
    createdText: str(r.createdAt) ? str(r.createdAt).replace('T', ' ').replace(/\.\d+Z?$|Z$/, '') + ' UTC' : undefined,
  }
}

/** Cross-chain requests a wallet made through Relay, newest first. Relay's API needs a key (x-api-key) */
export async function relayRequests(user: string): Promise<CrossChainHop[]> {
  const key = process.env.RELAY_API_KEY
  if (!key) throw new Error('Relay lookups need an API key on this server (RELAY_API_KEY, free from relay.link)')
  const res = await fetchJson<Raw>(`${BASE}/requests/v3?user=${encodeURIComponent(checksum(user))}&limit=50`, 120, 2, undefined, { headers: { 'x-api-key': key } })
  return list(res?.requests).map(hopFromRelay).filter((h): h is CrossChainHop => !!h).sort((a, b) => (b.createdText ?? '').localeCompare(a.createdText ?? ''))
}
