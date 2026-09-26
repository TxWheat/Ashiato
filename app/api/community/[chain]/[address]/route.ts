import { NextResponse } from 'next/server'
import { addressFits } from '@/lib/detect-chain'
import { communityLabels } from '@/lib/attest/read'

// Community labels (wallet-signed) for an address, with votes and trust scores.
// Public and CORS-open so wallets and other tools (e.g. a MetaMask Snap) can read it.
// ENS lookups for the signers can be slow; Vercel cuts functions off at the default otherwise
export const maxDuration = 60

export async function GET(_req: Request, { params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params
  const addr = decodeURIComponent(address).trim()
  const headers = { 'access-control-allow-origin': '*' }
  if (!addressFits(addr, chain)) {
    return NextResponse.json({ error: `Not a valid ${chain.toUpperCase()} address` }, { status: 400, headers })
  }
  try {
    return NextResponse.json({ labels: await communityLabels(chain, addr) }, { headers })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read community labels', labels: [] }, { status: 502, headers })
  }
}
