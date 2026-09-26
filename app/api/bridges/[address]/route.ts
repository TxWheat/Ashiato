import { NextRequest, NextResponse } from 'next/server'
import { detectChain, normaliseAddress } from '@/lib/detect-chain'
import { bridgersOrders } from '@/lib/bridges/bridgers'
import { acrossDeposits } from '@/lib/bridges/across'
import { relayRequests } from '@/lib/bridges/relay'
import { deBridgeOrders } from '@/lib/bridges/debridge'
import { BridgeService } from '@/lib/bridges/types'

export const maxDuration = 30

/**
 * Cross-chain transfers sent from an address, from the service's own records.
 * ?service=Bridgers|Across|Relay|deBridge (default Bridgers); deBridge also needs
 * ?txids=a,b (the transactions into it), as it can't be searched by wallet.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const raw = decodeURIComponent((await params).address).trim()
  const chain = detectChain(raw)
  if (!chain) return NextResponse.json({ error: 'Not a valid address' }, { status: 400 })
  const address = normaliseAddress(raw, chain)
  const service = (req.nextUrl.searchParams.get('service') ?? 'Bridgers') as BridgeService
  const txids = (req.nextUrl.searchParams.get('txids') ?? '').split(',').map(t => t.trim()).filter(t => /^(0x)?[0-9a-fA-F]{64}$/.test(t))
  try {
    const hops =
      service === 'Across' ? await acrossDeposits(address)
        : service === 'Relay' ? await relayRequests(address)
          : service === 'deBridge' ? await deBridgeOrders(txids)
            : service === 'Bridgers' ? await bridgersOrders(address)
              : null
    if (!hops) return NextResponse.json({ error: 'Unknown service', hops: [] }, { status: 400 })
    return NextResponse.json({ hops })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : `${service} lookup failed`, hops: [] }, { status: 502 })
  }
}
