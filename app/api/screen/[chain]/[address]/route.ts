import { NextRequest, NextResponse } from 'next/server'
import { handleTrace } from '@/lib/api'

// Machine-readable screening result for one address (latest page of activity).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chain: string; address: string }> }
) {
  const { chain, address } = await params
  const result = await handleTrace(chain, address)
  if (result instanceof NextResponse) return result
  return NextResponse.json({
    address: result.address,
    chain: result.chain,
    label: result.entity ?? null,
    risk: result.risk,
    findings: result.findings,
    balance: result.balance,
    txsAnalysed: result.rawTxs.length,
    txCount: result.txCount,
    partial: !!result.nextCursor,
    methodology: '/methodology',
  })
}
