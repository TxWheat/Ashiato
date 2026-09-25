import { NextResponse } from 'next/server'
import { makeNonce } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ nonce: makeNonce() }, { headers: { 'cache-control': 'no-store' } })
}
