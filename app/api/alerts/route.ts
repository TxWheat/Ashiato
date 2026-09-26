import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth/session'
import { storeConfigured } from '@/lib/supabase'
import { alertsOf, markRead, staleWatches } from '@/lib/alerts/store'
import { checkWatches } from '@/lib/alerts/check'

// Your alerts. Opening the app also checks your watched addresses that have not been
// checked for a few minutes, so alerts arrive while you work, not only on the daily run.

export const maxDuration = 60
export const dynamic = 'force-dynamic'
const RECHECK_MS = 5 * 60_000

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  if (!storeConfigured()) return NextResponse.json({ alerts: [], unread: 0 })
  try {
    const stale = await staleWatches(new Date(Date.now() - RECHECK_MS), 10, user)
    if (stale.length) await checkWatches(stale, 25_000)
    const alerts = await alertsOf(user)
    return NextResponse.json({ alerts, unread: alerts.filter(a => !a.read).length }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load alerts', alerts: [], unread: 0 }, { status: 502 })
  }
}

/** Marks every alert read */
export async function POST() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  try {
    await markRead(user)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not update alerts' }, { status: 502 })
  }
}
