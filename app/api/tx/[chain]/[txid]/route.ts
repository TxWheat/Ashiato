import { NextRequest, NextResponse } from 'next/server'
import { fetchBtcTx } from '@/lib/chains/btc'
import { fetchEthTx } from '@/lib/chains/eth-tx'
import { UpstreamError } from '@/lib/http'

// One transaction. BTC: with the spender of each output (exact UTXO tracing).
// ETH: every value transfer inside it (ETH, ERC-20 events, internal).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chain: string; txid: string }> }
) {
  const { chain, txid } = await params
  if (chain === 'eth') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txid)) return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 })
    try {
      return NextResponse.json(await fetchEthTx(txid))
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load transaction' }, { status: 502 })
    }
  }
  if (chain !== 'btc') return NextResponse.json({ error: 'Unknown chain' }, { status: 400 })
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) return NextResponse.json({ error: 'Invalid txid' }, { status: 400 })
  try {
    return NextResponse.json(await fetchBtcTx(txid.toLowerCase()))
  } catch (e) {
    const status = e instanceof UpstreamError && e.status === 404 ? 404 : 502
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load transaction' }, { status })
  }
}
