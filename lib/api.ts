import 'server-only'
import { NextResponse } from 'next/server'
import { Chain, TraceResult } from './types'
import { detectChain, normaliseAddress } from './detect-chain'
import { traceBtcAddress } from './chains/btc'
import { traceEthAddress, MissingApiKeyError } from './chains/eth'
import { UpstreamError } from './http'

/** Validates the path params and runs the trace, or returns an error response */
export async function handleTrace(
  chainParam: string,
  rawAddress: string,
  cursor?: string | null
): Promise<TraceResult | NextResponse> {
  const address = decodeURIComponent(rawAddress).trim()
  const chain = chainParam as Chain
  if ((chain !== 'btc' && chain !== 'eth') || detectChain(address) !== chain) {
    return NextResponse.json({ error: `Not a valid ${chainParam.toUpperCase()} address` }, { status: 400 })
  }
  if (cursor && !/^[0-9a-fA-F]{64}$|^\d{1,4}$/.test(cursor)) {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
  }
  const addr = normaliseAddress(address, chain)
  try {
    return chain === 'btc'
      ? await traceBtcAddress(addr, cursor ?? undefined)
      : await traceEthAddress(addr, cursor ?? undefined)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to trace address'
    const status = e instanceof MissingApiKeyError ? 400 : e instanceof UpstreamError && e.status === 429 ? 429 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
