import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ address: await currentUser() }, { headers: { 'cache-control': 'no-store' } })
}
