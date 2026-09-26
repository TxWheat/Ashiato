import { NextRequest, NextResponse } from 'next/server'
import { staleWatches } from '@/lib/alerts/store'
import { checkWatches } from '@/lib/alerts/check'

// Scheduled check of every watched address (vercel.json cron, or any scheduler that sends
// "Authorization: Bearer <CRON_SECRET>"). Checks the longest-waiting addresses first.

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const due = await staleWatches(new Date(Date.now() - 5 * 60_000), 200)
    const checked = await checkWatches(due, 50_000)
    return NextResponse.json({ due: due.length, checked })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Check failed' }, { status: 502 })
  }
}
