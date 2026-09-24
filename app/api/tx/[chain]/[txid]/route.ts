import { NextRequest, NextResponse } from 'next/server'
import { fetchBtcTx } from '@/lib/chains/btc'
import { UpstreamError } from '@/lib/http'

// One transaction with the spender of each output, used for exact UTXO tracing.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chain: string; txid: string }> }
) {
  const { chain, txid } = await params
  if (chain !== 'btc') return NextResponse.json({ error: 'Only BTC transactions are supported here' }, { status: 400 })
  if (!/^[0-9a-f]{64}$/.test(txid)) return NextResponse.json({ error: 'Invalid txid' }, { status: 400 })
  try {
    return NextResponse.json(await fetchBtcTx(txid))
  } catch (e) {
    const status = e instanceof UpstreamError && e.status === 404 ? 404 : 502
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load transaction' }, { status })
  }
}
