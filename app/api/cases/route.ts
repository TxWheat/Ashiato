import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth/session'
import { listCases, StoreNotConfigured } from '@/lib/auth/cases-store'

export const dynamic = 'force-dynamic'

/** The signed-in wallet's cases (without their data) */
export async function GET() {
  const owner = await currentUser()
  if (!owner) return NextResponse.json({ error: 'Sign in to see your cases' }, { status: 401 })
  try {
    return NextResponse.json({ cases: await listCases(owner) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load cases' }, { status: e instanceof StoreNotConfigured ? 503 : 502 })
  }
}
