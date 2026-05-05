import { NextRequest, NextResponse } from 'next/server'
import { traceBtcAddress } from '@/lib/btc'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params
  try {
    const result = await traceBtcAddress(address)
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to trace address'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
