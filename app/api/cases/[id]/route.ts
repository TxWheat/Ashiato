import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth/session'
import { deleteCase, getCase, putCase, StoreNotConfigured } from '@/lib/auth/cases-store'

export const dynamic = 'force-dynamic'

// Compressed case files; Vercel caps request bodies at 4.5 MB
const MAX_DATA = 4_000_000

type Ctx = { params: Promise<{ id: string }> }
const validId = (id: string) => /^[\w-]{3,64}$/.test(id)
const fail = (e: unknown) =>
  NextResponse.json({ error: e instanceof Error ? e.message : 'Case storage error' }, { status: e instanceof StoreNotConfigured ? 503 : 502 })

export async function GET(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser()
  if (!me) return NextResponse.json({ error: 'Sign in to open your cases' }, { status: 401 })
  const { id } = await params
  if (!validId(id)) return NextResponse.json({ error: 'Invalid case id' }, { status: 400 })
  try {
    const row = await getCase(me, id)
    return row ? NextResponse.json(row) : NextResponse.json({ error: 'That case is not in your account' }, { status: 404 })
  } catch (e) {
    return fail(e)
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const me = await currentUser()
  if (!me) return NextResponse.json({ error: 'Sign in to save to your account' }, { status: 401 })
  const { id } = await params
  if (!validId(id)) return NextResponse.json({ error: 'Invalid case id' }, { status: 400 })
  let b: { name?: unknown; origin?: { address?: unknown; chain?: unknown }; originKind?: unknown; addresses?: unknown; data?: unknown }
  try {
    b = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
  if (!name || typeof b.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b.data)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  if (b.data.length > MAX_DATA) return NextResponse.json({ error: 'This case is too large to save to your account (hide some addresses or export it as a file)' }, { status: 413 })
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined)
  try {
    await putCase(me, {
      id, name, data: b.data,
      origin_address: str(b.origin?.address, 120), origin_chain: str(b.origin?.chain, 10), origin_kind: str(b.originKind, 10),
      addresses: typeof b.addresses === 'number' ? Math.max(0, Math.floor(b.addresses)) : 0,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return fail(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser()
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const { id } = await params
  if (!validId(id)) return NextResponse.json({ error: 'Invalid case id' }, { status: 400 })
  try {
    await deleteCase(me, id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return fail(e)
  }
}
