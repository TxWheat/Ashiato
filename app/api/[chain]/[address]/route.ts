import { NextRequest, NextResponse } from 'next/server'
import { handleTrace } from '@/lib/api'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chain: string; address: string }> }
) {
  const { chain, address } = await params
  const result = await handleTrace(chain, address, req.nextUrl.searchParams.get('cursor'))
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
