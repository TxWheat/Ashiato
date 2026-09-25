import { NextRequest, NextResponse } from 'next/server'
import { handleTrace } from '@/lib/api'

// Traces can take a while on free APIs; Vercel cuts functions off at the default otherwise
export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chain: string; address: string }> }
) {
  const { chain, address } = await params
  const result = await handleTrace(chain, address, req.nextUrl.searchParams.get('cursor'))
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
