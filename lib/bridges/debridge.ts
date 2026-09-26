import 'server-only'
import { fetchJson } from '../http'
import { CrossChainHop, toOurChain } from './types'
import { chainName, num, obj, Raw, str, units } from './util'

// deBridge DLN orders, looked up by the source transaction:
//   GET https://stats-api.dln.trade/api/Transaction/{txHash}/orderIds  → the orders it created
//   GET https://stats-api.dln.trade/api/Orders/{orderId}                → both sides of an order
// Values come wrapped ({ stringValue } / { bigIntegerValue }); str() unwraps them.

const BASE = (process.env.DEBRIDGE_API_URL || 'https://stats-api.dln.trade/api').replace(/\/$/, '')

function side(v: unknown) {
  const o = obj(v)
  const meta = obj(o.metadata)
  const decimals = num(meta.decimals) || num(o.decimals)
  const raw = str(o.finalAmount) || str(o.amount)
  return {
    chainId: str(o.chainId),
    asset: str(meta.symbol).toUpperCase() || '?',
    // Without decimals the amount can't be read: show none rather than a wrong one
    amount: decimals ? units(raw, decimals) : 0,
  }
}

export function hopFromDeBridge(o: Raw, sourceHash: string): CrossChainHop | null {
  const orderId = str(o.orderId)
  const toAddress = str(o.receiverDst)
  if (!orderId || !toAddress) return null
  const give = side(o.giveOfferWithMetadata ?? o.giveOffer)
  const take = side(o.takeOfferWithMetadata ?? o.takeOffer)
  const fromChainName = chainName(give.chainId), toChainName = chainName(take.chainId)
  const created = obj(o.createdSrcEventMetadata)
  const fulfilled = obj(o.fulfilledDstEventMetadata)
  const ts = num(created.blockTimeStamp)
  return {
    service: 'deBridge',
    orderId: `debridge:${orderId}`,
    status: str(o.state) || str(o.status) || 'unknown',
    fromChainName, toChainName,
    fromChain: toOurChain(fromChainName), toChain: toOurChain(toChainName),
    fromAddress: str(o.makerSrc),
    toAddress,
    fromHash: str(created.transactionHash) || sourceHash,
    toHash: str(fulfilled.transactionHash) || undefined,
    fromAmount: give.amount, fromAsset: give.asset,
    toAmount: take.amount, toAsset: take.asset,
    createdText: ts ? new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : undefined,
  }
}

/** DLN orders created by these source transactions (deBridge has no lookup by wallet) */
export async function deBridgeOrders(txids: string[]): Promise<CrossChainHop[]> {
  const hops: CrossChainHop[] = []
  for (const tx of txids.slice(0, 10)) {
    const ids = await fetchJson<unknown>(`${BASE}/Transaction/${encodeURIComponent(tx)}/orderIds`, 300, 2).catch(() => null)
    const wrapped = obj(ids).orderIds
    const orderIds = (Array.isArray(ids) ? ids : Array.isArray(wrapped) ? wrapped : []).map(str).filter(Boolean)
    for (const id of orderIds) {
      const order = await fetchJson<Raw>(`${BASE}/Orders/${encodeURIComponent(id)}`, 300, 2).catch(() => null)
      const hop = order && hopFromDeBridge(order, tx)
      if (hop) hops.push(hop)
    }
  }
  return hops
}
