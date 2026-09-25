import { NextResponse } from 'next/server'
import { detectChain, normaliseAddress } from '@/lib/detect-chain'
import { bridgersOrders } from '@/lib/bridges/bridgers'

export const maxDuration = 30

/** Cross-chain swaps sent from an address (Bridgers order records) */
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const raw = decodeURIComponent((await params).address).trim()
  const chain = detectChain(raw)
  if (!chain) return NextResponse.json({ error: 'Not a valid address' }, { status: 400 })
  const address = normaliseAddress(raw, chain)
  try {
    return NextResponse.json({ hops: await bridgersOrders(address) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Bridgers lookup failed', hops: [] }, { status: 502 })
  }
}
