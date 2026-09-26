import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth/session'
import { requirePro } from '@/lib/billing/pro'
import { StoreNotConfigured } from '@/lib/supabase'
import { detectChain, normaliseAddress } from '@/lib/detect-chain'
import { addWatch, removeWatch, watchesOf } from '@/lib/alerts/store'
import { newestTime } from '@/lib/alerts/check'

// Addresses a wallet watches for new transfers (adding one is Pro)

export const maxDuration = 60
const MAX_WATCHES = 50

const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : 'Storage error' }, { status: e instanceof StoreNotConfigured ? 503 : 502 })

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  try {
    return NextResponse.json({ watches: await watchesOf(user) })
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: NextRequest) {
  const pro = await requirePro()
  if ('response' in pro) return pro.response
  const body = await req.json().catch(() => null) as { chain?: string; address?: string; label?: string } | null
  const chain = body?.chain
  const raw = body?.address?.trim() ?? ''
  if (!chain || !['btc', 'eth', 'tron'].includes(chain) || detectChain(raw) !== chain) return NextResponse.json({ error: 'Not a valid address' }, { status: 400 })
  const address = normaliseAddress(raw, chain as 'btc' | 'eth' | 'tron')
  try {
    const mine = await watchesOf(pro.wallet)
    if (!mine.some(w => w.chain === chain && w.address === address) && mine.length >= MAX_WATCHES) {
      return NextResponse.json({ error: `You can watch up to ${MAX_WATCHES} addresses` }, { status: 400 })
    }
    // Only transfers after now alert, not the address's history
    const lastSeen = await newestTime(chain as 'btc' | 'eth' | 'tron', address)
    const watch = await addWatch({ wallet: pro.wallet, chain, address, label: body?.label?.trim().slice(0, 80) || null, last_seen: lastSeen })
    return NextResponse.json({ watch })
  } catch (e) {
    return fail(e)
  }
}

export async function DELETE(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  try {
    await removeWatch(user, id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return fail(e)
  }
}
