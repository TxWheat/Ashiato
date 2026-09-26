import 'server-only'
import { NextResponse } from 'next/server'
import { Chain, TraceResult } from './types'
import { addressFits, normaliseAddress } from './detect-chain'
import { isProChain } from './evm'
import { requirePro } from './billing/pro'
import { traceBtcAddress } from './chains/btc'
import { traceEthAddress, MissingApiKeyError } from './chains/eth'
import { traceTronAddress } from './chains/tron'
import { UpstreamError } from './http'

/** Validates the path params and runs the trace, or returns an error response */
export async function handleTrace(
  chainParam: string,
  rawAddress: string,
  cursor?: string | null
): Promise<TraceResult | NextResponse> {
  const address = decodeURIComponent(rawAddress).trim()
  const chain = chainParam as Chain
  if (!addressFits(address, chain)) {
    return NextResponse.json({ error: `Not a valid ${chainParam.toUpperCase()} address` }, { status: 400 })
  }
  if (isProChain(chain)) {
    const pro = await requirePro()
    if ('response' in pro) return pro.response
  }
  // BTC: last txid; ETH: page number; Tron: two TronGrid fingerprints
  if (cursor && !/^[0-9a-fA-F]{64}$|^\d{1,4}$|^[\w+/=.-]{1,300}~[\w+/=.-]{1,300}$/.test(cursor)) {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
  }
  const addr = normaliseAddress(address, chain)
  try {
    return chain === 'btc'
      ? await traceBtcAddress(addr, cursor ?? undefined)
      : chain === 'tron'
        ? await traceTronAddress(addr, cursor ?? undefined)
        : await traceEthAddress(addr, cursor ?? undefined, chain)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to trace address'
    const status = e instanceof MissingApiKeyError ? 400 : e instanceof UpstreamError && e.status === 429 ? 429 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
