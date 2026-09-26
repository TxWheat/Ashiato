import { NextRequest, NextResponse } from 'next/server'
import { Chain } from '@/lib/types'
import { detectChain } from '@/lib/detect-chain'
import { communityLabels } from '@/lib/attest/read'
import { ATTEST_CHAIN } from '@/lib/attest/config'

// Community labels (EAS attestations) for an address, with votes and trust scores.
// Public and CORS-open so wallets and other tools (e.g. a MetaMask Snap) can read it.
// Reading attestations and ENS names can be slow; Vercel cuts functions off at the default otherwise
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params
  const addr = decodeURIComponent(address).trim()
  const headers = { 'access-control-allow-origin': '*' }
  if (!['btc', 'eth', 'tron'].includes(chain) || detectChain(addr) !== chain) {
    return NextResponse.json({ error: `Not a valid ${chain.toUpperCase()} address` }, { status: 400, headers })
  }
  try {
    const labels = await communityLabels(chain as Chain, addr, req.nextUrl.searchParams.get('fresh') === '1')
    return NextResponse.json({ network: ATTEST_CHAIN.name, labels }, { headers })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read community labels', labels: [] }, { status: 502, headers })
  }
}
